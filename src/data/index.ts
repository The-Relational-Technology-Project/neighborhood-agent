/**
 * The search index. Two retrievers over the same normalized records, fused:
 *
 *   lexical   MiniSearch (BM25-style) with fuzzy and prefix matching. Records that match every
 *             query word rank ahead of records that match some.
 *   semantic  cosine over embeddings of each record's text (src/search/), so "toddler on a rainy
 *             day" can find a record about indoor classes for little kids.
 *
 * Reciprocal rank fusion merges the two lists, then a few neighborhood signals nudge the order
 * (exact title, a steward's correction, the repo's own words, vouches, how soon an event is).
 * Each hit says how it matched so the model can tell an exact answer from a near one.
 *
 * Semantic search is optional: with no embedder the index is lexical only, and when a query
 * embedding fails the answer falls back to lexical for that query.
 */
import MiniSearch from "minisearch";
import type { Embedder } from "../search/embed.js";
import { contentWords, isStopword, rrf, semanticWeight, signals } from "../search/fuse.js";
import { DenseIndex, type VectorStore } from "../search/vectors.js";
import type { Correction, NRecord, RecordKind } from "./types.js";

export interface SearchOptions {
  kinds?: RecordKind[];
  /** Only records dated today or later (events, menus). */
  upcoming?: boolean;
  /** Only records dated on this day. */
  on?: string;
  limit?: number;
}

export interface SearchHit {
  record: NRecord;
  /** Fused score; only meaningful relative to other hits of the same query. */
  score: number;
  lexicalRank?: number;
  /** True when every content word of the query is in the record. */
  allWords?: boolean;
  semanticRank?: number;
  similarity?: number;
  /** Plain words on how it matched: "all words", "some words", "meaning 0.71", "exact title", ... */
  why: string[];
}

const SEMANTIC_CANDIDATES = 40;
const LEXICAL_CANDIDATES = 60;
// Tuning knobs, measured on retrieval.yml with Voyage 3.5: discounting or capping records that hold
// only some of the query's words lowered MRR (0.850 to 0.812 at a cap of 10), because that tail is
// what breaks ties among meaning matches. Both stay at "off" unless an env var says otherwise.
const SOME_WORDS_WEIGHT = Number(process.env.SEARCH_SOME_WORDS_WEIGHT ?? 1);
const SOME_WORDS_LIMIT = Number(process.env.SEARCH_SOME_LIMIT ?? LEXICAL_CANDIDATES);

export class SearchIndex {
  private mini: MiniSearch<NRecord>;
  private byId = new Map<string, NRecord>();
  private dense?: DenseIndex;
  private embedder?: Embedder;
  private queryCache = new Map<string, Float32Array>();
  /** Set after a query embedding fails, so the log doesn't repeat itself. */
  private semanticFailed?: string;
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
      processTerm: (term) => {
        const t = term.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
        return t.length < 2 || isStopword(t) ? null : stem(t);
      },
      searchOptions: { boost: { title: 3, tags: 2 }, fuzzy: 0.2, prefix: true },
    });
    this.mini.addAll(merged);
    for (const r of merged) this.byId.set(r.id, r);
  }

  /** Turn on semantic search with vectors already ensured in the store. */
  attachVectors(store: VectorStore): void {
    this.embedder = store.embedder;
    this.dense = new DenseIndex(this.all(), store);
  }

  /** Whether this index can search by meaning (an embedder is attached and some record has a vector). */
  get semantic(): boolean { return Boolean(this.dense && this.dense.size > 0 && this.embedder); }
  get vectors(): number { return this.dense?.size ?? 0; }

  get size(): number { return this.byId.size; }
  all(): NRecord[] { return [...this.byId.values()]; }
  get(id: string): NRecord | undefined { return this.byId.get(id); }

  /** Records only, best first. */
  async search(query: string, opts: SearchOptions = {}): Promise<NRecord[]> {
    return (await this.searchDetailed(query, opts)).map((h) => h.record);
  }

  /** Hits with ranks, similarity, and why each matched. */
  async searchDetailed(query: string, opts: SearchOptions = {}): Promise<SearchHit[]> {
    const q = query.trim();
    const limit = opts.limit ?? 12;
    if (!q) return [];
    const today = localDate();
    const allow = (r: NRecord) =>
      (!opts.kinds?.length || opts.kinds.includes(r.kind)) &&
      (!opts.upcoming || !r.date || r.date >= today) &&
      (!opts.on || r.date === opts.on);

    const lexical = this.searchLexical(q, allow, LEXICAL_CANDIDATES);
    const semantic = await this.searchSemantic(q, allow, SEMANTIC_CANDIDATES);

    const floor = this.embedder?.minSimilarity ?? 0;
    // A record holding only some of the query's words is a weaker vote than one holding them all.
    const fused = rrf([
      { ids: lexical.map((h) => h.id), weights: lexical.map((h) => (h.all ? 1 : SOME_WORDS_WEIGHT)) },
      { ids: semantic.map((h) => h.id), weights: semantic.map((h) => semanticWeight(h.similarity, floor)) },
    ]);
    const lexBy = new Map(lexical.map((h, i) => [h.id, { rank: i + 1, all: h.all }]));
    const semBy = new Map(semantic.map((h, i) => [h.id, { rank: i + 1, similarity: h.similarity }]));
    const hits: SearchHit[] = [];
    for (const [id, base] of fused) {
      const record = this.byId.get(id);
      if (!record) continue;
      const lex = lexBy.get(id);
      const sem = semBy.get(id);
      const why: string[] = [];
      if (lex) why.push(lex.all ? "all words" : "some words");
      if (sem) why.push(`meaning ${sem.similarity.toFixed(2)}`);
      // Matching every word is worth a little more than fusion alone gives it.
      const allBonus = lex?.all ? 0.004 : 0;
      const extra = signals(record, { query: q, today, upcoming: opts.upcoming });
      why.push(...extra.why);
      hits.push({ record, score: base + allBonus + extra.score, lexicalRank: lex?.rank, allWords: lex?.all, semanticRank: sem?.rank, similarity: sem?.similarity, why });
    }
    hits.sort((a, b) => b.score - a.score || (a.lexicalRank ?? 99) - (b.lexicalRank ?? 99));
    return hits.slice(0, limit);
  }

  /** Lexical candidates: every-word matches first, then any-word matches, each in BM25 order. */
  private searchLexical(q: string, allow: (r: NRecord) => boolean, limit: number): Array<{ id: string; all: boolean }> {
    const seen = new Set<string>();
    const out: Array<{ id: string; all: boolean }> = [];
    const take = (results: Array<{ id: unknown }>, all: boolean, cap = limit) => {
      for (const h of results) {
        const id = String(h.id);
        if (seen.has(id)) continue;
        const r = this.byId.get(id);
        if (!r || !allow(r)) continue;
        seen.add(id);
        out.push({ id, all });
        if (out.length >= cap) return;
      }
    };
    const multi = contentWords(q).length > 1;
    if (multi) take(this.mini.search(q, { combineWith: "AND" }), true);
    // Records holding only some of the words are a long tail of weak votes; fusion rewards a record
    // for showing up in both lists, so keep that tail short or a stray word outranks a strong meaning match.
    const someLimit = multi ? Math.min(limit, out.length + SOME_WORDS_LIMIT) : limit;
    if (out.length < someLimit) take(this.mini.search(q, { combineWith: "OR" }), !multi, someLimit);
    return out;
  }

  private async searchSemantic(q: string, allow: (r: NRecord) => boolean, limit: number): Promise<Array<{ id: string; similarity: number }>> {
    if (!this.dense || !this.embedder || !this.dense.size) return [];
    let vec = this.queryCache.get(q);
    if (!vec) {
      try {
        [vec] = await this.embedder.embed([q], "query");
      } catch (err) {
        const msg = (err as Error).message;
        if (this.semanticFailed !== msg) { this.semanticFailed = msg; console.warn(`[search] semantic search off for this query: ${msg}`); }
        return [];
      }
      if (!vec) return [];
      if (this.queryCache.size > 500) this.queryCache.delete(this.queryCache.keys().next().value!);
      this.queryCache.set(q, vec);
    }
    return this.dense.search(vec, { limit, minSimilarity: this.embedder.minSimilarity, allow: (id) => { const r = this.byId.get(id); return Boolean(r && allow(r)); } });
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

/**
 * A light English plural stemmer, applied to indexed terms and query terms alike, so "plumber"
 * finds "Plumbers" and "class" finds "classes". Deliberately conservative: no verb forms.
 */
export function stem(t: string): string {
  if (t.length < 4) return t;
  if (t.endsWith("'s")) t = t.slice(0, -2);
  if (t.endsWith("ies") && t.length > 4) return t.slice(0, -3) + "y";
  if (/(ss|us|is)$/.test(t)) return t;
  if (/(sses|shes|ches|xes|zes)$/.test(t)) return t.slice(0, -2);
  if (t.endsWith("s")) return t.slice(0, -1);
  return t;
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
