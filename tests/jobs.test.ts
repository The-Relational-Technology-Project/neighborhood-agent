import { describe, expect, it } from "vitest";
import { SearchIndex } from "../src/data/index.js";
import type { DataRepo, NRecord } from "../src/data/types.js";
import { HashEmbedder, normalize, type Embedder } from "../src/search/embed.js";
import { chunksFor, VectorStore } from "../src/search/vectors.js";
import { GapLog, formatGapReport, researchGaps, scrubQuery } from "../src/jobs/gaps.js";
import { checkFreshness, formatFreshnessReport, linksToCheck } from "../src/jobs/freshness.js";
import { formatLinksReport, linkCandidates, proposeLinks } from "../src/jobs/links.js";
import { formatArchiveReport, mineArchives, placesThisWeek, searchCommons, searchInternetArchive, usable } from "../src/jobs/archive.js";
import { formatWeekly } from "../src/jobs/weekly.js";
import { parseJson } from "../src/jobs/llm.js";
import { loadFixture, tmpCache } from "./helpers.js";

const src = (id: string) => ({ id, name: id, url: `https://${id}.example` });
const rec = (id: string, kind: NRecord["kind"], title: string, text: string, extra: Partial<NRecord> = {}): NRecord =>
  ({ id: `${extra.source?.id ?? "repo"}:${kind}:${id}`, kind, title, text, source: extra.source ?? src("repo"), fetched_at: "2026-11-07T00:00:00Z", ...extra });

/** Texts about the same concept land on the same vector. */
class ConceptEmbedder implements Embedder {
  id = "concept-jobs"; minSimilarity = 0.3;
  constructor(private concepts: Record<string, string>, private axes: string[]) {}
  async embed(texts: string[]) {
    // Text with no known concept gets the zero vector: similar to nothing.
    return texts.map((t) => { const v = new Float32Array(this.axes.length); for (const w of t.toLowerCase().match(/[a-z]+/g) ?? []) { const c = this.concepts[w]; if (c) v[this.axes.indexOf(c)] += 1; } return normalize(v); });
  }
}

async function indexWith(records: NRecord[], embedder: Embedder) {
  const index = new SearchIndex(records);
  const store = new VectorStore(await tmpCache(), embedder);
  await store.ensure(index.all().flatMap(chunksFor));
  index.attachVectors(store);
  return index;
}

const jsonResponse = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json" } });

describe("gap log", () => {
  it("scrubs anything that could name a person and keeps plain topics", () => {
    expect(scrubQuery("  toddler   playground ")).toBe("toddler playground");
    expect(scrubQuery("call 415-555-0123 plumber")).toBeUndefined();
    expect(scrubQuery("jane@example.com")).toBeUndefined();
    expect(scrubQuery("who lives at 1234 46th Ave")).toBeUndefined();
    expect(scrubQuery("@sunsetdad posts")).toBeUndefined();
    expect(scrubQuery("Dr. Smith pediatrician")).toBeUndefined();
    expect(scrubQuery("x".repeat(200))!.length).toBe(80);
  });

  it("records, dedupes, merges, persists, and slices by week", async () => {
    const dir = await tmpCache();
    const log = new GapLog(dir);
    await log.add("kids-and-family", ["toddler playground", "toddler playground", "415-555-0123"], "2026-W45");
    await log.add("food", ["late night food"], "2026-W40");
    expect(log.all()).toEqual([{ week: "2026-W45", topic: "kids-and-family", queries: ["toddler playground"] }, { week: "2026-W40", topic: "food", queries: ["late night food"] }]);
    const again = new GapLog(dir);
    await again.load();
    expect(again.all()).toHaveLength(2);
    again.merge([{ week: "2026-W45", topic: "kids-and-family", queries: ["toddler playground"] }, { week: "2026-W45", topic: "dogs", queries: ["dog beach rules"] }]);
    expect(again.all()).toHaveLength(3);
    expect(again.recent(1, new Date("2026-11-06T12:00:00Z")).map((e) => e.topic)).toEqual(["dogs", "kids-and-family"]);
    expect(again.recent(1, new Date("2026-10-01T12:00:00Z"))).toEqual([{ week: "2026-W40", topic: "food", queries: ["late night food"] }]);
  });

  it("researches gaps against the notes, grouping with the model and marking retrieval misses", async () => {
    const index = await indexWith([
      rec("village", "place", "Outer Village", "A community space with classes for parents and little kids."),
      rec("tools", "resource", "Tool Library", "Borrow a drill."),
    ], new ConceptEmbedder({ toddler: "kids", kids: "kids", playground: "kids", classes: "kids", parents: "kids", little: "kids" }, ["kids"]));
    const repo = { people: [{ name: "Ana", topics: ["parks", "kids"] }], orgs: [], sources: [{ id: "rec", name: "Rec & Park", status: "planned", about: "park facilities" }] } as unknown as DataRepo;
    const asked: string[] = [];
    const ask = async (system: string, user: string) => {
      asked.push(system.slice(0, 20));
      if (system.startsWith("You group")) return JSON.stringify([{ theme: "places for toddlers", queries: ["toddler playground", "indoor toddler"] }, { theme: "late food", queries: ["late night food"] }]);
      return user.includes("toddlers") ? '{"status":"partial","next":"Add Outer Village\'s classes as a rec; ask Ana about playgrounds."}' : '{"status":"missing","next":"No food records after 9pm; the Rec & Park source will not help, a places entry would."}';
    };
    const entries = [{ week: "2026-W45", topic: "kids-and-family", queries: ["toddler playground"] }, { week: "2026-W45", topic: "kids-and-family", queries: ["indoor toddler"] }, { week: "2026-W45", topic: "food", queries: ["late night food"] }];
    const report = await researchGaps(entries, index, repo, ask);
    expect(report.exchanges).toBe(3);
    expect(report.themes.map((t) => t.theme)).toEqual(["places for toddlers", "late food"]);
    expect(report.themes[0].status).toBe("partial");
    expect(report.themes[0].found.map((f) => f.title)).toContain("Outer Village");
    expect(report.themes[1].status).toBe("missing");
    expect(report.themes[1].found).toEqual([]);
    const text = formatGapReport(report);
    expect(text).toContain("PARTIAL  places for toddlers");
    expect(text).toContain("next: Add Outer Village");
    expect(formatGapReport({ weeks: 1, exchanges: 0, themes: [] })).toMatch(/No unanswered questions/);
  });

  it("works without a model: one theme per query, status from search alone", async () => {
    const index = new SearchIndex([rec("tools", "resource", "Tool Library", "Borrow a drill.")]);
    const report = await researchGaps([{ week: "w", topic: "sharing-and-borrowing", queries: ["tool library", "zzz"] }], index, { people: [], orgs: [], sources: [] } as unknown as DataRepo, undefined);
    expect(report.themes.map((t) => [t.theme, t.status])).toEqual([["tool library", "partial"], ["zzz", "missing"]]);
  });
});

describe("freshness", () => {
  it("collects every link once and skips social hosts", async () => {
    const { repo } = await loadFixture();
    const links = linksToCheck(repo);
    expect(links.length).toBeGreaterThan(3);
    expect(new Set(links.map((l) => l.url)).size).toBe(links.length);
    expect(links.some((l) => l.where === "places.yml")).toBe(true);
    expect(links.some((l) => /instagram|facebook/.test(l.url))).toBe(false);
  });

  it("flags dead links, unverified places, old recs, and troubled sources", async () => {
    const { repo, statuses } = await loadFixture();
    const dead = linksToCheck(repo)[0].url;
    const yelp = linksToCheck(repo)[1].url;
    const fetchFn = (async (url: string | URL | Request) => new Response("", { status: String(url) === dead ? 404 : String(url) === yelp ? 403 : 200 })) as unknown as typeof fetch;
    const report = await checkFreshness(repo, [...statuses, { id: "x", name: "Flaky feed", url: "u", status: "live", records: 0, error: "timeout", stale: true }], { fetchFn, today: "2026-11-07", verifyWindowDays: 180 });
    expect(report.checked).toBe(linksToCheck(repo).length);
    expect(report.broken.map((b) => b.url)).toEqual([dead]);
    expect(report.blocked.map((b) => b.url)).toEqual([yelp]);
    expect(report.unverified.some((u) => u.reason === "never verified by a person")).toBe(true);
    expect(report.unverified.some((u) => /last verified \d+ days ago/.test(u.reason))).toBe(true);
    expect(report.sources).toEqual([{ id: "x", name: "Flaky feed", problem: "serving stale data (timeout)" }]);
    const text = formatFreshnessReport(report);
    expect(text).toContain("1 broken or unreachable");
    expect(text).toContain("404");
    expect(text).toContain("Flaky feed: serving stale data");
    expect(text).toMatch(/1 site\(s\) refuse automated checks/);
  });

  it("treats a timeout as broken and tries GET when HEAD is refused", async () => {
    const { repo, statuses } = await loadFixture();
    const calls: string[] = [];
    const fetchFn = (async (url: string | URL | Request, init?: RequestInit) => {
      calls.push(`${init?.method} ${url}`);
      if (String(url).includes("tool")) { if (init?.method === "HEAD") return new Response("", { status: 405 }); return new Response("", { status: 200 }); }
      throw new Error("The operation was aborted due to timeout");
    }) as unknown as typeof fetch;
    const report = await checkFreshness(repo, statuses, { fetchFn, today: "2026-11-07" });
    expect(report.broken.every((b) => b.status === "timeout")).toBe(true);
    expect(report.broken.some((b) => b.url.includes("tool"))).toBe(false);
    expect(calls.some((c) => c.startsWith("GET") && c.includes("tool"))).toBe(true);
  });
});

describe("cross-links", () => {
  const concepts = { tools: "tools", tool: "tools", drill: "tools", ladder: "tools", lending: "tools", plover: "birds", plovers: "birds", snowy: "birds", birds: "birds", audubon: "birds" };
  const records = [
    rec("supplies", "resource", "Community Supplies", "The sharing community: lend a drill or a ladder.", {}),
    rec("tools-group", "group", "Tool Lending Circle", "Neighbors who share tools.", { source: src("outersunset-us") }),
    rec("plovers", "constituent", "Snowy plovers", "Birds wintering on the beach.", {}),
    rec("audubon", "person", "Golden Gate Audubon", "Advocates for the plovers and other birds.", {}),
    rec("event", "event", "Tool swap", "Bring a tool, take a tool.", { date: "2099-01-01" }),
  ];

  it("finds cross-kind pairs close in meaning, skips events and known links", async () => {
    const index = await indexWith(records, new ConceptEmbedder(concepts, ["tools", "birds"]));
    const cands = linkCandidates(index, []);
    const pairs = cands.map((c) => [c.from.title, c.to.title].sort().join(" <-> "));
    expect(pairs).toContain("Community Supplies <-> Tool Lending Circle");
    expect(pairs).toContain("Golden Gate Audubon <-> Snowy plovers");
    expect(pairs.some((p) => p.includes("Tool swap"))).toBe(false);
    expect(new Set(pairs).size).toBe(pairs.length);
    const fewer = linkCandidates(index, [{ from: "repo:constituent:plovers", to: "repo:person:audubon" }]);
    expect(fewer.some((c) => c.to.title === "Golden Gate Audubon" || c.from.title === "Golden Gate Audubon")).toBe(false);
  });

  it("lets the model keep the useful ones and writes links.yml with why", async () => {
    const index = await indexWith(records, new ConceptEmbedder(concepts, ["tools", "birds"]));
    const repo = { links: [] } as unknown as DataRepo;
    const ask = async (_s: string, user: string) => {
      const n = user.split("\n\n").find((block) => block.includes("Audubon"))?.match(/^(\d+)\./)?.[1];
      return JSON.stringify([{ i: Number(n), why: "the plovers' human advocates" }, { i: 99, why: "bogus" }]);
    };
    const report = await proposeLinks(index, repo, ask, { today: "2026-11-07" });
    expect(report.proposed).toHaveLength(1);
    expect(report.proposed[0].link).toMatchObject({ why: "the plovers' human advocates", by: "agent", added: "2026-11-07" });
    expect(report.yaml).toContain("links:");
    expect(report.yaml).toContain("why: the plovers' human advocates");
    const text = formatLinksReport(report, (id) => index.get(id)?.title ?? id);
    expect(text).toMatch(/Snowy plovers|Golden Gate Audubon/);
    const none = await proposeLinks(index, repo, undefined);
    expect(none.proposed).toEqual([]);
    expect(none.note).toMatch(/no model/);
  });

  it("surfaces linked records in search output", async () => {
    const index = new SearchIndex(records);
    index.setLinks([{ from: "repo:constituent:plovers", to: "repo:person:audubon", why: "their advocates" }]);
    expect(index.related("repo:constituent:plovers").map((r) => r.record.title)).toEqual(["Golden Gate Audubon"]);
    expect(index.related("repo:person:audubon")[0].why).toBe("their advocates");
    const { formatHit } = await import("../src/agent/tools.js");
    const [hit] = await index.searchDetailed("plovers");
    expect(formatHit(hit, index)).toContain("related: Golden Gate Audubon (person; their advocates)");
  });
});

describe("archives", () => {
  it("rotates through places week by week", () => {
    const places = ["a", "b", "c", "d", "e"].map((name) => ({ name }));
    expect(placesThisWeek(places, 0, 2).map((p) => p.name)).toEqual(["a", "b"]);
    expect(placesThisWeek(places, 1, 2).map((p) => p.name)).toEqual(["c", "d"]);
    expect(placesThisWeek(places, 2, 2).map((p) => p.name)).toEqual(["e", "a"]);
    expect(placesThisWeek([], 3)).toEqual([]);
  });

  it("uses only public-domain-by-date or licensed items", () => {
    expect(usable({ source: "Internet Archive", title: "t", url: "u", date: "1915-01-01" }, 2026)).toBe(true);
    expect(usable({ source: "Internet Archive", title: "t", url: "u", date: "1960-01-01" }, 2026)).toBe(false);
    expect(usable({ source: "Internet Archive", title: "t", url: "u", date: "1960-01-01", license: "https://creativecommons.org/licenses/by/4.0/" }, 2026)).toBe(true);
    expect(usable({ source: "Internet Archive", title: "t", url: "u" }, 2026)).toBe(false);
  });

  it("parses both archive APIs", async () => {
    const ia = (async () => jsonResponse({ response: { docs: [{ identifier: "dunes1910", title: ["Sunset dunes, 1910"], date: "1910-01-01T00:00:00Z", description: ["<p>Sand dunes</p> at Ocean Beach"] }] } })) as unknown as typeof fetch;
    const items = await searchInternetArchive('"Ocean Beach"', ia);
    expect(items).toEqual([{ source: "Internet Archive", title: "Sunset dunes, 1910", url: "https://archive.org/details/dunes1910", date: "1910-01-01", license: undefined, description: "Sand dunes at Ocean Beach" }]);
    const commons = (async () => jsonResponse({ query: { pages: { 1: { title: "File:Ocean Beach 1920.jpg", imageinfo: [{ descriptionurl: "https://commons.wikimedia.org/wiki/File:Ocean_Beach_1920.jpg", extmetadata: { LicenseShortName: { value: "Public domain" }, DateTimeOriginal: { value: "1920-05-02 10:00" }, ImageDescription: { value: "<b>Ocean Beach</b> looking north" } } }] } } } })) as unknown as typeof fetch;
    const files = await searchCommons('"Ocean Beach"', commons);
    expect(files).toEqual([{ source: "Wikimedia Commons", title: "Ocean Beach 1920", url: "https://commons.wikimedia.org/wiki/File:Ocean_Beach_1920.jpg", date: "1920-05-02", license: "Public domain", description: "Ocean Beach looking north" }]);
    const down = (async () => new Response("", { status: 503 })) as unknown as typeof fetch;
    await expect(searchInternetArchive("x", down)).rejects.toThrow(/503/);
  });

  it("drafts at most one cited note per place, skipping items already in archive/", async () => {
    const repo = {
      places: [{ name: "Ocean Beach", address: "west end", what: "the beach" }, { name: "Black Bird Bookstore" }],
      archive: [{ file: "old.md", data: {}, body: "See https://archive.org/details/already-there for more." }],
    } as unknown as DataRepo;
    const fetchFn = (async (url: string | URL | Request) => {
      const u = String(url);
      if (u.includes("archive.org")) return jsonResponse({ response: { docs: !u.includes("Ocean") ? [] : [{ identifier: "already-there", title: "Seen", date: "1900-01-01" }, { identifier: "ob1915", title: "Ocean Beach boardwalk", date: "1915-01-01", description: "The boardwalk at Ocean Beach" }, { identifier: "modern", title: "Recent photo", date: "2001-01-01" }] } });
      return jsonResponse({ query: { pages: {} } });
    }) as unknown as typeof fetch;
    const ask = async (_s: string, user: string) => (user.includes("Ocean Beach boardwalk") ? '{"pick": 0, "title": "The boardwalk, 1915", "note": "A 1915 view of the boardwalk along Ocean Beach. It shows the shore before the Great Highway."}' : '{"pick": null}');
    const report = await mineArchives(repo, ask, { fetchFn, week: 0, per: 2, today: "2026-11-07" });
    expect(report.places).toEqual(["Ocean Beach", "Black Bird Bookstore"]);
    expect(report.candidates).toBe(1);
    expect(report.notes).toHaveLength(1);
    const n = report.notes[0];
    expect(n.file).toBe("archive/2026-11-07-ocean-beach-the-boardwalk-1915.md");
    expect(n.content).toContain('title: "The boardwalk, 1915"');
    expect(n.content).toContain("proposed_by: agent");
    expect(n.content).toContain("Source: [Ocean Beach boardwalk](https://archive.org/details/ob1915), Internet Archive, 1915-01-01. Public domain by date.");
    expect(n.content).toContain("OpenSFHistory");
    const text = formatArchiveReport(report);
    expect(text).toContain("1 note(s) drafted");
    expect(text).toContain("Ocean Beach: Ocean Beach boardwalk");
    const quiet = await mineArchives(repo, undefined, { fetchFn, week: 0 });
    expect(quiet.notes).toEqual([]);
    expect(quiet.note).toMatch(/no model/);
  });
});

describe("the weekly email", () => {
  it("has a section for each job, lists PRs and trouble, and says when a job didn't run", () => {
    const text = formatWeekly({ week: "2026-W45", errors: ["archive: Internet Archive 503"], text: "", prs: ["https://github.com/x/y/pull/1"], gaps: { weeks: 1, exchanges: 0, themes: [] }, freshness: { checked: 3, broken: [], blocked: [], unverified: [], oldRecs: { count: 0, sample: [] }, sources: [] } }, (id) => id, true);
    expect(text).toContain("# Knowy weekly, 2026-W45");
    expect(text).toContain("by words and meaning");
    expect(text).toContain("## Gaps: what Knowy couldn't answer\n\nNo unanswered questions");
    expect(text).toContain("## Freshness: links and dates\n\nChecked 3 links.\nNo broken links.");
    expect(text).toContain("meaning.\n\n## Gaps");
    expect(text).toContain("## Network: proposed cross-links\n\nNot run this week.");
    expect(text).toContain("## To review\n\n- https://github.com/x/y/pull/1");
    expect(text).toContain("## Trouble\n\n- archive: Internet Archive 503");
  });

  it("parses JSON out of a chatty reply", () => {
    expect(parseJson<{ a: number }>('Sure! {"a": 1} hope that helps')).toEqual({ a: 1 });
    expect(parseJson("nothing here")).toBeUndefined();
    expect(parseJson<unknown[]>('[{"i": 1, "why": "a"}, {"i": 2, "why": "b"}, {"i": 3, "wh')).toEqual([{ i: 1, why: "a" }, { i: 2, why: "b" }]);
  });
});
