import { describe, expect, it } from "vitest";
import type { Draft } from "../src/agent/drafts.js";

async function setup() {
  const { AppState } = await import("../src/state.js");
  const { FIXTURE, tmpCache } = await import("./helpers.js");
  const cfg = { ...(await import("../src/config.js")).loadConfig(), dataRepo: FIXTURE, cacheDir: await tmpCache() };
  const state = new AppState(cfg);
  await state.rebuild();
  const sent: Draft[] = [];
  let writes = 0;
  const deps = { state, base: "https://example.org", send: async (d: Draft) => { sent.push(d); return true; }, allowWrite: () => ++writes <= 2 };
  return { state, deps, sent };
}

describe("the place pack over MCP", () => {
  it("answers initialize, tools/list, and ignores notifications", async () => {
    const { handleRpc } = await import("../src/place/pack.js");
    const { deps } = await setup();
    const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize", params: { protocolVersion: "2025-06-18" } }, deps);
    expect((init?.result as { serverInfo: { name: string } }).serverInfo.name).toBe("knowy-place-pack");
    expect(await handleRpc({ jsonrpc: "2.0", method: "notifications/initialized" }, deps)).toBeUndefined();
    const list = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, deps);
    const names = (list?.result as { tools: { name: string }[] }).tools.map((t) => t.name);
    expect(names).toEqual(["about_place", "design_brief", "live_endpoints", "search", "list", "get", "about_block", "vital_signs", "city_311", "suggest_source"]);
    const bad = await handleRpc({ jsonrpc: "2.0", id: 3, method: "nope" }, deps);
    expect((bad?.error as { code: number }).code).toBe(-32601);
  });

  it("returns prose and structured records, and gets one by id", async () => {
    const { handleRpc } = await import("../src/place/pack.js");
    const { state, deps } = await setup();
    const any = state.index.all().find((r) => r.kind !== "correction" && r.kind !== "archive-note")!;
    const res = await handleRpc({ jsonrpc: "2.0", id: 4, method: "tools/call", params: { name: "list", arguments: { kind: any.kind, limit: 5 } } }, deps);
    const result = res?.result as { content: { text: string }[]; structuredContent: { records: { id: string; source: { name: string }; fetched_at: string }[] } };
    expect(result.content[0].text.length).toBeGreaterThan(0);
    expect(result.structuredContent.records.length).toBeGreaterThan(0);
    expect(result.structuredContent.records[0].source.name).toBeTruthy();
    const got = await handleRpc({ jsonrpc: "2.0", id: 5, method: "tools/call", params: { name: "get", arguments: { id: any.id } } }, deps);
    expect((got?.result as { structuredContent: { record: { id: string } } }).structuredContent.record.id).toBe(any.id);
  });

  it("describes the place with its rules and how to give back", async () => {
    const { placePack, rulesFor } = await import("../src/place/pack.js");
    const { state } = await setup();
    const pack = await placePack(state, "https://example.org");
    expect(pack.mcp.url).toBe("https://example.org/mcp");
    expect(pack.version).toBe(1);
    expect(pack.label).toBeTruthy();
    expect(pack.rules).toEqual(rulesFor(state, "https://example.org"));
    // A fork speaks in its own names: nothing of the first place leaks into another's pack.
    expect(pack.name).toBe("the Elsewhere Agent");
    expect(pack.rules[0]).toContain("via the Elsewhere Agent, Elsewhere neighbors");
    expect(pack.rules[0]).toContain("https://example.org/sources");
    expect(pack.rules.join(" ")).toContain("The river");
    expect(JSON.stringify(pack)).not.toMatch(/Outer Sunset|Plover\b|knowy\.org/);
    expect(pack.sources.every((s) => s.status !== "excluded")).toBe(true);
    expect(pack.contribute.feed_formats.map((f) => f.name)).toContain("Calendar (iCalendar)");
    expect(JSON.stringify(pack)).not.toMatch(/question/i);
  });

  it("keeps the first place's names out of another place's tools", async () => {
    const { handleRpc } = await import("../src/place/pack.js");
    const { deps } = await setup();
    const list = await handleRpc({ jsonrpc: "2.0", id: 2, method: "tools/list" }, deps);
    const init = await handleRpc({ jsonrpc: "2.0", id: 1, method: "initialize" }, deps);
    const said = JSON.stringify([list, init]);
    expect(said).not.toMatch(/Outer Sunset|Knowy Plover|46th|Judah|knowy\.org/);
    expect(said).toContain("Main St and 1st Ave");
    expect(said).toContain("the Elsewhere Agent");
  });

  it("gives a design brief: what's here, who to talk to, the block, the rules", async () => {
    const { handleRpc } = await import("../src/place/pack.js");
    const { deps } = await setup();
    const call = (args: Record<string, unknown>) => handleRpc({ jsonrpc: "2.0", id: 7, method: "tools/call", params: { name: "design_brief", arguments: args } }, deps);
    const empty = await call({ idea: " " });
    expect((empty?.result as { isError?: boolean }).isError).toBe(true);
    const res = await call({ idea: "an app to borrow a ladder or a drill from neighbors", where: "Main St and 1st Ave" });
    const result = res?.result as { content: { text: string }[]; structuredContent: { already_here: { title: string }[]; talk_to: { stewards: string }; block?: { found: boolean }; constituents: { name: string }[]; place_notes: { heading: string }[]; rules: string[] } };
    const brief = result.structuredContent;
    expect(brief.already_here.map((r) => r.title)).toContain("Elsewhere Tool Library");
    expect(brief.talk_to.stewards).toBe("https://example.org/contact");
    expect(brief.block?.found).toBe(true);
    expect(brief.constituents.map((c) => c.name)).toContain("The river");
    expect(brief.place_notes.map((n) => n.heading)).toContain("Voice");
    expect(brief.rules[0]).toContain("the Elsewhere Agent");
    expect(result.content[0].text).toMatch(/Talk to one of the people or groups below before you build/);
    expect(result.content[0].text).not.toMatch(/daily_note/);
    const lost = await call({ idea: "a sauna", where: "Nowhere Blvd and 99th" });
    expect((lost?.result as { content: { text: string }[] }).content[0].text).toMatch(/could not place/);
  });

  it("connects a brief to live data, and serves records as plain JSON", async () => {
    const { handleRpc, recordsJson, placePack } = await import("../src/place/pack.js");
    const { state, deps } = await setup();
    const call = async (name: string, args: Record<string, unknown>) => ((await handleRpc({ jsonrpc: "2.0", id: 8, method: "tools/call", params: { name, arguments: args } }, deps))?.result) as { content: { text: string }[]; structuredContent: Record<string, unknown> };
    const brief = await call("design_brief", { idea: "an app to borrow a ladder or a drill from neighbors" });
    const live = brief.structuredContent.live_data as { kind: string; url: string; sources: { name: string }[] }[];
    expect(live[0].kind).toBe("resource");
    expect(live[0].url).toMatch(/^https:\/\/example\.org\/records\.json\?kind=resource&q=/);
    expect(live[0].sources[0].name).toBeTruthy();
    const ends = await call("live_endpoints", { need: "tool library" });
    expect((ends.structuredContent.endpoints as { name: string }[]).map((e) => e.name)).toEqual(["records", "block", "place", "mcp"]);
    expect(ends.content[0].text).toContain("https://example.org/records.json?kind=resource");
    expect((await placePack(state, "https://example.org")).endpoints[0].url).toBe("https://example.org/records.json");

    const found = await recordsJson(state, { q: "ladder" });
    expect("records" in found && found.records.map((r) => r.title)).toContain("Elsewhere Tool Library");
    const listed = await recordsJson(state, { kind: "resource" });
    expect("records" in listed && listed.records.every((r) => r.kind === "resource")).toBe(true);
    expect(await recordsJson(state, { kind: "correction" })).toHaveProperty("error");
    expect(await recordsJson(state, {})).toHaveProperty("error");
    expect(await recordsJson(state, { kind: "event", on: "tomorrow" })).toHaveProperty("error");
  });

  it("sends a suggested feed to the stewards, checks it, and limits it", async () => {
    const { handleRpc } = await import("../src/place/pack.js");
    const { deps, sent } = await setup();
    const call = (args: Record<string, unknown>) => handleRpc({ jsonrpc: "2.0", id: 9, method: "tools/call", params: { name: "suggest_source", arguments: args } }, deps);
    const badUrl = await call({ url: "ftp://x", what: "x", ok_to_share: "yes" });
    expect((badUrl?.result as { isError?: boolean }).isError).toBe(true);
    const ok = await call({ url: "https://garden.example.org/events.ics", what: "Garden workdays", ok_to_share: "yes, all public", made_with: "a Relational Builder project" });
    expect((ok?.result as { isError?: boolean }).isError).toBeUndefined();
    expect(sent[0].kind).toBe("source");
    expect(sent[0].content).toContain("a tool built for the place (a Relational Builder project)");
    await call({ url: "https://a.example.org/feed", what: "x", ok_to_share: "yes" });
    const limited = await call({ url: "https://b.example.org/feed", what: "x", ok_to_share: "yes" });
    expect((limited?.result as { content: { text: string }[] }).content[0].text).toMatch(/Too many/);
  });
});
