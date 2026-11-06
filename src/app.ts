/** The public channel: one site, a few pages, one streaming chat endpoint. */
import { Hono } from "hono";
import { streamSSE } from "hono/streaming";
import { classify } from "./agent/classify.js";
import { drafts, signDraft, verifyDraft } from "./agent/drafts.js";
import { RESTING, type ChatMessage } from "./agent/agent.js";
import { verifyWebhook } from "./github/app.js";
import type { AppState } from "./state.js";
import { getVitalSigns } from "./vitals/index.js";
import { chatScript } from "./web/chat.js";
import { aboutPage, contactPage, correctPage, homePage, proposalsPage, sourcesPage } from "./web/pages.js";

export function createApp(state: AppState): Hono {
const app = new Hono();

// Serverless hosts: make sure the index exists, and refresh it in the background when stale.
app.use("*", async (_c, next) => {
  await state.ready();
  state.refreshIfStale();
  await next();
});

const clientIp = (c: { req: { header: (n: string) => string | undefined } }) =>
  (c.req.header("x-forwarded-for") ?? "").split(",")[0].trim() || c.req.header("x-real-ip") || "local";

app.get("/health", (c) => c.json({ ok: true, records: state.index.size, built: state.lastBuild, model: state.agent ? state.cfg.model : null, budget: { spent: Number(state.budget.spent.toFixed(4)), limit: state.budget.limit } }));
app.get("/chat.js", (c) => c.body(chatScript, 200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300" }));

app.get("/", async (c) => c.html(homePage(state, await safeVitals())));
app.get("/about", (c) => c.html(aboutPage(state)));
app.get("/sources", async (c) => c.html(sourcesPage(state, await safeVitals())));
app.get("/proposals", async (c) => {
  try { return c.html(proposalsPage(state, await cachedPrs("proposal"))); } catch (err) { return c.html(proposalsPage(state, [], (err as Error).message)); }
});
app.get("/correct", async (c) => {
  let prs: Awaited<ReturnType<typeof cachedPrs>> = [];
  try { prs = await cachedPrs("correction"); } catch { /* shown as link */ }
  return c.html(correctPage(state, prs));
});
app.get("/contact", (c) => c.html(contactPage(state)));
app.post("/contact", async (c) => {
  const form = await c.req.parseBody();
  if (String(form.website ?? "")) return c.html(contactPage(state, { ok: "Thanks." }));
  const subject = String(form.subject ?? "").trim().slice(0, 140);
  const message = String(form.message ?? "").trim().slice(0, 4000);
  const reach = String(form.reach ?? "").trim().slice(0, 140);
  if (!subject || !message) return c.html(contactPage(state, { error: "Subject and message are both needed." }));
  if (!state.limiter.allow("contact:" + clientIp(c))) return c.html(contactPage(state, { error: "Too many in a row. Try again in a few minutes." }));
  if (!state.github.configured) return c.html(contactPage(state, { error: "The stewards haven't connected GitHub to this page yet. Email them instead, or open an issue on the repo." }));
  try {
    const r = await state.github.openIssue({ title: subject, body: `${message}\n\n${reach ? `Reach: ${reach}\n\n` : ""}_Sent from the contact page of the neighborhood agent._`, labels: ["contact"] });
    return c.html(contactPage(state, { ok: `It's public at ${r.url}` }));
  } catch (err) {
    return c.html(contactPage(state, { error: `Couldn't open the issue: ${(err as Error).message}` }));
  }
});

app.get("/api/vitals", async (c) => c.json(await safeVitals()));
app.get("/api/sources", (c) => c.json(state.statuses));

app.post("/api/chat", async (c) => {
  if (!state.agent) return c.json({ error: "The model isn't configured on this server." }, 503);
  if (!state.limiter.allow(clientIp(c))) return c.json({ error: "Easy there. Twenty messages every ten minutes per person, so there's room for everyone." }, 429);
  if (!state.budget.canSpend()) return c.json({ error: RESTING }, 503);
  let body: { messages?: ChatMessage[] };
  try { body = await c.req.json(); } catch { return c.json({ error: "Bad request." }, 400); }
  const messages = (body.messages ?? []).filter((m) => m && (m.role === "user" || m.role === "assistant") && typeof m.content === "string").map((m) => ({ role: m.role, content: m.content.slice(0, 4000) }));
  if (!messages.length || messages[messages.length - 1].role !== "user") return c.json({ error: "Say something first." }, 400);

  return streamSSE(c, async (stream) => {
    const send = (event: string, data: unknown) => stream.writeSSE({ event, data: JSON.stringify(data) });
    try {
      const result = await state.agent!.respond(messages, { repo: state.repo, index: state.index, log: state.log }, {
        onText: (d) => void send("text", d),
        onTool: (name) => void send("tool", name),
        onDraft: (d) => void send("draft", { id: d.id, path: d.path, content: d.content, kind: d.kind, token: signDraft(d) }),
      });
      await send("done", { tools: result.tools_used });
      const question = messages[messages.length - 1].content;
      classify(state.classifier, state.cfg.classifyModel, question, result.text)
        .then((cls) => state.log.add(cls.topic, cls.referral, cls.dont_know))
        .catch(() => undefined);
    } catch (err) {
      console.error("[chat]", err);
      await send("error", "Something went wrong on my side. Try again in a moment.");
    }
  });
});

app.post("/api/confirm", async (c) => {
  let body: { draft_id?: string; token?: string };
  try { body = await c.req.json(); } catch { return c.json({ error: "Bad request." }, 400); }
  const draft = drafts.get(String(body.draft_id ?? "")) ?? verifyDraft(body.token);
  if (!draft) return c.json({ error: "That draft expired. Ask again and I'll redraft it." }, 404);
  if (!state.limiter.allow("confirm:" + clientIp(c))) return c.json({ error: "Too many in a row. Try again in a few minutes." }, 429);
  const fallback_url = state.github.repo ? `${state.github.repoUrl}/new/${state.cfg.dataRepoBranch}?filename=${encodeURIComponent(draft.path)}&value=${encodeURIComponent(draft.content)}` : undefined;
  if (!state.github.configured) return c.json({ error: "The stewards haven't connected GitHub to this page yet, so I can't open it for you.", fallback_url });
  try {
    const pr = await state.github.openPr({ path: draft.path, content: draft.content, title: draft.title, body: draft.body, labels: draft.labels, base: state.cfg.dataRepoBranch });
    drafts.delete(draft.id);
    return c.json({ url: pr.url, number: pr.number });
  } catch (err) {
    console.error("[confirm]", err);
    return c.json({ error: `Couldn't open the PR: ${(err as Error).message}`, fallback_url });
  }
});

/** GitHub webhook: rebuild when the data repo's branch moves. */
app.post("/api/webhook/github", async (c) => {
  const raw = await c.req.text();
  const secret = state.cfg.github.webhookSecret;
  if (secret && !verifyWebhook(secret, raw, c.req.header("x-hub-signature-256"))) return c.text("bad signature", 401);
  if (!secret && c.req.header("x-hub-signature-256")) return c.text("no secret configured", 401);
  state.rebuild().catch(() => undefined);
  return c.json({ ok: true });
});

async function safeVitals() {
  try { return await getVitalSigns(state.repo); } catch { return []; }
}

const prCache = new Map<string, { at: number; list: Awaited<ReturnType<typeof state.github.listPrs>> }>();
async function cachedPrs(label: string) {
  const hit = prCache.get(label);
  if (hit && Date.now() - hit.at < 5 * 60_000) return hit.list;
  const list = await state.github.listPrs("open", label);
  prCache.set(label, { at: Date.now(), list });
  return list;
}


return app;
}
