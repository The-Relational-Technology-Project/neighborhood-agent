/**
 * Asking a neighbor, and giving to the commons.
 *
 *   offer    a neighbor fills in the form  -> a confirm link goes to their email (nothing stored yet)
 *   confirm  they click and say yes        -> name and email go to the private contact store; the
 *                                             public description goes to the stewards to review
 *   ask      a neighbor taps the card      -> the question is emailed to the knower; the asker's
 *                                             address travels only if they gave one, as reply-to
 *   answer   the knower follows the link   -> their answer goes to the stewards, then the commons
 *   stop     the knower follows the link   -> their contact is deleted
 *
 * The model never sees a name or an address, and neither does the data repo.
 */
import type { Context, Hono } from "hono";
import { isActiveKnower } from "../adapters/repo.js";
import { makeDraft, type Draft } from "../agent/drafts.js";
import { RateLimiter } from "../agent/budget.js";
import type { AskCard } from "../agent/tools.js";
import { emailStewards, stewardAddresses } from "../notify/email.js";
import type { AppState } from "../state.js";
import { answerPage, commonsPage, confirmOfferPage, linkPage, notePage, stopPage } from "../web/commons.js";
import { open, seal, sealReady } from "./seal.js";

const DAY = 24 * 60 * 60 * 1000;
const EMAIL = /^[^\s@<>"',;]+@[^\s@<>"',;]+\.[^\s@<>"',;]{2,}$/;
const one = (v: unknown, max: number) => String(v ?? "").replace(/[\r\n\t]+/g, " ").trim().slice(0, max);
const many = (v: unknown, max: number) => String(v ?? "").replace(/\r/g, "").trim().slice(0, max);

interface Offer { name: string; email: string; knows: string; described_as: string }
interface AskToken { q: string; ids: string[] }
interface AnswerToken { q: string; credit: string }
interface StopToken { file: string; ref: string }

export interface CommonsDeps {
  clientIp: (c: Context) => string;
  siteBase: (c: Context) => string;
  sendToStewards: (d: Draft) => Promise<boolean>;
  canSend: () => boolean;
}

/** Questions can be relayed when email is on and links can be sealed. */
export function relayOn(state: AppState): boolean {
  return Boolean(state.cfg.email.apiKey) && sealReady();
}

/** The card the chat shows, with the sealed list of who it may go to. */
export function askCard(a: AskCard): AskCard & { token: string } {
  return { ...a, token: seal("ask", { q: a.question, ids: a.to.map((t) => t.id) } satisfies AskToken, 2 * 60 * 60 * 1000) };
}

export function registerCommons(app: Hono, state: AppState, deps: CommonsDeps): void {
  const offers = new RateLimiter(3, 60 * 60 * 1000);
  const asks = new RateLimiter(4, 60 * 60 * 1000);
  const perKnower = new RateLimiter(6, DAY);
  const shares = new RateLimiter(5, 60 * 60 * 1000);
  const page = (c: Context, result?: { ok?: string; error?: string }) => c.html(commonsPage(state, { relay: relayOn(state), canSend: deps.canSend(), result }));
  const expired = (c: Context) => c.html(linkPage(state, "That link has expired", `<p class="sub">Links in Knowy's emails stop working after a while. <a href="/commons">Start again from the commons page</a>.</p>`), 410);
  const placeLine = () => (state.repo.placeMd.match(/^#\s+(.+)$/m)?.[1] ?? "the neighborhood").replace(/^The /, "the ");
  const agentName = () => state.repo.placeMd.match(/Working name:\s*\*\*(.+?)\*\*/)?.[1] ?? "The neighborhood agent";

  app.get("/commons", (c) => page(c));
  app.get("/commons/notes/:slug", (c) => {
    const doc = state.repo.archive.find((d) => d.file === `${c.req.param("slug")}.md`);
    return doc ? c.html(notePage(state, doc, "notes")) : c.notFound();
  });
  app.get("/commons/shared/:slug", (c) => {
    const doc = state.repo.knowledge.find((d) => d.file === `${c.req.param("slug")}.md`);
    return doc ? c.html(notePage(state, doc, "shared")) : c.notFound();
  });

  app.post("/commons/share", async (c) => {
    const form = await c.req.parseBody();
    if (String(form.website ?? "")) return page(c, { ok: "Thank you." });
    const what = many(form.what, 4000);
    const title = one(form.title, 120);
    if (!title || what.length < 20) return page(c, { error: "Say what it's about, and a few sentences of what you know." });
    if (!shares.allow(deps.clientIp(c))) return page(c, { error: "Too many in a row. Try again in a little while." });
    const draft = makeDraft({ kind: "knowledge", ask: what.slice(0, 400), fields: { title, what, how_known: one(form.how_known, 200), shared_by: one(form.shared_by, 100) } });
    return (await deps.sendToStewards(draft)) ? page(c, { ok: "Thank you. A steward will read it, and then it's part of what the neighborhood knows." }) : page(c, { error: "That didn't go through. Try again in a little while." });
  });

  app.post("/commons/offer", async (c) => {
    if (!relayOn(state)) return page(c, { error: "This isn't switched on here yet." });
    const form = await c.req.parseBody();
    const sent = { ok: "Check your email for a link to confirm. Nothing is saved until you click it." };
    if (String(form.website ?? "")) return page(c, sent);
    const o: Offer = { name: one(form.name, 80), email: one(form.email, 200).toLowerCase(), knows: one(form.knows, 400), described_as: one(form.described_as, 100) || "a neighbor" };
    if (!o.name || !EMAIL.test(o.email)) return page(c, { error: "A name and a working email are both needed. They stay private." });
    if (o.knows.length < 8) return page(c, { error: "Say a little about what neighbors could ask you." });
    if (!offers.allow(deps.clientIp(c)) || !offers.allow(o.email)) return page(c, { error: "Too many in a row. Try again in a little while." });
    const link = `${deps.siteBase(c)}/commons/confirm?t=${seal("offer", o, 3 * DAY)}`;
    try {
      await state.mail({
        to: o.email,
        subject: `Confirm: neighbors can ask you (${agentName()})`,
        text: [`Hi ${o.name},`, "", `Someone, hopefully you, offered to be a neighbor that others in ${placeLine()} can ask about:`, "", `  ${o.knows}`, "", `To confirm, open this link (good for three days):`, link, "", "If this wasn't you, do nothing. Nothing has been saved, and you won't hear from us again.", "", agentName()].join("\n"),
      });
    } catch (err) {
      console.error("[offer] email", err);
      return page(c, { error: "That email couldn't be sent. Check the address and try again." });
    }
    return page(c, sent);
  });

  app.get("/commons/confirm", (c) => {
    const t = c.req.query("t");
    const o = open<Offer>("offer", t);
    return o ? c.html(confirmOfferPage(state, t!, o)) : expired(c);
  });
  app.post("/commons/confirm", async (c) => {
    const o = open<Offer>("offer", String((await c.req.parseBody()).t ?? ""));
    if (!o) return expired(c);
    try {
      const ref = await state.contacts.put({ name: o.name, email: o.email });
      const draft = makeDraft({ kind: "knower", ask: o.knows, fields: { described_as: o.described_as, knows: o.knows, ref } });
      if (!(await deps.sendToStewards(draft))) throw new Error("could not reach the stewards");
    } catch (err) {
      console.error("[confirm]", err);
      return c.html(linkPage(state, "That didn't go through", `<p class="sub">Something went wrong on Knowy's side. Try the link again in a little while, or <a href="/contact">write to the stewards</a>.</p>`), 502);
    }
    return c.html(linkPage(state, "Thank you", `<p class="sub">A steward will read your description. After that, when a neighbor's question fits, it will come to you by email. Answer when you'd like to; there's never an obligation.</p>`));
  });

  app.post("/api/ask", async (c) => {
    let body: { token?: string; question?: string; mode?: string; name?: string; email?: string };
    try { body = await c.req.json(); } catch { return c.json({ error: "Bad request." }, 400); }
    const t = open<AskToken>("ask", body.token);
    if (!t || !relayOn(state)) return c.json({ error: "That expired. Ask again and I'll set it up." }, 404);
    const question = many(body.question ?? t.q, 1000);
    if (question.length < 8) return c.json({ error: "The question is empty." }, 400);
    const withContact = body.mode === "contact";
    const asker = { name: one(body.name, 80) || "A neighbor", email: one(body.email, 200) };
    if (withContact && !EMAIL.test(asker.email)) return c.json({ error: "That email doesn't look right. Fix it, or send without it." }, 400);
    if (!asks.allow(deps.clientIp(c))) return c.json({ error: "That's a lot of questions in an hour. Try again later." }, 429);

    const base = deps.siteBase(c);
    const stewards = stewardAddresses(state.cfg, state.repo);
    const compose = (hello: string, about: string, credit: string, stop?: string) => [
      `Hi${hello ? ` ${hello}` : ""},`, "",
      `A neighbor in ${placeLine()} asked ${agentName()} something${about ? ` you offered to help with (${about})` : " nobody in the notes could answer yet"}.`, "",
      "Their question:", "", question.split("\n").map((l) => `  ${l}`).join("\n"), "",
      withContact
        ? `They'd be glad to hear from you: ${asker.name}, ${asker.email}. Reply to this email and it goes straight to them, not to ${agentName()}. (That address is as they typed it; nobody has checked it.)`
        : "They didn't leave a way to reach them. They asked that the answer be shared with the whole neighborhood instead.", "",
      `${withContact ? "If you're willing, also share" : "Share"} what you know with the neighborhood, so the next person who asks can find it. A steward reads it first:`,
      `${base}/commons/answer?t=${seal("answer", { q: question, credit } satisfies AnswerToken, 90 * DAY)}`, "",
      "Don't know, or not up for it? No need to do anything.",
      ...(stop ? ["", `Stop getting these: ${stop}`] : []), "", agentName(),
    ].join("\n");
    const subject = `A neighbor's question: ${question.replace(/\s+/g, " ").slice(0, 70)}`;
    const replyTo = withContact ? asker.email : stewards;

    let sent = 0;
    for (const id of t.ids) {
      const file = id.replace(/^repo:knowers:/, "") + ".md";
      const k = state.repo.knowers.find((d) => d.file === file);
      if (!k || !isActiveKnower(k) || !perKnower.allow(file)) continue;
      try {
        const ref = String(k.data.ref);
        const contact = await state.contacts.get(ref);
        if (!contact) continue;
        const stop = `${base}/commons/stop?t=${seal("stop", { file, ref } satisfies StopToken, 3650 * DAY)}`;
        await state.mail({ to: contact.email, subject, text: compose(contact.name, String(k.data.knows ?? ""), String(k.data.described_as ?? "a neighbor"), stop), replyTo });
        sent++;
      } catch (err) { console.error("[ask] relay", err); }
    }
    if (sent) return c.json({ ok: true, to: "neighbor" });
    // Nobody to pass it to (or they've gone quiet): the stewards look for someone who knows.
    try {
      await emailStewards(state.cfg, state.repo, { subject, text: compose("stewards", "", "a neighbor"), replyTo: withContact ? asker.email : undefined }, state.mail);
      return c.json({ ok: true, to: "stewards" });
    } catch (err) {
      console.error("[ask] stewards", err);
      return c.json({ error: "I couldn't send that just now. Try again in a little while." }, 502);
    }
  });

  app.get("/commons/answer", (c) => {
    const t = c.req.query("t");
    const a = open<AnswerToken>("answer", t);
    return a ? c.html(answerPage(state, t!, { question: a.q, credit: a.credit })) : expired(c);
  });
  app.post("/commons/answer", async (c) => {
    const form = await c.req.parseBody();
    const token = String(form.t ?? "");
    const a = open<AnswerToken>("answer", token);
    if (!a) return expired(c);
    if (String(form.website ?? "")) return c.html(linkPage(state, "Thank you", ""));
    const what = many(form.what, 4000);
    if (what.length < 20) return c.html(answerPage(state, token, { question: a.q, credit: a.credit }, "A few sentences, please."));
    if (!shares.allow(deps.clientIp(c))) return c.html(answerPage(state, token, { question: a.q, credit: a.credit }, "Too many in a row. Try again in a little while."));
    const draft = makeDraft({ kind: "knowledge", ask: a.q, fields: { title: a.q.replace(/\s+/g, " ").slice(0, 110), question: a.q, what, how_known: one(form.how_known, 200), shared_by: one(form.shared_by, 100) || a.credit } });
    if (!(await deps.sendToStewards(draft))) return c.html(answerPage(state, token, { question: a.q, credit: a.credit }, "That didn't go through. Try again in a little while."));
    return c.html(linkPage(state, "Thank you", `<p class="sub">That's a gift to everyone who asks after this. A steward will read it, and then it's part of what the neighborhood knows.</p>`));
  });

  app.get("/commons/stop", (c) => {
    const t = c.req.query("t");
    return open<StopToken>("stop", t) ? c.html(stopPage(state, t!)) : expired(c);
  });
  app.post("/commons/stop", async (c) => {
    const s = open<StopToken>("stop", String((await c.req.parseBody()).t ?? ""));
    if (!s) return expired(c);
    try { await state.contacts.remove(s.ref); } catch (err) {
      console.error("[stop]", err);
      return c.html(linkPage(state, "That didn't go through", `<p class="sub">Try the link again in a little while, or <a href="/contact">write to the stewards</a> and they'll do it by hand.</p>`), 502);
    }
    // No address left to send to, so questions stop now. The public note comes down when a steward removes it.
    const note = `A neighbor asked to stop being asked. Their private contact is already deleted, so nothing more will reach them.\n\nPlease remove knowers/${s.file} from the data repo (or set status: left), so Knowy stops offering them.`;
    try { await emailStewards(state.cfg, state.repo, { subject: `Remove a neighbor from the ask list: ${s.file}`, text: note }, state.mail); } catch { /* best effort */ }
    if (state.github.configured) state.github.openIssue({ title: `Remove knowers/${s.file}`, body: note, labels: ["knower"] }).catch(() => undefined);
    return c.html(linkPage(state, "Done", `<p class="sub">You won't get any more questions, and your name and email are deleted. Thank you for what you gave.</p>`));
  });
}
