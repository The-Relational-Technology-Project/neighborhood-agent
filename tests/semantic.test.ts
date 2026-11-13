import { describe, expect, it } from "vitest";
import type { NRecord } from "../src/data/types.js";

/** A stand-in for an embeddings service: three axes of meaning, so the test needs no network. */
const AXES = [/drill|borrow|lend|tool/i, /run|jog|5k|parkrun/i, /pizza|bakery|bread/i];
const fake = async (texts: string[]) => texts.map((t) => AXES.map((re) => (re.test(t) ? 1 : 0.01)));

const rec = (id: string, kind: NRecord["kind"], title: string, text: string): NRecord => ({ id, kind, title, text, source: { id: "repo", name: "The notes", url: "https://example.org" }, fetched_at: "2026-01-01T00:00:00Z" });
const records = [
  rec("a", "resource", "Sharing shed", "Neighbors lend each other a drill or a tent."),
  rec("b", "group", "Saturday parkrun", "A free 5k every week."),
  rec("c", "place", "Corner bakery", "Bread and a daily pizza."),
  rec("d", "resource", "Report a car blocking a driveway", "Somewhere to call when a car is in the way of the ladder truck."),
];

describe("search by meaning", () => {
  it("finds what words alone miss, and ranks it over a record that only shares a word", async () => {
    const { SearchIndex } = await import("../src/data/index.js");
    const { Semantic } = await import("../src/data/semantic.js");
    const index = new SearchIndex(records);
    expect(index.search("running club").map((r) => r.id)).not.toContain("b");
    expect(index.search("somewhere to borrow a ladder")[0].id).toBe("d");
    index.semantic = await Semantic.build(records, fake);
    expect((await index.find("running club"))[0].id).toBe("b");
    expect((await index.find("somewhere to borrow a ladder"))[0].id).toBe("a");
    // "close" drops the record that only shares a word.
    expect((await index.find("somewhere to borrow a ladder", { close: true })).map((r) => r.id)).toEqual(["a"]);
  });

  it("still finds a name typed exactly, and keeps the filters", async () => {
    const { SearchIndex } = await import("../src/data/index.js");
    const { Semantic } = await import("../src/data/semantic.js");
    const index = new SearchIndex(records);
    index.semantic = await Semantic.build(records, async (texts) => texts.map(() => [0, 0, 0.0001]));
    expect((await index.find("parkrun"))[0].id).toBe("b");
    expect((await index.find("parkrun", { close: true }))[0].id).toBe("b");
    index.semantic = await Semantic.build(records, fake);
    expect((await index.find("borrow a drill", { kinds: ["group"] })).every((r) => r.kind === "group")).toBe(true);
  });

  it("falls back to words when the embeddings service is down, and reuses cached vectors", async () => {
    const { SearchIndex } = await import("../src/data/index.js");
    const { Semantic } = await import("../src/data/semantic.js");
    const { tmpCache } = await import("./helpers.js");
    const cacheDir = await tmpCache();
    let calls = 0;
    const counting = async (texts: string[], as: "document" | "query") => { if (as === "document") calls += texts.length; return fake(texts); };
    await Semantic.build(records, counting, { cacheDir, model: "m" });
    await Semantic.build([...records, rec("e", "note", "New note", "pizza night")], counting, { cacheDir, model: "m" });
    expect(calls).toBe(records.length + 1);

    const index = new SearchIndex(records);
    index.semantic = await Semantic.build(records, async (texts, as) => { if (as === "query") throw new Error("down"); return fake(texts); });
    expect((await index.find("parkrun"))[0].id).toBe("b");
  });

  it("is off without a key, and on in the app state when an embedder is set", async () => {
    const { AppState } = await import("../src/state.js");
    const { FIXTURE, tmpCache } = await import("./helpers.js");
    const cfg = { ...(await import("../src/config.js")).loadConfig(), dataRepo: FIXTURE, cacheDir: await tmpCache() };
    const off = new AppState({ ...cfg, embed: { ...cfg.embed, apiKey: undefined } });
    await off.rebuild();
    expect(off.index.semantic).toBeUndefined();
    const on = new AppState({ ...cfg, embed: { ...cfg.embed, apiKey: undefined } });
    on.embedder = fake;
    await on.rebuild();
    await on.semanticReady;
    expect(on.index.semantic?.size).toBeGreaterThan(0);
    expect((await on.index.find("borrow a drill")).map((r) => r.title)).toContain("Elsewhere Tool Library");
  });
});
