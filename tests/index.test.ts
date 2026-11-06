import { describe, expect, it } from "vitest";
import { applyCorrections, SearchIndex } from "../src/data/index.js";
import { loadFixture } from "./helpers.js";

describe("index over the fixture repo", () => {
  it("loads repo and calendar sources without network", async () => {
    const { index, statuses } = await loadFixture();
    const byId = Object.fromEntries(statuses.map((s) => [s.id, s]));
    expect(byId.repo.records).toBeGreaterThan(5);
    expect(byId["town-calendar"].records).toBeGreaterThan(5);
    expect(byId["town-calendar"].error).toBeUndefined();
    expect(index.size).toBe(byId.repo.records + byId["town-calendar"].records);
  });

  it("finds the tool library for 'sharing tools' and the market for 'market'", async () => {
    const { index } = await loadFixture();
    const tools = index.search("tool library sharing", { kinds: ["resource", "person"] });
    expect(tools[0].title).toBe("Elsewhere Tool Library");
    const market = index.search("saturday market", { kinds: ["event"], upcoming: true });
    expect(market.length).toBeGreaterThan(0);
    expect(market[0].location).toBe("Main Street at the river");
    expect(market[0].source.name).toBe("Elsewhere town calendar");
  });

  it("applies repo corrections on top of place records and says so", async () => {
    const { index } = await loadFixture();
    const diner = index.search("diner", { kinds: ["place"] })[0];
    expect(diner.corrections).toHaveLength(1);
    expect(diner.text).toMatch(/Corrected by a neighbor on 2026-01-16: hours .*now "6am to 2pm, closed Mondays"/);
    const store = index.search("corner store", { kinds: ["place"] })[0];
    expect(store.corrections).toBeUndefined();
    expect(store.text).toContain("verified 2026-01-15");
  });

  it("matches corrections by record id prefix too", () => {
    const recs = [{ id: "src:events:1", kind: "event" as const, title: "X", text: "", source: { id: "src", name: "S", url: "u" }, fetched_at: "t" }];
    const out = applyCorrections(recs, [{ target: "src:events:1", field: "hours", now: "6", date: "2026-01-01", file: "f.md" }]);
    expect(out[0].corrections?.length).toBe(1);
    const miss = applyCorrections(recs, [{ target: "src:events:2", field: "hours", now: "6", date: "2026-01-01", file: "f.md" }]);
    expect(miss[0].corrections).toBeUndefined();
  });

  it("filters upcoming and ranks corrected records first", async () => {
    const { index } = await loadFixture();
    const all = index.byKind("event", { upcoming: true });
    expect(all.every((e) => !e.date || e.date >= "2026-01-01")).toBe(true);
    expect(all.some((e) => e.title === "River Day")).toBe(true);
    const empty = new SearchIndex([]);
    expect(empty.search("anything")).toEqual([]);
  });
});
