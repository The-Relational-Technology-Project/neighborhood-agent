import { beforeAll, describe, expect, it } from "vitest";
import os from "node:os";
import path from "node:path";
import fs from "node:fs/promises";
import { open, seal } from "../src/knowers/seal.js";
import { FileContactStore, ResendContactStore } from "../src/knowers/store.js";
import { makeDraft, verifyDraft, signDraft } from "../src/agent/drafts.js";
import { runTool } from "../src/agent/tools.js";
import { splitSections } from "../src/adapters/repo.js";
import { buildSystem } from "../src/agent/prompt.js";
import { QuestionLog } from "../src/agent/questionlog.js";
import type { Mail } from "../src/notify/email.js";
import { FIXTURE, loadFixture, tmpCache } from "./helpers.js";

beforeAll(() => { process.env.DRAFT_SECRET = "test-secret-for-sealed-links"; });

describe("sealed links", () => {
  it("round-trips, and fails closed on the wrong purpose, a changed token, or an old one", () => {
    const t = seal("offer", { email: "pat@example.org" }, 1000);
    expect(t).not.toContain("pat");
    expect(Buffer.from(t, "base64url").toString("latin1")).not.toContain("example.org");
    expect(open<{ email: string }>("offer", t)).toEqual({ email: "pat@example.org" });
    expect(open("stop", t)).toBeUndefined();
    expect(open("offer", t.slice(0, -2) + "AA")).toBeUndefined();
    expect(open("offer", t, Date.now() + 2000)).toBeUndefined();
    expect(open("offer", "junk")).toBeUndefined();
  });
});

describe("contact stores", () => {
  it("file store keeps, returns, and deletes a contact by opaque ref", async () => {
    const store = new FileContactStore(await tmpCache());
    const ref = await store.put({ name: "Pat", email: "pat@example.org" });
    expect(ref).toMatch(/^f_/);
    expect(ref).not.toContain("pat");
    expect(await store.get(ref)).toEqual({ ref, name: "Pat", email: "pat@example.org" });
    await store.remove(ref);
    expect(await store.get(ref)).toBeUndefined();
  });

  it("resend store creates new contacts outside broadcasts and never touches one that was already there", async () => {
    const calls: Array<{ method: string; url: string; body?: unknown }> = [];
    const existing = new Set(["old@example.org"]);
    const http = (async (url: string, init: RequestInit) => {
      calls.push({ method: init.method!, url, body: init.body ? JSON.parse(String(init.body)) : undefined });
      expect(new Headers(init.headers).get("user-agent")).toBeTruthy();
      if (init.method === "GET" && /contacts\/[^/]+%40/.test(url)) return existing.has(decodeURIComponent(url.split("/").pop()!)) ? Response.json({ id: "id-old" }) : new Response("{}", { status: 404 });
      if (init.method === "POST") return Response.json({ object: "contact", id: "id-new" });
      if (init.method === "GET") return Response.json({ id: "id-new", email: "new@example.org", first_name: "New" });
      return Response.json({ deleted: true });
    }) as unknown as typeof fetch;
    const store = new ResendContactStore("re_test", http);
    expect(await store.put({ name: "New", email: "new@example.org" })).toBe("r1_id-new");
    expect(calls.find((c) => c.method === "POST")?.body).toEqual({ email: "new@example.org", first_name: "New", unsubscribed: true });
    expect(await store.put({ name: "Old", email: "old@example.org" })).toBe("r0_id-old");
    expect(calls.filter((c) => c.method === "POST")).toHaveLength(1);
    expect(await store.get("r1_id-new")).toEqual({ ref: "r1_id-new", email: "new@example.org", name: "New" });
    await store.remove("r0_id-old");
    expect(calls.some((c) => c.method === "DELETE")).toBe(false);
    await store.remove("r1_id-new");
    expect(calls.filter((c) => c.method === "DELETE").map((c) => c.url)).toEqual(["https://api.resend.com/contacts/id-new"]);
  });
});

describe("the commons in the index", () => {
  it("splits a note into one record per section", async () => {
    expect(splitSections("Intro.\n\n## One\n\nA.\n\n## Two\n\nB.")).toEqual({ intro: "Intro.", parts: [{ heading: "One", text: "A." }, { heading: "Two", text: "B." }] });
    const { index } = await loadFixture();
    expect(index.get("repo:archive:the-mill")?.text).toContain("Burned in 1911");
    expect(index.get("repo:archive:the-mill:when-the-mill-was-built")).toMatchObject({ kind: "archive-note", title: "The old mill: When the mill was built" });
    expect(index.search("mill built redwood", { kinds: ["archive-note"] })[0].id).toBe("repo:archive:the-mill:when-the-mill-was-built");
  });

  it("indexes active knowers by description only, and what neighbors shared as their account", async () => {
    const { repo, index } = await loadFixture();
    const knowers = index.all().filter((r) => r.kind === "knower");
    expect(knowers.map((r) => r.id)).toEqual(["repo:knowers:a-neighbor-on-mill-road-f00d01"]);
    expect(JSON.stringify(knowers)).not.toContain("f_test-ref");
    expect(index.get("repo:knowledge:2026-02-01-the-old-ferry")?.text).toMatch(/A neighbor asked: Was there ever a ferry[\s\S]*Shared by a neighbor on Mill Road on 2026-02-01[\s\S]*neighbor's own account/);
    const system = buildSystem(repo)[0].text;
    expect(system).toContain("a neighbor on Mill Road since 1981: the old mill");
    expect(system).not.toContain("stepped back");
    expect(system).not.toContain("f_test-ref");
  });

  it("drafts knowledge and knower files; the knower file carries a ref and no contact", () => {
    const k = makeDraft({ kind: "knowledge", ask: "x", fields: { title: "The plum tree", what: "Planted in 1970 by the first family on the block.", how_known: "I was there" } }, "2026-03-01");
    expect(k.path).toBe("knowledge/2026-03-01-the-plum-tree.md");
    expect(k.content).toContain("shared_by: a neighbor");
    expect(verifyDraft(signDraft(k))?.kind).toBe("knowledge");
    const n = makeDraft({ kind: "knower", ask: "x", fields: { described_as: "a neighbor on 46th", knows: "Carville", ref: "r1_1234-abcdef" } }, "2026-03-01");
    expect(n.path).toBe("knowers/a-neighbor-on-46th-abcdef.md");
    expect(n.content).toContain("ref: r1_1234-abcdef");
    expect(n.labels).toEqual(["knower"]);
  });
});

describe("ask_a_neighbor tool", () => {
  it("hands the page a card with descriptions only, and refuses ids that aren't knowers", async () => {
    const { repo, index } = await loadFixture();
    const log = new QuestionLog(await fs.mkdtemp(path.join(os.tmpdir(), "ql-")));
    let card: unknown;
    const ctx = { repo, index, log, relay: true, onAsk: (a: unknown) => { card = a; } };
    const out = await runTool("ask_a_neighbor", { question: "What happened in the 1996 flood?", knower_ids: ["repo:knowers:a-neighbor-on-mill-road-f00d01"] }, ctx);
    expect(out).toContain("a neighbor on Mill Road since 1981");
    expect(card).toEqual({ question: "What happened in the 1996 flood?", to: [{ id: "repo:knowers:a-neighbor-on-mill-road-f00d01", label: "a neighbor on Mill Road since 1981", knows: "the old mill, the 1996 flood, where the herons nest" }] });
    expect(await runTool("ask_a_neighbor", { question: "What happened in the flood?", knower_ids: ["repo:people:pat-example"] }, ctx)).toContain("None of those ids");
    expect(await runTool("ask_a_neighbor", { question: "What happened in the flood?", knower_ids: [] }, { repo, index, log })).toContain("isn't set up");
  });
});

describe("the relay, end to end", () => {
  async function setup() {
    const { AppState } = await import("../src/state.js");
    const { createApp } = await import("../src/app.js");
    const { loadConfig } = await import("../src/config.js");
    const cacheDir = await tmpCache();
    const cfg = { ...loadConfig(), dataRepo: FIXTURE, cacheDir, siteUrl: "https://knowy.test", contactStore: "file", email: { apiKey: "re_test", from: "Knowy <k@example.org>", to: ["steward@example.org"] }, github: {} };
    const state = new AppState(cfg);
    await state.rebuild();
    const mail: Mail[] = [];
    state.mail = async (m) => { mail.push(m); };
    const app = createApp(state);
    (state as unknown as { ready: () => Promise<void> }).ready = async () => undefined;
    const form = (data: Record<string, string>) => ({ method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams(data).toString() });
    return { state, app, mail, form, cacheDir };
  }
  const linkIn = (text: string, p: string) => text.match(new RegExp(`https://knowy\\.test(${p}\\?t=[\\w-]+)`))![1];

  it("offer: nothing is stored until the neighbor confirms from their own email; then stewards get the public part only", async () => {
    const { state, app, mail, form, cacheDir } = await setup();
    const res = await app.request("/commons/offer", form({ name: "Pat Example", email: "Pat@Example.org", knows: "Carville and the car houses", described_as: "a neighbor on 47th since 1970" }));
    expect(await res.text()).toContain("Check your email");
    expect(mail).toHaveLength(1);
    expect(mail[0].to).toBe("pat@example.org");
    await expect(fs.access(path.join(cacheDir, "neighbor-contacts.json"))).rejects.toThrow();

    const confirm = linkIn(mail[0].text, "/commons/confirm");
    expect(confirm).not.toMatch(/pat|example/i);
    const shown = await (await app.request(confirm)).text();
    expect(shown).toContain("a neighbor on 47th since 1970");
    const done = await app.request("/commons/confirm", form({ t: confirm.split("t=")[1] }));
    expect(await done.text()).toContain("Thank you");

    const stored = JSON.parse(await fs.readFile(path.join(cacheDir, "neighbor-contacts.json"), "utf8"));
    const [ref] = Object.keys(stored);
    expect(stored[ref]).toEqual({ name: "Pat Example", email: "pat@example.org" });
    const toStewards = mail[1];
    expect(toStewards.to).toEqual(["steward@example.org"]);
    expect(toStewards.text).toContain("described_as: a neighbor on 47th since 1970");
    expect(toStewards.text).toContain(`ref: ${ref}`);
    expect(toStewards.text).not.toMatch(/Pat Example|pat@example\.org/);
    expect(state.repo.knowers.length).toBeGreaterThan(0);
  });

  it("ask with an email: the knower gets the question, reply-to is the asker, and the asker never sees an address", async () => {
    const { state, app, mail } = await setup();
    const { askCard } = await import("../src/knowers/routes.js");
    await fs.writeFile(path.join(state.cfg.cacheDir, "neighbor-contacts.json"), JSON.stringify({ "f_test-ref-1": { name: "Robin", email: "robin@example.org" } }));
    const card = askCard({ question: "What happened in the 1996 flood?", to: [{ id: "repo:knowers:a-neighbor-on-mill-road-f00d01", label: "x", knows: "y" }] });
    const res = await app.request("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify({ token: card.token, mode: "contact", name: "Sam", email: "sam@example.org" }) });
    const json = await res.json();
    expect(json).toEqual({ ok: true, to: "neighbor" });
    expect(JSON.stringify(json)).not.toContain("robin");
    expect(mail).toHaveLength(1);
    expect(mail[0]).toMatchObject({ to: "robin@example.org", replyTo: "sam@example.org" });
    expect(mail[0].text).toContain("What happened in the 1996 flood?");
    expect(mail[0].text).toContain("Sam, sam@example.org");
    expect(mail[0].text).toContain("/commons/stop?t=");

    // The knower shares the answer back into the commons.
    const answer = linkIn(mail[0].text, "/commons/answer");
    expect(await (await app.request(answer)).text()).toContain("What happened in the 1996 flood?");
    const post = await app.request("/commons/answer", { method: "POST", headers: { "content-type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ t: answer.split("t=")[1], what: "The river came up over Mill Road for three days in January.", how_known: "I sandbagged the mill" }).toString() });
    expect(await post.text()).toContain("gift to everyone");
    expect(mail[1].to).toEqual(["steward@example.org"]);
    expect(mail[1].text).toContain("knowledge/");
    expect(mail[1].text).toContain("shared_by: a neighbor on Mill Road since 1981");
    expect(mail[1].text).not.toContain("robin@example.org");
  });

  it("ask without an email: replies go to the stewards; a bad email is refused; no knower falls back to stewards", async () => {
    const { state, app, mail } = await setup();
    const { askCard } = await import("../src/knowers/routes.js");
    await fs.writeFile(path.join(state.cfg.cacheDir, "neighbor-contacts.json"), JSON.stringify({ "f_test-ref-1": { name: "Robin", email: "robin@example.org" }, "f_test-ref-2": { name: "Quiet", email: "quiet@example.org" } }));
    const ask = (body: object) => app.request("/api/ask", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
    const card = askCard({ question: "Where do the herons nest?", to: [{ id: "repo:knowers:a-neighbor-on-mill-road-f00d01", label: "x", knows: "y" }] });
    expect((await ask({ token: card.token, mode: "contact", email: "not-an-email" })).status).toBe(400);
    expect(await (await ask({ token: card.token, mode: "commons" })).json()).toEqual({ ok: true, to: "neighbor" });
    expect(mail[0]).toMatchObject({ to: "robin@example.org", replyTo: ["steward@example.org"] });
    expect(mail[0].text).toContain("didn't leave a way to reach them");

    const paused = askCard({ question: "When does the ferry run?", to: [{ id: "repo:knowers:paused-neighbor-f00d02", label: "x", knows: "y" }] });
    expect(await (await ask({ token: paused.token, mode: "commons" })).json()).toEqual({ ok: true, to: "stewards" });
    expect(mail[1].to).toEqual(["steward@example.org"]);
    expect((await ask({ token: "forged", mode: "commons" })).status).toBe(404);
  });

  it("stop: deletes the private contact and tells the stewards which note to remove", async () => {
    const { state, app, mail, form } = await setup();
    const file = path.join(state.cfg.cacheDir, "neighbor-contacts.json");
    await fs.writeFile(file, JSON.stringify({ "f_test-ref-1": { name: "Robin", email: "robin@example.org" } }));
    const t = seal("stop", { file: "a-neighbor-on-mill-road-f00d01.md", ref: "f_test-ref-1" }, 60_000);
    expect(await (await app.request(`/commons/stop?t=${t}`)).text()).toContain("Yes, stop");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toHaveProperty("f_test-ref-1");
    expect(await (await app.request("/commons/stop", form({ t }))).text()).toContain("deleted");
    expect(JSON.parse(await fs.readFile(file, "utf8"))).toEqual({});
    expect(mail[0].text).toContain("knowers/a-neighbor-on-mill-road-f00d01.md");
    expect(mail[0].text).not.toContain("robin");
  });

  it("serves the commons pages", async () => {
    const { app } = await setup();
    const home = await (await app.request("/commons")).text();
    expect(home).toContain("a neighbor on Mill Road since 1981");
    expect(home).not.toContain("stepped back");
    expect(home).not.toContain("f_test-ref");
    expect(await (await app.request("/commons/notes/the-mill")).text()).toContain("When the mill was built");
    expect(await (await app.request("/commons/shared/2026-02-01-the-old-ferry")).text()).toContain("cable ferry");
    expect((await app.request("/commons/notes/nope")).status).toBe(404);
  });
});

describe("block by block", () => {
  it("loads the grid and the pinned notes, and skips nothing that has a place", async () => {
    const { repo, index } = await loadFixture();
    expect(repo.blocks.map((b) => b.id)).toEqual(["main-1", "main-2", "second-main", "second-river", "mill-1"]);
    expect(repo.blockNotes.map((n) => n.id)).toEqual(["ferry-landing", "mill-photo", "floodplain", "far-away", "river-bank"]);
    expect(index.get("repo:blocks:ferry-landing")).toMatchObject({ kind: "block-note", location: "Main St & 2nd Ave" });
    expect(index.get("repo:blocks:ferry-landing")?.text).toContain("[Elsewhere Historical Society](https://example.org/history)");
  });

  it("finds a block, a corner, an id and a point; never needs a house number", async () => {
    const { resolveWhere } = await import("../src/blocks/geo.js");
    const { repo } = await loadFixture();
    expect(resolveWhere(repo.blocks, "Main Street between 1st and 2nd")).toMatchObject({ status: "block", label: "Main St, 1st Ave to 2nd Ave" });
    expect(resolveWhere(repo.blocks, "412 2nd Ave between Main and Mill")).toMatchObject({ status: "block", label: "2nd Ave, Main St to Mill Rd" });
    const corner = resolveWhere(repo.blocks, "2nd and Main");
    expect(corner.status).toBe("corner");
    expect(corner.lat).toBeCloseTo(45.0015, 3);
    expect(resolveWhere(repo.blocks, "main-2")).toMatchObject({ status: "block", label: "Main St, 2nd Ave to 3rd Ave" });
    expect(resolveWhere(repo.blocks, "45.00101, -120.00001")).toMatchObject({ status: "point" });
    expect(resolveWhere(repo.blocks, "Main St").status).toBe("vague");
    expect(resolveWhere(repo.blocks, "Elm Street").status).toBe("none");
    expect(resolveWhere(repo.blocks, "10.0, 10.0").status).toBe("none");
  });

  it("about_block gives the block's own line, what is pinned nearby with sources, photos by link, and what is true everywhere", async () => {
    const { repo, index } = await loadFixture();
    const ctx = { repo, index, log: new QuestionLog(await tmpCache()) };
    const out = await runTool("about_block", { where: "Main and 2nd" }, ctx);
    expect(out).toContain("About 12 feet above the river.");
    expect(out).toContain("Heights from the county survey.");
    expect(out).toContain("The ferry landing at Main and 2nd");
    expect(out).toContain("right here");
    expect(out).toContain("[Elsewhere Historical Society](https://example.org/history)");
    expect(out).toContain("https://example.org/photos/12");
    expect(out).toContain("County Library / 12");
    expect(out).not.toContain("undefined");
    expect(out).toContain("River silt under every street");
    expect(out).not.toContain("old quarry");
    expect(await runTool("about_block", { where: "Main St" }, ctx)).toContain("Never ask for a house number");
    // An area with a box applies inside it and not outside.
    expect(out).toContain("The river bank floods");
    expect(await runTool("about_block", { where: "Mill Rd between 1st and 2nd" }, ctx)).not.toContain("The river bank floods");
  });

  it("keeps photographs out of a general search but finds them when asked for block notes", async () => {
    const { index } = await loadFixture();
    expect(index.search("mill workers").some((r) => r.id === "repo:blocks:mill-photo")).toBe(false);
    expect(index.search("mill workers", { kinds: ["block-note"] })[0].id).toBe("repo:blocks:mill-photo");
    expect(index.search("ferry landing")[0].id).toBe("repo:blocks:ferry-landing");
  });

  it("a place with no blocks folder still works", async () => {
    const { repo, index } = await loadFixture();
    const bare = { ...repo, blocks: [], blockNotes: [] };
    expect(await runTool("about_block", { where: "Main and 2nd" }, { repo: bare, index, log: new QuestionLog(await tmpCache()) })).toContain("keeps no block-by-block notes");
    expect(buildSystem(bare).map((b) => b.text).join("\n")).toContain("None kept for this place.");
  });
});

describe("near me", () => {
  it("tells the model the block, not a point, and only when the neighbor shared one", async () => {
    const { repo } = await loadFixture();
    const plain = buildSystem(repo).map((b) => b.text).join("\n");
    expect(plain).not.toContain("chose to share roughly where they are");
    const withNear = buildSystem(repo, repo.blocks[0]);
    const last = withNear[withNear.length - 1].text;
    expect(last).toContain("Main St, 1st Ave to 2nd Ave (block id main-1)");
    expect(last).toContain("not necessarily where they live");
    expect(last).not.toMatch(/45\.\d+/);
    // The cached part of the prompt is the same with or without a location.
    expect(withNear[0].text).toBe(buildSystem(repo)[0].text);
  });

  it("the page script offers one visit or always, keeps only the block, and can be turned off", async () => {
    const { chatScript } = await import("../src/web/chat.js");
    expect(chatScript).toContain("Just this visit");
    expect(chatScript).toContain("Always on this device");
    expect(chatScript).toContain("Turn off");
    expect(chatScript).toContain("JSON.stringify({ id: res.id, label: res.label })");
    expect(chatScript).not.toMatch(/setItem\([^)]*(lat|coords)/);
  });
});
