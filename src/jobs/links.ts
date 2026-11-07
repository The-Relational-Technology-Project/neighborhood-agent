/**
 * The weekly cross-link proposer: the "networked" in the knowledge base. Records that sit close in
 * meaning but live in different files (a rec and the place it's about, a group and the event it
 * runs, a constituent and its advocate org) are candidates. The model keeps the ones a neighbor
 * would find useful and says why in a few words. Proposed links go to links.yml by PR; nothing
 * is linked until a steward merges.
 */
import YAML from "yaml";
import type { SearchIndex } from "../data/index.js";
import type { DataRepo, Link, NRecord, RecordKind } from "../data/types.js";
import { parseJson, type Ask } from "./llm.js";

/** Kinds whose ids are stable across rebuilds. Events and 311 cases come and go. */
export const LINKABLE: RecordKind[] = ["place", "resource", "group", "person", "constituent", "recommendation", "archive-note", "proposal"];

export interface LinkCandidate { from: NRecord; to: NRecord; similarity: number }

export function linkCandidates(index: SearchIndex, existing: Link[], opts: { minSimilarity?: number; perRecord?: number; max?: number } = {}): LinkCandidate[] {
  const have = new Set(existing.flatMap((l) => [`${l.from}|${l.to}`, `${l.to}|${l.from}`]));
  const seen = new Set<string>();
  const out: LinkCandidate[] = [];
  const records = index.all().filter((r) => LINKABLE.includes(r.kind) && !r.suspicious);
  for (const r of records) {
    for (const n of index.neighbors(r.id, { limit: opts.perRecord ?? 3, minSimilarity: opts.minSimilarity ?? 0.55, allow: (o) => LINKABLE.includes(o.kind) && o.kind !== r.kind && !o.suspicious })) {
      const key = [r.id, n.record.id].sort().join("|");
      if (seen.has(key) || have.has(`${r.id}|${n.record.id}`)) continue;
      seen.add(key);
      out.push({ from: r, to: n.record, similarity: n.similarity });
    }
  }
  out.sort((a, b) => b.similarity - a.similarity);
  return out.slice(0, opts.max ?? 40);
}

export interface LinkProposal { link: Link; similarity: number }

export interface LinksReport {
  candidates: number;
  proposed: LinkProposal[];
  yaml?: string;
  pr?: string;
  note?: string;
}

const brief = (r: NRecord) => `[${r.kind}] ${r.title} (${r.id}): ${r.text.replace(/\s+/g, " ").slice(0, 160)}`;

export async function proposeLinks(index: SearchIndex, repo: DataRepo, ask: Ask | undefined, opts: { max?: number; today?: string } = {}): Promise<LinksReport> {
  const cands = linkCandidates(index, repo.links);
  const report: LinksReport = { candidates: cands.length, proposed: [] };
  if (!cands.length) return report;
  if (!index.semantic) { report.note = "no vectors; set an embedding key to propose links"; return report; }
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const max = opts.max ?? 12;
  let keep: Array<{ i: number; why: string }> = [];
  if (ask) {
    try {
      const out = await ask(
        `You review candidate cross-links between records in a neighborhood knowledge base. A link is worth keeping when a neighbor reading one record would want the other: a recommendation and the place or group it's about, a group and the resource it runs, a constituent (the ocean, the plovers) and the org that advocates for it, a history note and the place it describes. Not worth keeping: two records that merely share a topic word, two competitors in the same trade, anything linking a private individual. Reply with JSON only: an array of {"i": <candidate number>, "why": "<under 12 words, plain, e.g. 'the group's own tool-lending site'>"}, at most ${max} items, best first. Empty array if none. No other text.`,
        cands.map((c, i) => `${i}. ${brief(c.from)}\n   <-> ${brief(c.to)}\n   similarity ${c.similarity.toFixed(2)}`).join("\n\n"),
        2000,
      );
      const parsed = parseJson<Array<{ i: number; why: string }>>(out);
      if (!Array.isArray(parsed)) { report.note = `model reply was not a JSON list, so nothing is proposed: ${out.replace(/\s+/g, " ").slice(0, 120)}`; return report; }
      keep = parsed.filter((k) => k && Number.isInteger(k.i) && cands[k.i] && k.why).slice(0, max);
    } catch (err) { report.note = `model review failed, so nothing is proposed: ${(err as Error).message}`; return report; }
  } else {
    report.note = "no model configured; listing the closest pairs without review, nothing is proposed";
    return report;
  }
  report.proposed = keep.map((k) => ({ link: { from: cands[k.i].from.id, to: cands[k.i].to.id, why: String(k.why).slice(0, 120), by: "agent", added: today }, similarity: cands[k.i].similarity }));
  if (report.proposed.length) {
    const header = repo.links.length ? "" : "# Cross-links between records, by id. The agent proposes these from search by meaning; a steward merges.\n# Fields: from, to (record ids as /place.json lists them), why (shown to neighbors), by, added.\n";
    report.yaml = header + YAML.stringify({ links: [...repo.links, ...report.proposed.map((p) => p.link)] });
  }
  return report;
}

export function formatLinksReport(r: LinksReport, titles: (id: string) => string): string {
  if (!r.proposed.length) return `${r.candidates} candidate pair(s) looked at; nothing proposed.${r.note ? ` ${r.note}.` : ""}`;
  const lines = [`${r.proposed.length} new link(s) proposed from ${r.candidates} candidate pair(s)${r.pr ? `, in ${r.pr}` : ""}:`, ""];
  for (const p of r.proposed) lines.push(`  ${titles(p.link.from)}  <->  ${titles(p.link.to)}: ${p.link.why}`);
  if (r.note) lines.push("", `(${r.note})`);
  return lines.join("\n");
}
