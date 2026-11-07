import { describe, expect, it } from "vitest";
import { createHmac } from "node:crypto";
import { composeReply, handleInbound, htmlToText, resetEmailState, shouldIgnore, splitQuoted, toPlainText, verifySvix, type ReceivedEmail } from "../src/channels/email.js";
import { makeDraft } from "../src/agent/drafts.js";
import { FIXTURE, tmpCache } from "./helpers.js";

const SECRET = "whsec_" + Buffer.from("a-very-secret-key-of-32-bytes!!!").toString("base64");
function sign(body: string, id = "msg_1", ts = String(Math.floor(Date.now() / 1000))) {
  const sig = createHmac("sha256", Buffer.from(SECRET.slice(6), "base64")).update(`${id}.${ts}.${body}`).digest("base64");
  return { id, timestamp: ts, signature: `v1,${sig}` };
}

describe("webhook signatures", () => {
  it("accepts a correct Svix signature and rejects tampering, replay, and a missing secret", () => {
    const body = '{"type":"email.received","data":{"email_id":"e1"}}';
    const h = sign(body);
    expect(verifySvix(SECRET, body, h)).toBe(true);
    expect(verifySvix(SECRET, body + " ", h)).toBe(false);
    expect(verifySvix(SECRET, body, { ...h, signature: "v1,AAAA" })).toBe(false);
    expect(verifySvix(SECRET, body, { ...h, signature: `v0,${h.signature.slice(3)} ${h.signature}` })).toBe(true);
    expect(verifySvix(SECRET, body, sign(body, "msg_1", String(Math.floor(Date.now() / 1000) - 600)))).toBe(false);
    expect(verifySvix(undefined, body, h)).toBe(false);
    expect(verifySvix("whsec_other", body, h)).toBe(false);
  });
});

describe("reading mail", () => {
  it("keeps the new text and separates the quoted thread", () => {
    const { fresh, quoted } = splitQuoted("Thanks! What about weekends?\n\nOn Sat, Nov 7, 2026 at 9:02 AM Knowy <knowy@example.org> wrote:\n> The market is Sundays.\n> Source: outersunset.us");
    expect(fresh).toBe("Thanks! What about weekends?");
    expect(quoted).toContain("The market is Sundays.");
    expect(splitQuoted("Hi\n\n-- \nJosh\n415").fresh).toBe("Hi");
    expect(splitQuoted("Just this").quoted).toBe("");
    expect(splitQuoted("New\n\nFrom: Someone\nSent: Monday\nOld body").fresh).toBe("New");
  });

  it("turns html into readable text", () => {
    expect(htmlToText("<div>Hi<br>there</div><p>Is the <b>library</b> open &amp; free?</p><style>p{}</style>")).toBe("Hi\nthere\nIs the library open & free?");
  });

  it("ignores its own mail, bounces, auto-replies, lists, and spoofed senders", () => {
    const base: ReceivedEmail = { id: "1", from: "neighbor@example.com", to: ["knowy@example.org"], subject: "Hours?" };
    expect(shouldIgnore(base, "knowy@example.org")).toBeUndefined();
    expect(shouldIgnore({ ...base, from: "Knowy <knowy@example.org>" }, "knowy@example.org")).toBe("from ourselves");
    expect(shouldIgnore({ ...base, from: "mailer-daemon@googlemail.com" }, "knowy@example.org")).toMatch(/no-reply or bounce/);
    expect(shouldIgnore({ ...base, headers: { "Auto-Submitted": "auto-replied" } }, "knowy@example.org")).toBe("auto-submitted");
    expect(shouldIgnore({ ...base, headers: { Precedence: "bulk" } }, "knowy@example.org")).toBe("bulk or list mail");
    expect(shouldIgnore({ ...base, headers: { "List-Id": "x" } }, "knowy@example.org")).toBe("list mail");
    expect(shouldIgnore({ ...base, subject: "Automatic reply: Hours?" }, "knowy@example.org")).toBe("an automatic reply");
    expect(shouldIgnore({ ...base, authentication: { spf: "fail", dkim: "fail" } }, "knowy@example.org")).toBe("failed sender authentication");
    expect(shouldIgnore({ ...base, authentication: { spf: "pass", dkim: "fail" } }, "knowy@example.org")).toBeUndefined();
  });
});

describe("writing mail", () => {
  it("flattens markdown to plain text with links in parentheses", () => {
    expect(toPlainText("The market is Sundays ([outersunset.us](https://outersunset.us)).\n\n- **Black Bird** has the corkboard\n- [https://andytownsf.com](https://andytownsf.com)")).toBe("The market is Sundays (https://outersunset.us).\n\n- Black Bird has the corkboard\n- https://andytownsf.com");
  });

  it("adds a confirm link for each draft and a plain footer", () => {
    const d = makeDraft({ kind: "event", ask: "add my block party", fields: { title: "Block party", date: "2026-12-06", start: "14:00", place: "48th and Judah", description: "Bring a chair." } });
    const text = composeReply("Happy to. I've written it up.", [d], "https://knowy.org", "Knowy", "The Outer Sunset");
    expect(text).toContain("Happy to. I've written it up.");
    expect(text).toMatch(/https:\/\/knowy\.org\/confirm\?token=[\w%.-]+/);
    expect(text).toContain('tap "Yes, send it"');
    expect(text).toContain("the Outer Sunset neighborhood's agent");
    expect(text).toContain("https://knowy.org/about");
    expect(composeReply("Sundays.", [], "https://knowy.org", "Knowy", "Elsewhere")).not.toContain("confirm?token");
  });
});

describe("an email arriving", () => {
  async function stateWithStubAgent(answer: string, draft?: ReturnType<typeof makeDraft>) {
    const { AppState } = await import("../src/state.js");
    const cfg = { ...(await import("../src/config.js")).loadConfig(), dataRepo: FIXTURE, cacheDir: await tmpCache(), anthropicConfigured: false };
    cfg.email = { ...cfg.email, apiKey: "re_test", inbox: "knowy@example.org", from: "Knowy <knowy@example.org>", webhookSecret: SECRET };
    const state = new AppState(cfg);
    await state.init();
    const calls: Array<{ name: string; input: unknown }> = [];
    state.agent = {
      client: undefined,
      respond: async (_history: unknown, tools: { onDraft?: (d: unknown) => void }, ev: { onTool?: (n: string, i: unknown) => void }) => {
        ev.onTool?.("search_data", { query: "market" });
        if (draft) tools.onDraft?.(draft);
        return { text: answer, tools_used: ["search_data"], drafts: draft ? [draft] : [], stop_reason: "end_turn", usage: { input_tokens: 10, output_tokens: 10 } };
      },
    } as never;
    return { state, calls };
  }

  function resendMock(mail: Partial<ReceivedEmail>) {
    const sent: Array<Record<string, unknown>> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const u = String(url);
      if (u.includes("/emails/receiving/")) return new Response(JSON.stringify({ id: "e1", from: "neighbor@example.com", to: ["knowy@example.org"], subject: "Market day?", text: "When is the farmers market?", message_id: "<abc@example.com>", ...mail }), { status: 200 });
      if (u.endsWith("/emails") && init?.method === "POST") { sent.push(JSON.parse(String(init.body))); return new Response('{"id":"sent1"}', { status: 200 }); }
      return new Response("not found", { status: 404 });
    }) as unknown as typeof fetch;
    return { fetchFn, sent };
  }

  const deps = (fetchFn: typeof fetch) => ({ fetchFn, base: "https://knowy.org", siteName: "Knowy", placeName: "Elsewhere" });

  it("answers in the thread from the inbox address, with sources flattened and a confirm link for a draft", async () => {
    resetEmailState();
    const draft = makeDraft({ kind: "event", ask: "add it", fields: { title: "Block party", date: "2026-12-06", start: "14:00", place: "48th", description: "x" } });
    const { state } = await stateWithStubAgent("Sundays at the river ([Elsewhere town calendar](https://elsewhere.example/cal)). I've written up your block party.", draft);
    const { fetchFn, sent } = resendMock({});
    const r = await handleInbound(state, { type: "email.received", data: { email_id: "e1" } }, "svix_1", deps(fetchFn));
    expect(r).toMatchObject({ status: "answered", to: "neighbor@example.com", subject: "Re: Market day?" });
    expect(sent).toHaveLength(1);
    expect(sent[0]).toMatchObject({ from: "Knowy <knowy@example.org>", to: ["neighbor@example.com"], subject: "Re: Market day?", headers: { "In-Reply-To": "<abc@example.com>", References: "<abc@example.com>" } });
    const text = String(sent[0].text);
    expect(text).toContain("Elsewhere town calendar (https://elsewhere.example/cal)");
    expect(text).toContain("https://knowy.org/confirm?token=");
    expect(text).toContain("I keep nothing between emails");
  });

  it("handles a retry once, skips auto-replies and other events, and refuses when unconfigured", async () => {
    resetEmailState();
    const { state } = await stateWithStubAgent("Sundays.");
    const { fetchFn, sent } = resendMock({});
    expect((await handleInbound(state, { type: "email.received", data: { email_id: "e1" } }, "svix_2", deps(fetchFn))).status).toBe("answered");
    expect((await handleInbound(state, { type: "email.received", data: { email_id: "e1" } }, "svix_2", deps(fetchFn)))).toMatchObject({ status: "ignored", detail: "already handled" });
    expect(sent).toHaveLength(1);
    expect((await handleInbound(state, { type: "email.delivered", data: { email_id: "e9" } }, "svix_3", deps(fetchFn))).status).toBe("ignored");
    const auto = resendMock({ subject: "Automatic reply: Market day?" });
    expect((await handleInbound(state, { type: "email.received", data: { email_id: "e1" } }, "svix_4", deps(auto.fetchFn)))).toMatchObject({ status: "ignored", detail: "an automatic reply" });
    expect(auto.sent).toHaveLength(0);
    state.cfg.email.inbox = undefined;
    expect((await handleInbound(state, { type: "email.received", data: { email_id: "e1" } }, "svix_5", deps(fetchFn))).status).toBe("error");
  });

  it("rate limits one sender and rests when the budget is spent", async () => {
    resetEmailState();
    const { state } = await stateWithStubAgent("Sundays.");
    const { fetchFn, sent } = resendMock({ from: "chatty@example.com" });
    let answered = 0, limited = 0;
    for (let i = 0; i < 8; i++) { const r = await handleInbound(state, { type: "email.received", data: { email_id: `e${i}` } }, `svix_c${i}`, deps(fetchFn)); if (r.status === "answered") answered++; if (r.status === "limited") limited++; }
    expect(answered).toBe(6);
    expect(limited).toBe(2);
    expect(sent).toHaveLength(6);
    (state.budget as unknown as { canSpend: () => boolean }).canSpend = () => false;
    const quiet = resendMock({ from: "another@example.com" });
    expect((await handleInbound(state, { type: "email.received", data: { email_id: "e-budget" } }, "svix_b", deps(quiet.fetchFn))).status).toBe("resting");
    expect(quiet.sent).toHaveLength(0);
  });

  it("serves the confirm page for a signed token and refuses a bad one", async () => {
    const { state } = await stateWithStubAgent("x");
    const { signDraft } = await import("../src/agent/drafts.js");
    const { confirmPage } = await import("../src/web/pages.js");
    const d = makeDraft({ kind: "correction", ask: "wrong hours", fields: { target: "Diner", field: "hours", now: "6 to 2", how_known: "I went" } });
    const page = confirmPage(state, d, { token: signDraft(d) });
    expect(page).toContain("Yes, send it");
    expect(page).toContain("Diner");
    expect(page).not.toContain("pull request");
    expect(confirmPage(state, undefined, {})).toContain("expired");
    expect(confirmPage(state, d, { token: "t", sent: true })).toContain("On its way");
  });
});
