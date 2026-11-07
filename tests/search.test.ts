import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import path from "node:path";
import { SearchIndex, stem } from "../src/data/index.js";
import type { NRecord } from "../src/data/types.js";
import { runTool } from "../src/agent/tools.js";
import { HashEmbedder, HttpEmbedder, dot, makeEmbedder, normalize, type EmbedKind, type Embedder } from "../src/search/embed.js";
import { contentWords, rrf, semanticWeight, signals, yearIn } from "../src/search/fuse.js";
import { CHUNK_CHARS, chunksFor, DenseIndex, VectorStore } from "../src/search/vectors.js";
import { loadFixture, tmpCache } from "./helpers.js";

const src = { id: "repo", name: "Repo", url: "https://example.org" };
const rec = (id: string, kind: NRecord["kind"], title: string, text: string, extra: Partial<NRecord> = {}): NRecord =>
  ({ id: `repo:${kind}:${id}`, kind, title, text, source: src, fetched_at: "2026-11-07T00:00:00Z", ...extra });

/**
 * A stand-in for a real embedding model: each text maps to the concepts its words belong to, so
 * "toddler" and "kids" land on the same vector even though they share no letters.
 */
const CONCEPTS: Record<string, string> = {
  toddler: "kids", kid: "kids", kids: "kids", children: "kids", baby: "kids", parents: "kids", little: "kids", classes: "kids",
  rainy: "indoor", indoor: "indoor", inside: "indoor",
  faucet: "plumbing", leak: "plumbing", leaking: "plumbing", plumber: "plumbing", pipes: "plumbing",
  ocean: "sea", tide: "sea", surf: "sea", beach: "sea",
};
const AXES = ["kids", "indoor", "plumbing", "sea", "other"];
class ConceptEmbedder implements Embedder {
  id = "concept-test";
  minSimilarity = 0.3;
  calls: string[][] = [];
  async embed(texts: string[], _kind: EmbedKind): Promise<Float32Array[]> {
    this.calls.push(texts);
    return texts.map((t) => {
      const v = new Float32Array(AXES.length);
      for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) {
        const c = CONCEPTS[w];
        if (c) v[AXES.indexOf(c)] += 1;
      }
      if (!v.some(Boolean)) v[AXES.indexOf("other")] = 1;
      return normalize(v);
    });
  }
}

async function hybrid(records: NRecord[], embedder: Embedder = new ConceptEmbedder()) {
  const index = new SearchIndex(records);
  const store = new VectorStore(await tmpCache(), embedder);
  await store.load();
  const res = await store.ensure(index.all().flatMap(chunksFor));
  index.attachVectors(store);
  return { index, store, res };
}

describe("hash embedder", () => {
  it("is deterministic, unit length, and puts related spellings closer than unrelated text", async () => {
    const e = new HashEmbedder();
    const [a, b] = await e.embed(["tool library", "tool library"], "document");
    expect(Array.from(a)).toEqual(Array.from(b));
    expect(dot(a, a)).toBeCloseTo(1, 5);
    const [lib, lend, tide] = await e.embed(["tool library", "tool lending libary", "high tide at ocean beach"], "document");
    expect(dot(lib, lend)).toBeGreaterThan(dot(lib, tide));
    expect(dot(lib, tide)).toBeLessThan(0.3);
  });
});

describe("http embedder", () => {
  it("speaks the OpenAI shape, sends Voyage's input_type, batches, and normalizes", async () => {
    const seen: Array<{ url: string; body: Record<string, unknown>; auth: string | null }> = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      const body = JSON.parse(String(init?.body)) as { input: string[] };
      seen.push({ url: String(url), body, auth: new Headers(init?.headers).get("authorization") });
      return new Response(JSON.stringify({ data: body.input.map((_t, i) => ({ index: body.input.length - 1 - i, embedding: [3, 4].map((x) => x * (body.input.length - i)) })).reverse() }), { status: 200 });
    }) as typeof fetch;
    const e = new HttpEmbedder({ id: "t", url: "https://embed.test/v1/embeddings", model: "m", apiKey: "k", inputType: true, minSimilarity: 0.4, batch: 2, fetchFn });
    const out = await e.embed(["a", "b", "c"], "query");
    expect(seen.length).toBe(2);
    expect(seen[0].body).toMatchObject({ model: "m", input_type: "query", input: ["a", "b"] });
    expect(seen[0].auth).toBe("Bearer k");
    expect(out).toHaveLength(3);
    for (const v of out) expect(Math.hypot(...v)).toBeCloseTo(1, 5);
    // Results come back in index order even when the server shuffles them.
    expect(out[0][0]).toBeCloseTo(0.6, 5);
  });

  it("waits out a rate limit, honoring Retry-After, then succeeds", async () => {
    let calls = 0;
    const fetchFn = (async () => {
      calls++;
      if (calls < 3) return new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } });
      return new Response(JSON.stringify({ data: [{ index: 0, embedding: [1, 0] }] }), { status: 200 });
    }) as unknown as typeof fetch;
    const e = new HttpEmbedder({ id: "t", url: "https://embed.test", model: "m", apiKey: "k", inputType: false, minSimilarity: 0.4, fetchFn });
    const out = await e.embed(["a"], "document");
    expect(calls).toBe(3);
    expect(Array.from(out[0])).toEqual([1, 0]);
  });

  it("gives up on a rate limit after its attempts and says so", async () => {
    const fetchFn = (async () => new Response("slow down", { status: 429, headers: { "retry-after": "0.01" } })) as unknown as typeof fetch;
    const e = new HttpEmbedder({ id: "t", url: "https://embed.test", model: "m", apiKey: "k", inputType: false, minSimilarity: 0.4, fetchFn, maxAttempts: 2 });
    await expect(e.embed(["a"], "document")).rejects.toThrow(/429/);
  });

  it("surfaces an error status instead of inventing vectors", async () => {
    const fetchFn = (async () => new Response("nope", { status: 401 })) as unknown as typeof fetch;
    const e = new HttpEmbedder({ id: "t", url: "https://embed.test", model: "m", apiKey: "k", inputType: false, minSimilarity: 0.4, fetchFn });
    await expect(e.embed(["a"], "document")).rejects.toThrow(/401/);
  });

  it("is chosen by config: voyage with a key, nothing without, hash on request", () => {
    expect(makeEmbedder({ provider: "none" })).toBeUndefined();
    expect(makeEmbedder({ provider: "voyage" })).toBeUndefined();
    expect(makeEmbedder({ provider: "voyage", apiKey: "k" })?.id).toBe("voyage-voyage-3.5");
    expect(makeEmbedder({ provider: "openai", apiKey: "k", model: "x" })?.id).toBe("openai-x");
    expect(makeEmbedder({ provider: "hash" })?.id).toBe("hash-512");
  });
});

describe("chunks", () => {
  it("keeps short records whole and splits long ones with the header on every chunk", () => {
    const short = chunksFor(rec("a", "place", "Black Bird", "bookstore and cafe", { tags: ["books"], location: "Irving St" }));
    expect(short).toHaveLength(1);
    expect(short[0].text).toBe("place: Black Bird\ntags: books\nwhere: Irving St\nbookstore and cafe");
    const long = chunksFor(rec("b", "archive-note", "A long story", Array.from({ length: 60 }, (_, i) => `Sentence number ${i} about the neighborhood, with a bit more text to fill. `).join("")));
    expect(long.length).toBeGreaterThan(2);
    for (const c of long) { expect(c.text.startsWith("archive-note: A long story\n")).toBe(true); expect(c.text.length).toBeLessThan(CHUNK_CHARS + 200); }
    expect(new Set(long.map((c) => c.hash)).size).toBe(long.length);
  });
});

describe("vector store", () => {
  it("embeds only what is new, persists, and prunes what is gone", async () => {
    const dir = await tmpCache();
    const e = new ConceptEmbedder();
    const a = rec("a", "place", "Outer Village", "classes for parents and little kids");
    const b = rec("b", "recommendation", "River Plumbing", "fixes pipes and leaks");
    const store = new VectorStore(dir, e);
    await store.load();
    const first = await store.ensure([a, b].flatMap(chunksFor));
    expect(first).toMatchObject({ embedded: 2, total: 2 });
    expect(e.calls.flat()).toHaveLength(2);

    const again = await store.ensure([a, b].flatMap(chunksFor));
    expect(again).toMatchObject({ embedded: 0, total: 2 });
    expect(e.calls.flat()).toHaveLength(2);

    const c = rec("c", "event", "Beach cleanup", "tide and surf");
    const withNew = await store.ensure([a, b, c].flatMap(chunksFor));
    expect(withNew).toMatchObject({ embedded: 1, total: 3 });

    // A second process loads the same file and needs nothing embedded.
    const reloaded = new VectorStore(dir, new ConceptEmbedder());
    await reloaded.load();
    expect(reloaded.size).toBe(3);
    const pruned = await reloaded.ensure([a].flatMap(chunksFor));
    expect(pruned).toMatchObject({ embedded: 0, total: 1 });
    expect(reloaded.size).toBe(1);
    const onDisk = JSON.parse(await fs.readFile(path.join(dir, "embeddings", "concept-test.json"), "utf8")) as { embedder: string; vectors: Record<string, string> };
    expect(onDisk.embedder).toBe("concept-test");
    expect(Object.keys(onDisk.vectors)).toHaveLength(1);
  });

  it("keeps its vectors when the embedder fails and reports the error", async () => {
    const dir = await tmpCache();
    const good = new ConceptEmbedder();
    const a = rec("a", "place", "Outer Village", "classes for parents and little kids");
    const store = new VectorStore(dir, good);
    await store.ensure([a].flatMap(chunksFor));
    const failing: Embedder = { id: "concept-test", minSimilarity: 0.3, async embed() { throw new Error("quota"); } };
    const store2 = new VectorStore(dir, failing);
    await store2.load();
    const res = await store2.ensure([a, rec("b", "place", "New", "brand new")].flatMap(chunksFor));
    expect(res.error).toMatch(/quota/);
    expect(res.total).toBe(1);
    expect(store2.size).toBe(1);
  });

  it("ignores a store written by a different embedder", async () => {
    const dir = await tmpCache();
    const store = new VectorStore(dir, new ConceptEmbedder());
    await store.ensure([rec("a", "place", "X", "kids")].flatMap(chunksFor));
    const other = new VectorStore(dir, new HashEmbedder());
    await other.load();
    expect(other.size).toBe(0);
    expect(other.file).not.toBe(store.file);
  });

  it("dense search returns the best chunk per record above the floor", async () => {
    const e = new ConceptEmbedder();
    const store = new VectorStore(await tmpCache(), e);
    const recs = [rec("a", "place", "Outer Village", "classes for kids"), rec("b", "recommendation", "Plumber", "fixes a faucet"), rec("c", "note", "Minutes", "nothing in particular")];
    await store.ensure(recs.flatMap(chunksFor));
    const dense = new DenseIndex(recs, store);
    const [q] = await e.embed(["toddler"], "query");
    const hits = dense.search(q, { limit: 5, minSimilarity: 0.3 });
    expect(hits.map((h) => h.id)).toEqual(["repo:place:a"]);
    expect(dense.search(q, { limit: 5, minSimilarity: 0.3, allow: (id) => id !== "repo:place:a" })).toEqual([]);
  });
});

describe("fusion and signals", () => {
  it("rrf rewards appearing in both lists and respects weights", () => {
    const s = rrf([{ ids: ["a", "b", "c"] }, { ids: ["b", "d"] }]);
    expect(s.get("b")!).toBeGreaterThan(s.get("a")!);
    expect(s.get("a")!).toBeCloseTo(1 / 61, 6);
    expect(s.get("b")!).toBeCloseTo(1 / 62 + 1 / 61, 6);
    const w = rrf([{ ids: ["a"], weight: 2 }, { ids: ["b"] }]);
    expect(w.get("a")!).toBeCloseTo(2 / 61, 6);
  });

  it("discounts a meaning match near the floor and trusts one well above it", () => {
    expect(semanticWeight(0.4, 0.4)).toBeCloseTo(0.4, 5);
    expect(semanticWeight(0.55, 0.4)).toBeCloseTo(1, 5);
    expect(semanticWeight(0.5, 0.4)).toBeCloseTo(0.8, 5);
    expect(semanticWeight(0.9, 0.4)).toBe(1.5);
    expect(semanticWeight(0.9, 0.4, 1)).toBe(1);
    const w = rrf([{ ids: ["a", "b"], weights: [0.5, 1] }]);
    expect(w.get("a")!).toBeCloseTo(0.5 / 61, 6);
    expect(w.get("b")!).toBeCloseTo(1 / 62, 6);
  });

  it("drops stopwords and single letters from a query", () => {
    expect(contentWords("Where can I find a good plumber for my sink?")).toEqual(["plumber", "sink"]);
    expect(contentWords("the and a")).toEqual([]);
  });

  it("stems conservatively", () => {
    expect(["plumbers", "classes", "babies", "glass", "kids", "dad's", "tide", "is"].map(stem)).toEqual(["plumber", "class", "baby", "glass", "kid", "dad", "tide", "is"]);
  });

  it("reads years out of rec dates", () => {
    expect(yearIn("Nov '25")).toBe(2025);
    expect(yearIn("2024-03")).toBe(2024);
    expect(yearIn("last spring")).toBeUndefined();
  });

  it("lifts exact titles, corrections, vouches, and nearer events; marks old recs", () => {
    const today = "2026-11-07";
    const exact = signals(rec("a", "place", "Andytown Coffee", "coffee"), { query: "andytown coffee", today });
    expect(exact.why).toContain("exact title");
    const partial = signals(rec("a", "place", "Andytown Coffee Roasters", "coffee"), { query: "andytown", today });
    expect(partial.why).toContain("title");
    expect(partial.score).toBeLessThan(exact.score);
    const none = signals(rec("a", "place", "Black Bird", "coffee"), { query: "andytown", today });
    expect(none.why).toEqual([]);
    const corrected = signals(rec("a", "place", "Diner", "x", { corrections: [{ target: "x", field: "hours", now: "6", date: "2026-01-01", file: "f" }] }), { query: "pancakes", today });
    expect(corrected.why).toContain("corrected by a neighbor");
    const many = signals(rec("a", "recommendation", "Sonic", "isp", { extra: { vouches: 15, when: "Apr '26" } }), { query: "internet", today });
    const one = signals(rec("b", "recommendation", "Other ISP", "isp", { extra: { vouches: 1, when: "Apr '26" } }), { query: "internet", today });
    expect(many.score).toBeGreaterThan(one.score);
    const old = signals(rec("c", "recommendation", "Old Shop", "x", { extra: { vouches: 3, when: "Jun '23" } }), { query: "shop", today });
    expect(old.why).toContain("older rec");
    const soon = signals(rec("d", "event", "Cleanup", "x", { date: "2026-11-08" }), { query: "cleanup", today, upcoming: true });
    const later = signals(rec("e", "event", "Cleanup", "x", { date: "2027-01-08" }), { query: "cleanup", today, upcoming: true });
    expect(soon.score).toBeGreaterThan(later.score);
  });
});

describe("hybrid search", () => {
  const records = [
    rec("village", "place", "Outer Village", "A community space with classes, workshops, and events, with a focus on parents and little kids.", { tags: ["classes", "parents"] }),
    rec("plumbing", "recommendation", "River Plumbing Co", "Plumber. Fixes pipes. Vouched for by 3 neighbors.", { extra: { vouches: 3, when: "Nov '25" } }),
    rec("cleanup", "event", "Beach cleanup", "Meet at the ocean for the monthly cleanup.", { date: "2099-01-01" }),
    rec("library", "resource", "Tool Library", "Borrow a drill or a ladder.", { tags: ["sharing"] }),
    rec("branch", "place", "Public Library", "Books and a quiet room.", {}),
    rec("minutes", "note", "Meeting minutes", "The stewards met and talked about the budget.", {}),
  ];

  it("finds by meaning when no words match, and says so", async () => {
    const { index } = await hybrid(records);
    expect(index.semantic).toBe(true);
    const hits = await index.searchDetailed("somewhere for my toddler on a rainy day");
    expect(hits[0].record.title).toBe("Outer Village");
    expect(hits[0].why.some((w) => w.startsWith("meaning"))).toBe(true);
    expect(hits[0].lexicalRank).toBeUndefined();
    const faucet = await index.search("someone to fix a leaking faucet");
    expect(faucet[0].title).toBe("River Plumbing Co");
  });

  it("ranks records that match every word above records that match some", async () => {
    const { index } = await hybrid(records);
    const hits = await index.searchDetailed("tool library");
    expect(hits[0].record.title).toBe("Tool Library");
    expect(hits[0].why).toContain("all words");
    expect(hits[0].why).toContain("exact title");
    const branch = hits.find((h) => h.record.title === "Public Library")!;
    expect(branch.why).toContain("some words");
  });

  it("applies kind, upcoming, and day filters on both paths", async () => {
    const { index } = await hybrid(records);
    expect((await index.search("toddler", { kinds: ["event"] })).map((r) => r.title)).toEqual([]);
    expect((await index.search("ocean", { upcoming: true })).map((r) => r.title)).toEqual(["Beach cleanup"]);
    expect((await index.search("ocean", { on: "2000-01-01" }))).toEqual([]);
    expect((await index.search("ocean", { on: "2099-01-01" })).map((r) => r.title)).toEqual(["Beach cleanup"]);
  });

  it("falls back to words when the query embedding fails", async () => {
    const flaky = new ConceptEmbedder();
    const { index } = await hybrid(records, flaky);
    flaky.embed = async () => { throw new Error("timeout"); };
    const hits = await index.searchDetailed("tool library");
    expect(hits[0].record.title).toBe("Tool Library");
    expect(hits[0].why.some((w) => w.startsWith("meaning"))).toBe(false);
    expect(await index.search("toddler")).toEqual([]);
  });

  it("reuses a query vector instead of embedding the same question twice", async () => {
    const e = new ConceptEmbedder();
    const { index } = await hybrid(records, e);
    const before = e.calls.length;
    await index.search("toddler");
    await index.search("toddler");
    expect(e.calls.length).toBe(before + 1);
  });

  it("is lexical only without an embedder and returns nothing for an empty query", async () => {
    const index = new SearchIndex(records);
    expect(index.semantic).toBe(false);
    expect(await index.search("")).toEqual([]);
    expect(await index.search("   ")).toEqual([]);
    expect((await index.search("plumber")).map((r) => r.title)).toEqual(["River Plumbing Co"]);
    expect(await index.search("toddler")).toEqual([]);
  });

  it("ignores stopwords so a question finds the noun", async () => {
    const index = new SearchIndex(records);
    const hits = await index.searchDetailed("where is the tool library at");
    expect(hits[0].record.title).toBe("Tool Library");
    expect(hits[0].why).toContain("all words");
  });

  it("tells the model how each record matched", async () => {
    const { index, repo } = { ...(await hybrid(records)), repo: (await loadFixture()).repo };
    const out = await runTool("search_data", { query: "indoor things for children" }, { repo, index, log: { count: () => 0 } as never });
    expect(out).toContain("[place] Outer Village");
    expect(out).toMatch(/match: meaning 0\.\d\d/);
  });
});

describe("the fixture repo, embedded by default", () => {
  it("gives every record a vector on load and finds a rec by a near phrase", async () => {
    const { index, embedding } = await loadFixture();
    expect(embedding.embedder).toBe("hash-512");
    expect(embedding.records).toBe(index.size);
    expect(embedding.embedded).toBeGreaterThan(0);
    expect(index.semantic).toBe(true);
    const hits = await index.searchDetailed("plumber", { kinds: ["recommendation"] });
    expect(hits.map((h) => h.record.title)).toEqual(expect.arrayContaining(["Sam", "River Plumbing Co"]));
    for (const h of hits) expect(h.why).toContain("all words");
    expect(hits.some((h) => h.why.some((w) => w.startsWith("meaning")))).toBe(true);
    // A typo still lands: "plumbr" is one edit from the stemmed "plumber".
    const typo = await index.search("plumbr", { kinds: ["recommendation"] });
    expect(typo.map((r) => r.title)).toEqual(expect.arrayContaining(["Sam", "River Plumbing Co"]));
  });

  it("stems plurals so singular and plural find each other", async () => {
    const { index } = await loadFixture();
    const hits = await index.search("plumbers", { kinds: ["recommendation"] });
    expect(hits.map((r) => r.title)).toEqual(expect.arrayContaining(["Sam"]));
  });
});
