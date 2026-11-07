import { words } from "./embed.js";
export const RRF_K = 60;
/** Reciprocal rank fusion: sum over lists of weight / (k + rank). Rank is 1-based. */
export function rrf(lists, k = RRF_K) {
    const scores = new Map();
    for (const list of lists) {
        const w = list.weight ?? 1;
        list.ids.forEach((id, i) => scores.set(id, (scores.get(id) ?? 0) + (w * (list.weights?.[i] ?? 1)) / (k + i + 1)));
    }
    return scores;
}
/**
 * How much a meaning match should count: 0.4 at the similarity floor, so a barely-related record
 * at semantic rank 1 cannot outvote a direct word match, rising to 1.5 for a strong match, so a
 * record that clearly means the right thing is not buried under records that share one stray word.
 * Tuned on retrieval.yml with Voyage 3.5 (MRR 0.850 at a max of 1, 0.858 at 1.5).
 */
export function semanticWeight(similarity, floor, max = SEMANTIC_MAX_WEIGHT) {
    return Math.max(0.4, Math.min(max, 0.4 + (similarity - floor) / 0.25));
}
const SEMANTIC_MAX_WEIGHT = Number(process.env.SEARCH_SEM_MAX ?? 1.5);
const STOP = new Set(["a", "an", "the", "of", "in", "on", "at", "to", "for", "and", "or", "is", "are", "be", "with", "near", "around", "any", "some", "there", "where", "what", "who", "how", "do", "does", "i", "my", "me", "we", "our", "you", "your", "it", "its", "this", "that", "from", "by", "about", "can", "get", "find", "good", "best", "recommend", "recommendation", "recommendations", "looking", "need", "want", "know", "anyone", "someone", "please"]);
/** Query words that carry meaning: no stopwords, no single letters. */
export function contentWords(text) {
    return words(text).filter((w) => w.length > 1 && !STOP.has(w));
}
export function isStopword(w) { return STOP.has(w); }
/** A year like '25 or 2025 found in a rec's `when`; undefined when none. */
export function yearIn(when) {
    if (!when)
        return undefined;
    const full = when.match(/\b(20\d\d)\b/);
    if (full)
        return Number(full[1]);
    const short = when.match(/'(\d\d)\b/);
    if (short)
        return 2000 + Number(short[1]);
    return undefined;
}
/** Additive nudges on the fused score. Scaled to RRF units: one rank at the top is about 0.0003. */
export function signals(r, s) {
    let score = 0;
    const why = [];
    const q = contentWords(s.query);
    const t = contentWords(r.title);
    if (q.length && t.length) {
        const qs = new Set(q);
        if (t.every((w) => qs.has(w)) && q.every((w) => new Set(t).has(w))) {
            score += 0.04;
            why.push("exact title");
        }
        else if (t.every((w) => qs.has(w))) {
            score += 0.02;
            why.push("title");
        }
        else if (q.every((w) => new Set(t).has(w))) {
            score += 0.012;
            why.push("title");
        }
    }
    if (r.corrections?.length) {
        score += 0.006;
        why.push("corrected by a neighbor");
    }
    if (r.source.id === "repo")
        score += 0.003;
    if (r.kind === "recommendation") {
        const v = Number(r.extra?.vouches ?? 0);
        if (Number.isFinite(v) && v > 1)
            score += 0.0003 * Math.min(v, 10);
        const y = yearIn(r.extra?.when);
        if (y !== undefined && Number(s.today.slice(0, 4)) - y >= 2) {
            score -= 0.002;
            why.push("older rec");
        }
    }
    if (r.kind === "event" && s.upcoming && r.date && r.date >= s.today) {
        const days = (Date.parse(r.date) - Date.parse(s.today)) / 86_400_000;
        if (Number.isFinite(days))
            score += 0.002 * (1 - Math.min(days, 60) / 60);
    }
    return { score, why };
}
//# sourceMappingURL=fuse.js.map