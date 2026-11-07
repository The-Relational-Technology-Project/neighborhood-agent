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
import { contentWords, isStopword, rrf, semanticWeight, signals } from "../search/fuse.js";
import { DenseIndex } from "../search/vectors.js";
const SEMANTIC_CANDIDATES = 40;
const LEXICAL_CANDIDATES = 60;
export class SearchIndex {
    mini;
    byId = new Map();
    dense;
    embedder;
    queryCache = new Map();
    /** Set after a query embedding fails, so the log doesn't repeat itself. */
    semanticFailed;
    builtAt;
    constructor(records, corrections = [], builtAt = new Date().toISOString()) {
        this.builtAt = builtAt;
        const merged = applyCorrections(records, corrections);
        this.mini = new MiniSearch({
            idField: "id",
            fields: ["title", "text", "location", "tags", "kind"],
            storeFields: ["id"],
            extractField: (doc, field) => {
                const v = doc[field];
                return Array.isArray(v) ? v.join(" ") : v == null ? "" : String(v);
            },
            processTerm: (term) => {
                const t = term.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "");
                return t.length < 2 || isStopword(t) ? null : stem(t);
            },
            searchOptions: { boost: { title: 3, tags: 2 }, fuzzy: 0.2, prefix: true },
        });
        this.mini.addAll(merged);
        for (const r of merged)
            this.byId.set(r.id, r);
    }
    /** Turn on semantic search with vectors already ensured in the store. */
    attachVectors(store) {
        this.embedder = store.embedder;
        this.dense = new DenseIndex(this.all(), store);
    }
    /** Whether this index can search by meaning (an embedder is attached and some record has a vector). */
    get semantic() { return Boolean(this.dense && this.dense.size > 0 && this.embedder); }
    get vectors() { return this.dense?.size ?? 0; }
    get size() { return this.byId.size; }
    all() { return [...this.byId.values()]; }
    get(id) { return this.byId.get(id); }
    /** Records only, best first. */
    async search(query, opts = {}) {
        return (await this.searchDetailed(query, opts)).map((h) => h.record);
    }
    /** Hits with ranks, similarity, and why each matched. */
    async searchDetailed(query, opts = {}) {
        const q = query.trim();
        const limit = opts.limit ?? 12;
        if (!q)
            return [];
        const today = localDate();
        const allow = (r) => (!opts.kinds?.length || opts.kinds.includes(r.kind)) &&
            (!opts.upcoming || !r.date || r.date >= today) &&
            (!opts.on || r.date === opts.on);
        const lexical = this.searchLexical(q, allow, LEXICAL_CANDIDATES);
        const semantic = await this.searchSemantic(q, allow, SEMANTIC_CANDIDATES);
        const floor = this.embedder?.minSimilarity ?? 0;
        const fused = rrf([{ ids: lexical.map((h) => h.id) }, { ids: semantic.map((h) => h.id), weights: semantic.map((h) => semanticWeight(h.similarity, floor)) }]);
        const lexBy = new Map(lexical.map((h, i) => [h.id, { rank: i + 1, all: h.all }]));
        const semBy = new Map(semantic.map((h, i) => [h.id, { rank: i + 1, similarity: h.similarity }]));
        const hits = [];
        for (const [id, base] of fused) {
            const record = this.byId.get(id);
            if (!record)
                continue;
            const lex = lexBy.get(id);
            const sem = semBy.get(id);
            const why = [];
            if (lex)
                why.push(lex.all ? "all words" : "some words");
            if (sem)
                why.push(`meaning ${sem.similarity.toFixed(2)}`);
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
    searchLexical(q, allow, limit) {
        const seen = new Set();
        const out = [];
        const take = (results, all) => {
            for (const h of results) {
                const id = String(h.id);
                if (seen.has(id))
                    continue;
                const r = this.byId.get(id);
                if (!r || !allow(r))
                    continue;
                seen.add(id);
                out.push({ id, all });
                if (out.length >= limit)
                    return;
            }
        };
        if (contentWords(q).length > 1)
            take(this.mini.search(q, { combineWith: "AND" }), true);
        if (out.length < limit)
            take(this.mini.search(q, { combineWith: "OR" }), contentWords(q).length <= 1);
        return out;
    }
    async searchSemantic(q, allow, limit) {
        if (!this.dense || !this.embedder || !this.dense.size)
            return [];
        let vec = this.queryCache.get(q);
        if (!vec) {
            try {
                [vec] = await this.embedder.embed([q], "query");
            }
            catch (err) {
                const msg = err.message;
                if (this.semanticFailed !== msg) {
                    this.semanticFailed = msg;
                    console.warn(`[search] semantic search off for this query: ${msg}`);
                }
                return [];
            }
            if (!vec)
                return [];
            if (this.queryCache.size > 500)
                this.queryCache.delete(this.queryCache.keys().next().value);
            this.queryCache.set(q, vec);
        }
        return this.dense.search(vec, { limit, minSimilarity: this.embedder.minSimilarity, allow: (id) => { const r = this.byId.get(id); return Boolean(r && allow(r)); } });
    }
    byKind(kind, opts = {}) {
        const today = localDate();
        let list = this.all().filter((r) => r.kind === kind);
        if (opts.upcoming)
            list = list.filter((r) => !r.date || r.date >= today);
        if (opts.on)
            list = list.filter((r) => r.date === opts.on);
        list.sort((a, b) => (a.start ?? a.date ?? "").localeCompare(b.start ?? b.date ?? ""));
        return list.slice(0, opts.limit ?? 50);
    }
}
/**
 * A light English plural stemmer, applied to indexed terms and query terms alike, so "plumber"
 * finds "Plumbers" and "class" finds "classes". Deliberately conservative: no verb forms.
 */
export function stem(t) {
    if (t.length < 4)
        return t;
    if (t.endsWith("'s"))
        t = t.slice(0, -2);
    if (t.endsWith("ies") && t.length > 4)
        return t.slice(0, -3) + "y";
    if (/(ss|us|is)$/.test(t))
        return t;
    if (/(sses|shes|ches|xes|zes)$/.test(t))
        return t.slice(0, -2);
    if (t.endsWith("s"))
        return t.slice(0, -1);
    return t;
}
/** YYYY-MM-DD in the neighborhood's time zone. */
export function localDate(d = new Date(), tz = process.env.TZ_NAME ?? "America/Los_Angeles") {
    return new Intl.DateTimeFormat("en-CA", { timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit" }).format(d);
}
/**
 * Corrections in the repo beat source data. A correction targets a record id (or a prefix of one),
 * or free text matched against titles. The matched records carry the correction so answers can say
 * "a neighbor corrected this on <date>".
 */
export function applyCorrections(records, corrections) {
    if (!corrections.length)
        return records;
    return records.map((r) => {
        const mine = corrections.filter((c) => matches(c, r));
        if (!mine.length)
            return r;
        const lines = mine.map((c) => `Corrected by a neighbor on ${c.date}: ${c.field} ${c.was ? `was "${c.was}", ` : ""}now "${c.now}"${c.how_known ? ` (${c.how_known})` : ""}.`);
        return { ...r, corrections: mine, text: `${lines.join(" ")}\n\n${r.text}` };
    });
}
function matches(c, r) {
    const t = c.target.trim();
    if (!t)
        return false;
    if (r.id === t || r.id.startsWith(t + ":"))
        return true;
    if (t.includes(":"))
        return false;
    const needle = t.toLowerCase();
    return r.title.toLowerCase().includes(needle) || needle.includes(r.title.toLowerCase());
}
//# sourceMappingURL=index.js.map