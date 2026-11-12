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
    expect(names).toEqual(["about_place", "search", "list", "get", "about_block", "vital_signs", "city_311", "suggest_source"]);
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
    const { placePack, RULES } = await import("../src/place/pack.js");
    const { state } = await setup();
    const pack = await placePack(state, "https://example.org");
    expect(pack.mcp.url).toBe("https://example.org/mcp");
    expect(pack.version).toBe(1);
    expect(pack.label).toBeTruthy();
    expect(pack.rules).toEqual(RULES);
    expect(pack.sources.every((s) => s.status !== "excluded")).toBe(true);
    expect(pack.contribute.feed_formats.map((f) => f.name)).toContain("Calendar (iCalendar)");
    expect(JSON.stringify(pack)).not.toMatch(/question/i);
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
