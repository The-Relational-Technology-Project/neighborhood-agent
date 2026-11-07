/** The public channel: one site, a few pages, one streaming chat endpoint. */
import fs from "node:fs/promises";
import path from "node:path";
import { Hono, type Context } from "hono";
import { streamSSE } from "hono/streaming";
import { classify } from "./agent/classify.js";
import { drafts, makeDraft, signDraft, verifyDraft, type Draft } from "./agent/drafts.js";
import { ALLOWED_UPLOAD, MAX_UPLOAD_BYTES } from "./agent/suggest.js";
import { RESTING, type ChatMessage } from "./agent/agent.js";
import { verifyWebhook } from "./github/app.js";
import { emailConfigured, emailStewards, stewardAddresses, type Attachment } from "./notify/email.js";
import { isoWeek } from "./agent/questionlog.js";
import type { AppState } from "./state.js";
import { getVitalSigns } from "./vitals/index.js";
import { handleRpc, mcpTools, placePack, PACK_VERSION } from "./place/pack.js";
import { RateLimiter } from "./agent/budget.js";
import { chatScript } from "./web/chat.js";
import { aboutPage, contactPage, correctPage, homePage, proposalsPage, sourcesPage, stewardsPage, type QueueItem } from "./web/pages.js";

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
const BRAND_TYPES: Record<string, string> = { webp: "image/webp", png: "image/png", jpg: "image/jpeg", svg: "image/svg+xml" };
async function brandFile(c: Context, file: string) {
  if (!/^[\w.-]+\.(webp|png|jpg|svg)$/.test(file) || !state.brand.has(file)) return c.notFound();
  const data = await fs.readFile(path.join(state.repo.root, "brand", file));
  return c.body(new Uint8Array(data), 200, { "content-type": BRAND_TYPES[file.split(".").pop()!], "cache-control": "public, max-age=86400, stale-while-revalidate=604800" });
}
app.get("/brand/:file", (c) => brandFile(c, c.req.param("file")));
for (const f of ["favicon.png", "apple-touch-icon.png", "og.jpg"]) app.get(`/${f}`, (c) => brandFile(c, f));
app.get("/manifest.webmanifest", (c) => {
  const name = state.repo.placeMd.match(/Working name:\s*\*\*(.+?)\*\*/)?.[1] ?? "Neighborhood agent";
  const icons = [["apple-touch-icon.png", "180x180"], ["icon-512.png", "512x512"]].filter(([f]) => state.brand.has(f)).map(([f, sizes]) => ({ src: `/brand/${f}`, sizes, type: "image/png" }));
  return c.json({ name, short_name: name.split(" ")[0], start_url: "/", display: "standalone", background_color: "#fdf8ec", theme_color: "#fdf8ec", icons }, 200, { "content-type": "application/manifest+json" });
});
app.get("/chat.js", (c) => c.body(chatScript, 200, { "content-type": "application/javascript; charset=utf-8", "cache-control": "public, max-age=300" }));

app.get("/", async (c) => c.html(homePage(state, await safeVitals())));
app.get("/about", (c) => c.html(aboutPage(state)));
app.get("/sources", async (c) => c.html(sourcesPage(state, await safeVitals(), { mode: contactMode(), pending: await pendingFor("source") })));
app.get("/proposals", async (c) => c.html(proposalsPage(state, await pendingFor("proposal"))));
app.get("/correct", async (c) => c.html(correctPage(state, await pendingFor("correction"))));
const contactMode = (): "email" | "public" | "none" => (emailConfigured(state.cfg, state.repo) ? "email" : state.github.configured ? "public" : "none");
app.get("/contact", (c) => c.html(contactPage(state, contactMode())));
app.get("/stewards", async (c) => {
  let queue: QueueItem[] = []; let queueError: string | undefined;
  try { queue = (await cachedPrs("")).filter((p) => p.labels.some((l) => ["event", "correction", "proposal", "source", "log", "contact"].includes(l)) || /^(Event|Correction|Proposal|Source|Question log):/.test(p.title)); } catch (err) { queueError = (err as Error).message; }
  const week = isoWeek();
  const gh = await state.github.check();
  return c.html(stewardsPage(state, queue, queueError, {
    github: gh.ok, githubDetail: gh.detail, email: emailConfigured(state.cfg, state.repo), emailTo: stewardAddresses(state.cfg, state.repo),
    model: state.agent ? state.cfg.model : undefined, spent: state.budget.spent, limit: state.budget.limit,
    sha: state.repo.sha, built: state.lastBuild, loadErrors: state.loadErrors, log: state.log.all()[week] ?? {}, week,
  }));
});
app.post("/contact", async (c) => {
  const form = await c.req.parseBody();
  const mode = contactMode();
  if (String(form.website ?? "")) return c.html(contactPage(state, mode, { ok: "Thanks." }));
  const subject = String(form.subject ?? "").trim().slice(0, 140);
  const message = String(form.message ?? "").trim().slice(0, 4000);
  const reach = String(form.reach ?? "").trim().slice(0, 140);
  if (!subject || !message) return c.html(contactPage(state, mode, { error: "Subject and message are both needed." }));
  if (!state.limiter.allow("contact:" + clientIp(c))) return c.html(contactPage(state, mode, { error: "Too many in a row. Try again in a few minutes." }));
  try {
    if (mode === "email") {
      await emailStewards(state.cfg, state.repo, { subject: `Note from a neighbor: ${subject}`, text: `${message}\n\n${reach ? `How to reach them: ${reach}\n\n` : "They didn't leave a way to reach them.\n\n"}Sent from the contact page.`, replyTo: /@/.test(reach) ? reach : undefined });
    } else if (mode === "public") {
      await state.github.openIssue({ title: subject, body: `${message}\n\n${reach ? `Reach: ${reach}\n\n` : ""}_Sent from the contact page._`, labels: ["contact"] });
    } else {
      return c.html(contactPage(state, mode));
    }
    return c.html(contactPage(state, mode, { ok: "A steward will see it soon." }));
  } catch (err) {
    console.error("[contact]", err);
    return c.html(contactPage(state, mode, { error: "That didn't go through. Try again in a little while." }));
  }
});

/* The place pack: the neighborhood's public data for other tools (see src/place/pack.ts). */
const CORS = { "access-control-allow-origin": "*", "access-control-allow-methods": "GET, POST, OPTIONS", "access-control-allow-headers": "content-type, mcp-protocol-version, mcp-session-id, accept", "access-control-max-age": "86400" };
const packReads = new RateLimiter(300);
const packWrites = new RateLimiter(5, 60 * 60 * 1000);
const siteBase = (c: Context) => (state.cfg.siteUrl ?? new URL(c.req.url).origin).replace(/\/$/, "");
for (const p of ["/place.json", "/mcp"]) app.options(p, (c) => c.body(null, 204, CORS));
app.get("/place.json", async (c) => c.json(await placePack(state, siteBase(c)), 200, { ...CORS, "cache-control": "public, max-age=300" }));
app.get("/mcp", (c) => c.json({ name: "knowy-place-pack", version: PACK_VERSION, transport: "POST JSON-RPC 2.0 here (initialize, tools/list, tools/call). No auth.", tools: mcpTools.map((t) => t.name), about: `${siteBase(c)}/place.json` }, 200, CORS));
app.post("/mcp", async (c) => {
  if (!packReads.allow(clientIp(c))) return c.json({ jsonrpc: "2.0", id: null, error: { code: -32000, message: "Too many requests. Try again in a few minutes." } }, 429, CORS);
  let body: unknown;
  try { body = await c.req.json(); } catch { return c.json({ jsonrpc: "2.0", id: null, error: { code: -32700, message: "Parse error" } }, 400, CORS); }
  const deps = { state, base: siteBase(c), send: (d: Draft) => sendToStewards(d), allowWrite: () => packWrites.allow(clientIp(c)) };
  if (Array.isArray(body)) {
    const out = (await Promise.all(body.slice(0, 20).map((m) => handleRpc(m, deps)))).filter(Boolean);
    return out.length ? c.json(out, 200, CORS) : c.body(null, 202, CORS);
  }
  const res = await handleRpc(body as Parameters<typeof handleRpc>[0], deps);
  return res ? c.json(res, 200, CORS) : c.body(null, 202, CORS);
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
        onDraft: (d) => void send("draft", { id: d.id, kind: d.kind, summary: d.summary, token: signDraft(d) }),
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
  if (await sendToStewards(draft)) { drafts.delete(draft.id); return c.json({ ok: true }); }
  return c.json({ error: "I couldn't reach the stewards just now. Try again in a little while, or write to them on the contact page." });
});

/** The sources page form: suggest a link or upload a file for Knowy to read. */
app.post("/suggest", async (c) => {
  const mode = contactMode();
  const page = async (result: { ok?: string; error?: string }) => c.html(sourcesPage(state, await safeVitals(), { mode, pending: await pendingFor("source"), result }));
  let form: Record<string, string | File>;
  try { form = (await c.req.parseBody()) as Record<string, string | File>; } catch { return page({ error: "That didn't come through. If you attached a file, it may be too big (4 MB at most)." }); }
  if (String(form.website ?? "")) return page({ ok: "Thanks." });
  if (!state.limiter.allow("suggest:" + clientIp(c))) return page({ error: "Too many in a row. Try again in a few minutes." });
  const url = String(form.url ?? "").trim().slice(0, 500);
  const what = String(form.what ?? "").trim().slice(0, 2000);
  const upload = form.file instanceof File && form.file.size > 0 ? form.file : undefined;
  if (!url && !upload) return page({ error: "Add a link or a file." });
  if (url && !/^(https?|webcal):\/\//i.test(url)) return page({ error: "The link should start with https://." });
  if (!what) return page({ error: "Say a little about what it is." });
  let attachment: Attachment | undefined;
  if (upload) {
    if (mode !== "email") return page({ error: "Files can't be sent from here yet. Share a link instead." });
    if (upload.size > MAX_UPLOAD_BYTES) return page({ error: "That file is too big (4 MB at most). Share a link instead." });
    if (!ALLOWED_UPLOAD.test(upload.name)) return page({ error: "That kind of file can't be sent. A PDF, Word doc, spreadsheet, CSV, or text file works." });
    attachment = { filename: upload.name.replace(/[^\w.\- ]+/g, "_").slice(0, 120), content: Buffer.from(await upload.arrayBuffer()) };
  }
  const draft = makeDraft({
    kind: "source",
    ask: `${what}${url ? ` (${url})` : ""}`,
    fields: { url, file: attachment?.filename, title: String(form.title ?? "").trim().slice(0, 120), what, kept_by: String(form.kept_by ?? "").trim().slice(0, 200), ok_to_share: String(form.ok_to_share ?? "").trim().slice(0, 80), updates: String(form.updates ?? "").trim().slice(0, 80), suggested_by: String(form.reach ?? "").trim() ? "a neighbor (left a way to reach them)" : "a neighbor" },
  });
  const reach = String(form.reach ?? "").trim().slice(0, 140);
  if (await sendToStewards(draft, attachment, reach)) return page({ ok: "Thank you. A steward will look at it and decide how Knowy should use it." });
  return page({ error: "That didn't go through. Try again in a little while, or write to the stewards on the contact page." });
});

/**
 * Neighbors only ever hear "sent". Stewards get a pull request when GitHub is connected, and an
 * email either way; without the pull request, the email carries everything plus a one-click add.
 * Uploaded files and contact details travel by email only, never into the public repo.
 */
async function sendToStewards(draft: Draft, attachment?: Attachment, reach?: string): Promise<boolean> {
  let prUrl: string | undefined; let prError: string | undefined;
  if (state.github.configured) {
    try { prUrl = (await state.github.openPr({ path: draft.path, content: draft.content, title: draft.title, body: draft.body, labels: draft.labels, base: state.cfg.dataRepoBranch })).url; }
    catch (err) { prError = (err as Error).message; console.error("[send] pull request", err); }
  }
  let emailed = false;
  if (emailConfigured(state.cfg, state.repo)) {
    const addUrl = `${state.github.repoUrl}/new/${state.cfg.dataRepoBranch}?filename=${encodeURIComponent(draft.path)}&value=${encodeURIComponent(draft.content)}`;
    const noun = { event: "New event", correction: "Correction", proposal: "Proposal", source: "Suggested source" }[draft.kind];
    const lines = [
      `A neighbor sent this through Knowy.`, "", ...draft.summary.map(([k, v]) => `${k}: ${v}`), "", `In their words: ${draft.ask}`,
      ...(reach ? ["", `How to reach them (not stored anywhere public): ${reach}`] : []),
      ...(attachment ? ["", `Attached: ${attachment.filename}. It's only in this email.`] : []),
      ...(draft.hint ? ["", `How to bring it in: ${draft.hint}`] : []),
      "", prUrl ? `Review and merge: ${prUrl}` : `GitHub action needed. ${prError ? `The pull request couldn't be opened (${prError}).` : "The GitHub App isn't connected, so no pull request was opened."} Add it in one click (opens GitHub with the file filled in): ${addUrl}`,
      "", "The file:", `${draft.path}`, "", draft.content,
    ];
    try {
      await emailStewards(state.cfg, state.repo, { subject: `${noun} from a neighbor: ${draft.title.replace(/^(Event|Correction|Proposal|Source):\s*/, "")}${prUrl ? "" : " (GitHub action needed)"}`, text: lines.join("\n"), replyTo: reach && /@/.test(reach) ? reach : undefined, attachments: attachment ? [attachment] : undefined });
      emailed = true;
    } catch (err) { console.error("[send] email", err); }
  }
  return Boolean(prUrl || emailed);
}


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

async function pendingFor(label: string) {
  try { return (await cachedPrs(label)).map((p) => ({ title: p.title, created_at: p.created_at })); } catch { return []; }
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
