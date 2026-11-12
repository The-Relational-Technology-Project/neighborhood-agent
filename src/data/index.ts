/**
 * The search index: MiniSearch over normalized records. No vector DB; the corpus is small and
 * full-text search plus the model's judgment is enough for a prototype.
 */
import MiniSearch from "minisearch";
import type { Correction, NRecord, RecordKind } from "./types.js";

export interface SearchOptions {
  kinds?: RecordKind[];
  /** Only records dated today or later (events, menus). */
  upcoming?: boolean;
  /** Only records dated on this day. */
  on?: string;
  limit?: number;
}

export class SearchIndex {
  private mini: MiniSearch<NRecord>;
  private byId = new Map<string, NRecord>();
  readonly builtAt: string;

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

  search(query: string, opts: SearchOptions = {}): NRecord[] {
    const today = localDate();
    const limit = opts.limit ?? 12;
    let hits = this.mini.search(query).map((h) => this.byId.get(String(h.id))!).filter(Boolean);
    if (opts.kinds?.length) hits = hits.filter((r) => opts.kinds!.includes(r.kind));
    // Old photographs are many and their captions are street names; keep them out of a general
    // search so "Judah" still finds this week's events. Asking for kind "block-note" includes them.
    else hits = hits.filter((r) => !(r.kind === "block-note" && r.extra?.kind === "photo"));
    if (opts.upcoming) hits = hits.filter((r) => !r.date || r.date >= today);
    if (opts.on) hits = hits.filter((r) => r.date === opts.on);
    // Nudge corrected and repo records up: they are the neighborhood's own words.
    hits.sort((a, b) => score(b) - score(a));
    return hits.slice(0, limit);
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

function score(r: NRecord): number {
  return (r.corrections?.length ? 2 : 0) + (r.source.id === "repo" ? 1 : 0);
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
