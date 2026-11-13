/**
 * The search index: MiniSearch over normalized records. No vector DB; the corpus is small.
 * When the deployment has an embeddings key, search by meaning (semantic.ts) is blended in:
 * a record that matches by words and by meaning comes first, and a record that only shares a
 * common word no longer crowds out the one that answers the question.
 */
import MiniSearch from "minisearch";
import type { Semantic } from "./semantic.js";
import type { Correction, NRecord, RecordKind } from "./types.js";

export interface SearchOptions {
  kinds?: RecordKind[];
  /** Only records dated today or later (events, menus). */
  upcoming?: boolean;
  /** Only records dated on this day. */
  on?: string;
  limit?: number;
  /**
   * Only records that are close in meaning, when search by meaning is on. For "what already exists
   * like this": a short true list beats a full one. Without embeddings it changes nothing.
   */
  close?: boolean;
}

/** By meaning, keep records within this much of the closest one, and never below the floor. */
const NEAR_BAND = 0.14;
const NEAR_FLOOR = 0.3;
const NEAR_MAX = 40;

export class SearchIndex {
  private mini: MiniSearch<NRecord>;
  private byId = new Map<string, NRecord>();
  readonly builtAt: string;
  /** Search by meaning, attached by the app state once the records are embedded. */
  semantic?: Semantic;

  constructor(records: NRecord[], corrections: Correction[] = [], builtAt = new Date().toISOString()) {
    this.builtAt = builtAt;
    const merged = applyCorrections(records, corrections);
    this.mini = new MiniSearch<NRecord>({
      idField: "id",
      fields: ["title", "text", "location", "tags", "kind"],
      storeFields: ["id"],
      extractField: (doc, field) => {
        const v = (doc as unknown as Record<string, unknown>)[field];
        return Array.isArray(v) ? v.join(" ") : v == null ? "" : String(v);
      },
      searchOptions: { boost: { title: 3, tags: 2 }, fuzzy: 0.2, prefix: true, combineWith: "OR" },
    });
    this.mini.addAll(merged);
    for (const r of merged) this.byId.set(r.id, r);
  }

  get size(): number {
    return this.byId.size;
  }

  all(): NRecord[] {
    return [...this.byId.values()];
  }

  get(id: string): NRecord | undefined {
    return this.byId.get(id);
  }

  /** Search by words and, when it is on, by meaning. Falls back to words alone if embedding the query fails. */
  async find(query: string, opts: SearchOptions = {}): Promise<NRecord[]> {
    return this.search(query, opts, await this.semantic?.scores(query));
  }

  /**
   * Full-text search. Pass `near` (how close each record is to the query by meaning, from
   * Semantic.scores) to blend the two rankings; `find` does that for you.
   */
  search(query: string, opts: SearchOptions = {}, near?: Map<string, number>): NRecord[] {
    const today = localDate();
    const limit = opts.limit ?? 12;
    const passes = (r: NRecord) =>
      // Old photographs are many and their captions are street names; keep them out of a general
      // search so "Judah" still finds this week's events. Asking for kind "block-note" includes them.
      (opts.kinds?.length ? opts.kinds.includes(r.kind) : !(r.kind === "block-note" && r.extra?.kind === "photo")) &&
      (!opts.upcoming || !r.date || r.date >= today) &&
      (!opts.on || r.date === opts.on);
    // How well each record matched, so the nudge below can't bury a good match under a weak one.
    const rel = new Map<string, number>();
    const hits = this.mini.search(query).map((h) => { rel.set(String(h.id), h.score); return this.byId.get(String(h.id))!; }).filter((r) => r && passes(r));
    // Nudge corrected and repo records up: they are the neighborhood's own words. A nudge, not a
    // trump card: a record that matches much better still comes first, whatever its source.
    hits.sort((a, b) => (rel.get(b.id) ?? 0) * nudge(b) - (rel.get(a.id) ?? 0) * nudge(a));
    if (!near?.size) return hits.slice(0, limit);

    // By meaning: the records closest to the query, among those that pass the same filters.
    const close = this.all().filter(passes).map((r) => ({ r, sim: near.get(r.id) ?? -1 })).sort((a, b) => b.sim - a.sim);
    const cut = Math.max(NEAR_FLOOR, (close[0]?.sim ?? 0) - NEAR_BAND);
    const byMeaning = close.filter((x) => x.sim >= cut).slice(0, NEAR_MAX);
    // Blend the two: each record scores by how close it is in meaning (within the band) and by how
    // well its words matched, meaning counting a little more. A name typed exactly still wins,
    // because nothing is close in meaning to a bare name and the word match stands alone.
    const top = byMeaning[0]?.sim ?? 0;
    const meaning = new Map(byMeaning.map((x) => [x.r.id, top > cut ? 0.5 + 0.5 * (x.sim - cut) / (top - cut) : 1]));
    const best = Math.max(0, ...hits.map((r) => rel.get(r.id) ?? 0)) || 1;
    const score = (r: NRecord) => (0.6 * (meaning.get(r.id) ?? 0) + 0.4 * ((rel.get(r.id) ?? 0) / best)) * nudge(r);
    // "Close" keeps what is near in meaning, plus anything whose title carries one of the words asked for.
    const words = query.toLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [];
    const named = (r: NRecord) => words.some((w) => r.title.toLowerCase().includes(w));
    const pool = new Map<string, NRecord>();
    for (const r of hits) if (!opts.close || named(r)) pool.set(r.id, r);
    for (const x of byMeaning) pool.set(x.r.id, x.r);
    return [...pool.values()].sort((a, b) => score(b) - score(a)).slice(0, limit);
  }

  byKind(kind: RecordKind, opts: { upcoming?: boolean; on?: string; limit?: number } = {}): NRecord[] {
    const today = localDate();
    let list = this.all().filter((r) => r.kind === kind);
    if (opts.upcoming) list = list.filter((r) => !r.date || r.date >= today);
    if (opts.on) list = list.filter((r) => r.date === opts.on);
    list.sort((a, b) => (a.start ?? a.date ?? "").localeCompare(b.start ?? b.date ?? ""));
    return list.slice(0, opts.limit ?? 50);
  }
}

function nudge(r: NRecord): number {
  return (r.corrections?.length ? 1.5 : 1) * (r.source.id === "repo" ? 1.15 : 1);
}

/** YYYY-MM-DD in the neighborhood's time zone. */
export function localDate(d = new Date(), tz = process.env.TZ_NAME ?? "America/Los_Angeles"): string {
  return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}

/**
 * Corrections in the repo beat source data. A correction targets a record id (or a prefix of one),
 * or free text matched against titles. The matched records carry the correction so answers can say
 * "a neighbor corrected this on <date>".
 */
export function applyCorrections(records: NRecord[], corrections: Correction[]): NRecord[] {
  if (!corrections.length) return records;
  return records.map((r) => {
    const mine = corrections.filter((c) => matches(c, r));
    if (!mine.length) return r;
    const lines = mine.map((c) => `Corrected by a neighbor on ${c.date}: ${c.field} ${c.was ? `was "${c.was}", ` : ""}now "${c.now}"${c.how_known ? ` (${c.how_known})` : ""}.`);
    return { ...r, corrections: mine, text: `${lines.join(" ")}\n\n${r.text}` };
  });
}

function matches(c: Correction, r: NRecord): boolean {
  const t = c.target.trim();
  if (!t) return false;
  if (r.id === t || r.id.startsWith(t + ":") ) return true;
  if (t.includes(":")) return false;
  const needle = t.toLowerCase();
  return r.title.toLowerCase().includes(needle) || needle.includes(r.title.toLowerCase());
}
