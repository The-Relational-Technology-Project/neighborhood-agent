/**
 * The gap log and the weekly research over it.
 *
 * The question log keeps counts only. To research what neighbors couldn't get, the server also
 * keeps the agent's own search queries from exchanges that ended in "I don't know": the words the
 * agent searched for, never the neighbor's message. Queries are scrubbed of anything that looks
 * like a name, address, phone, or email, capped in length and number, and kept in the cache dir.
 * Stewards can read them at /api/gaps. Each week the research job clusters them, re-searches the
 * notes by meaning, and reports which gaps the notes already answer (a retrieval miss) and which
 * need a record, a source, or a person added.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { SearchIndex } from "../data/index.js";
import type { DataRepo } from "../data/types.js";
import { isoWeek } from "../agent/questionlog.js";
import { parseJson, type Ask } from "./llm.js";

export interface GapEntry { week: string; topic: string; queries: string[] }

const MAX_ENTRIES = 400;

/** Drop queries that could identify a person; shorten the rest. */
export function scrubQuery(q: string): string | undefined {
  const s = q.replace(/\s+/g, " ").trim().slice(0, 80);
  if (!s) return undefined;
  if (/[\w.+-]+@[\w-]+\.[\w.-]+/.test(s)) return undefined; // email
  if (/(\+?1[\s.-]?)?\(?\d{3}\)?[\s.-]?\d{3}[\s.-]?\d{4}/.test(s)) return undefined; // phone
  if (/\b\d{2,5}\s+(?:\d{1,3}(?:st|nd|rd|th)|[A-Z][a-z]+)\s+(?:ave|avenue|st|street|blvd|way|dr|drive)\b/i.test(s)) return undefined; // street address
  if (/@\w{2,}/.test(s)) return undefined; // handle
  if (/\b(?:mr|mrs|ms|dr)\.?\s+[a-z]/i.test(s)) return undefined; // a titled name
  return s;
}

export class GapLog {
  private entries: GapEntry[] = [];
  private file: string;
  constructor(cacheDir: string) { this.file = path.join(cacheDir, "gaps.json"); }

  async load(): Promise<void> {
    try { this.entries = JSON.parse(await fs.readFile(this.file, "utf8")) as GapEntry[]; } catch { this.entries = []; }
  }

  async add(topic: string, queries: string[], week = isoWeek()): Promise<void> {
    const clean = [...new Set(queries.map(scrubQuery).filter((q): q is string => Boolean(q)))].slice(0, 6);
    if (!clean.length) return;
    this.entries.push({ week, topic, queries: clean });
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES);
    try { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify(this.entries)); } catch { /* best effort */ }
  }

  all(): GapEntry[] { return [...this.entries]; }

  /** Add entries from another instance (e.g. fetched from the live site), skipping exact duplicates. */
  merge(other: GapEntry[]): void {
    const seen = new Set(this.entries.map((e) => JSON.stringify(e)));
    for (const e of other) { const k = JSON.stringify(e); if (!seen.has(k)) { seen.add(k); this.entries.push(e); } }
    if (this.entries.length > MAX_ENTRIES) this.entries = this.entries.slice(-MAX_ENTRIES);
  }

  /** Entries from the last `weeks` ISO weeks, newest first. */
  recent(weeks = 1, now = new Date()): GapEntry[] {
    const keep = new Set<string>();
    for (let i = 0; i < weeks; i++) keep.add(isoWeek(new Date(now.getTime() - i * 7 * 86_400_000)));
    return this.entries.filter((e) => keep.has(e.week)).reverse();
  }
}

export interface GapTheme {
  theme: string;
  queries: string[];
  topic: string;
  /** covered: the notes answer it (a retrieval miss); partial; missing. */
  status: "covered" | "partial" | "missing";
  /** Records that answer or nearly answer it. */
  found: Array<{ id: string; title: string; kind: string }>;
  /** What would fill it: a record, a source, a person to ask. One or two sentences for stewards. */
  next: string;
}

export interface GapReport {
  weeks: number;
  exchanges: number;
  themes: GapTheme[];
  note?: string;
}

/** Group the week's unanswered queries into themes, then check each against the notes. */
export async function researchGaps(entries: GapEntry[], index: SearchIndex, repo: DataRepo, ask: Ask | undefined, opts: { weeks?: number; maxThemes?: number } = {}): Promise<GapReport> {
  const report: GapReport = { weeks: opts.weeks ?? 1, exchanges: entries.length, themes: [] };
  if (!entries.length) return report;
  const queries = [...new Set(entries.flatMap((e) => e.queries))];
  const topicOf = new Map<string, string>();
  for (const e of entries) for (const q of e.queries) topicOf.set(q, e.topic);

  // Cluster: the model groups them when it can; otherwise one theme per distinct query.
  let groups: Array<{ theme: string; queries: string[] }> = queries.map((q) => ({ theme: q, queries: [q] }));
  if (ask && queries.length > 1) {
    try {
      const out = await ask(
        `You group search queries from a neighborhood help agent into themes for its stewards. Reply with JSON only: an array of {"theme": "<3 to 6 words naming what neighbors wanted>", "queries": [<the queries that belong to it, verbatim>]}. Every query appears in exactly one theme. At most ${opts.maxThemes ?? 8} themes; merge the rest into the closest. No other text.`,
        queries.map((q) => `- ${q}`).join("\n"),
        1200,
      );
      const parsed = parseJson<Array<{ theme: string; queries: string[] }>>(out);
      if (parsed?.length) groups = parsed.filter((g) => g && g.theme && Array.isArray(g.queries) && g.queries.length).map((g) => ({ theme: String(g.theme).slice(0, 80), queries: g.queries.map(String).filter((q) => queries.includes(q)) })).filter((g) => g.queries.length);
    } catch (err) { report.note = `grouping fell back to one theme per query: ${(err as Error).message}`; }
  }
  groups.sort((a, b) => b.queries.length - a.queries.length);

  for (const g of groups.slice(0, opts.maxThemes ?? 8)) {
    const hits = new Map<string, { id: string; title: string; kind: string }>();
    for (const q of [g.theme, ...g.queries.slice(0, 3)]) for (const h of await index.searchDetailed(q, { limit: 5 })) hits.set(h.record.id, { id: h.record.id, title: h.record.title, kind: h.record.kind });
    const found = [...hits.values()].slice(0, 6);
    const theme: GapTheme = { theme: g.theme, queries: g.queries, topic: topicOf.get(g.queries[0]) ?? "other", status: found.length ? "partial" : "missing", found, next: "" };
    if (ask) {
      try {
        const people = [...repo.people, ...repo.orgs].filter((p) => p.topics?.length).map((p) => `- ${p.name}${p.org ? ` (${p.org})` : ""}: ${p.topics!.join(", ")}`).join("\n");
        const planned = repo.sources.filter((s) => s.status === "planned").map((s) => `- ${s.name}: ${s.about ?? s.note ?? ""}`).join("\n");
        const out = await ask(
          `You help the stewards of a neighborhood knowledge base see what neighbors asked for and couldn't get. Given a theme, the search queries behind it, and the records the notes have that come closest, reply with JSON only: {"status": "covered" | "partial" | "missing", "next": "<one or two plain sentences>"}. "covered" means one of the records plainly answers it (so the agent missed it, not the notes). "partial" means the records are near but a neighbor would still be short of an answer. "missing" means nothing here answers it. For "next", say concretely what would fill the gap: which kind of record to add (a place, a resource, a rec, an event), a planned source that likely has it, or a listed person who could be asked. Name records, sources, and people from the lists only. No preamble.`,
          `Theme: ${g.theme}\nQueries: ${g.queries.join("; ")}\n\nClosest records in the notes:\n${found.map((f) => `- [${f.kind}] ${f.title} (${f.id})`).join("\n") || "(none)"}\n\nPeople who agreed to be asked, by topic:\n${people || "(none)"}\n\nSources planned but not yet read:\n${planned || "(none)"}`,
          400,
        );
        const parsed = parseJson<{ status?: string; next?: string }>(out);
        if (parsed?.status && ["covered", "partial", "missing"].includes(parsed.status)) theme.status = parsed.status as GapTheme["status"];
        if (parsed?.next) theme.next = String(parsed.next).slice(0, 500);
      } catch (err) { theme.next = `(not analyzed: ${(err as Error).message})`; }
    }
    report.themes.push(theme);
  }
  return report;
}

export function formatGapReport(r: GapReport): string {
  if (!r.exchanges) return `No unanswered questions were logged in the last ${r.weeks === 1 ? "week" : `${r.weeks} weeks`}.`;
  const lines = [`${r.exchanges} exchange(s) ended in "I don't know" in the last ${r.weeks === 1 ? "week" : `${r.weeks} weeks`}, in ${r.themes.length} theme(s):`, ""];
  for (const t of r.themes) {
    lines.push(`${t.status.toUpperCase()}  ${t.theme}  (${t.queries.length} quer${t.queries.length === 1 ? "y" : "ies"}, topic ${t.topic})`);
    lines.push(`  searched for: ${t.queries.slice(0, 5).join("; ")}${t.queries.length > 5 ? "; ..." : ""}`);
    if (t.found.length) lines.push(`  closest in the notes: ${t.found.slice(0, 4).map((f) => `${f.title} [${f.kind}]`).join("; ")}`);
    if (t.next) lines.push(`  next: ${t.next}`);
    lines.push("");
  }
  if (r.note) lines.push(`(${r.note})`);
  return lines.join("\n").trimEnd();
}
