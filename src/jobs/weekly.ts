/**
 * The weekly run: research the gaps, check freshness, propose cross-links, mine the archives, then
 * one email with all of it and PRs for the parts that add to the notes. Each job is wrapped so one
 * failure still leaves the rest in the email. Meant for a scheduled GitHub Actions run
 * (.github/workflows/weekly.yml), and runnable by hand with `nagent weekly`.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { isoWeek } from "../agent/questionlog.js";
import { emailStewards, stewardAddresses } from "../notify/email.js";
import type { AppState } from "../state.js";
import { mineArchives, formatArchiveReport, type ArchiveReport } from "./archive.js";
import { checkFreshness, formatFreshnessReport, type FreshnessReport } from "./freshness.js";
import { formatGapReport, researchGaps, type GapEntry, type GapReport } from "./gaps.js";
import { formatLinksReport, proposeLinks, type LinksReport } from "./links.js";
import { makeAsk } from "./llm.js";

export interface WeeklyResult {
  week: string;
  gaps?: GapReport;
  freshness?: FreshnessReport;
  links?: LinksReport;
  archive?: ArchiveReport;
  errors: string[];
  text: string;
  emailed?: string[];
  prs: string[];
}

export interface WeeklyOptions {
  /** Open PRs for links and archive notes when the GitHub App is configured. Default true. */
  openPrs?: boolean;
  /** Send the email when Resend is configured. Default true. */
  email?: boolean;
  /** Skip jobs by name. */
  skip?: Array<"gaps" | "freshness" | "links" | "archive">;
  fetchFn?: typeof fetch;
}

/** Pull the live site's gap entries, since a serverless host keeps them per instance. */
async function remoteGaps(siteUrl: string | undefined, fetchFn: typeof fetch): Promise<GapEntry[]> {
  if (!siteUrl) return [];
  try {
    const res = await fetchFn(`${siteUrl.replace(/\/$/, "")}/api/gaps`, { signal: AbortSignal.timeout(15_000) });
    if (!res.ok) return [];
    const json = (await res.json()) as { entries?: GapEntry[] };
    return Array.isArray(json.entries) ? json.entries : [];
  } catch { return []; }
}

export async function runWeekly(state: AppState, opts: WeeklyOptions = {}): Promise<WeeklyResult> {
  const fetchFn = opts.fetchFn ?? fetch;
  const week = isoWeek();
  const result: WeeklyResult = { week, errors: [], text: "", prs: [] };
  const ask = makeAsk(state.agent?.client, state.cfg.classifyModel, state.budget);
  const skip = new Set(opts.skip ?? []);
  const titles = (id: string) => state.index.get(id)?.title ?? id;
  const base = state.cfg.dataRepoBranch;
  const canPr = opts.openPrs !== false && state.github.configured;

  if (!skip.has("gaps")) {
    try {
      state.gaps.merge(await remoteGaps(state.cfg.siteUrl, fetchFn));
      result.gaps = await researchGaps(state.gaps.recent(1), state.index, state.repo, ask, { weeks: 1 });
    } catch (err) { result.errors.push(`gaps: ${(err as Error).message}`); }
  }
  if (!skip.has("freshness")) {
    try { result.freshness = await checkFreshness(state.repo, state.statuses, { fetchFn }); } catch (err) { result.errors.push(`freshness: ${(err as Error).message}`); }
  }
  if (!skip.has("links")) {
    try {
      result.links = await proposeLinks(state.index, state.repo, ask);
      if (result.links.yaml && canPr) {
        const pr = await state.github.openPr({ path: "links.yml", content: result.links.yaml, title: `Links: ${result.links.proposed.length} proposed cross-link(s), week ${week}`, body: `Proposed by the weekly job from search by meaning. Each says why. Merge the ones a neighbor would want; delete the rest.\n\n${result.links.proposed.map((p) => `- ${titles(p.link.from)} <-> ${titles(p.link.to)}: ${p.link.why}`).join("\n")}`, labels: ["links"], base });
        result.links.pr = pr.url; result.prs.push(pr.url);
      }
    } catch (err) { result.errors.push(`links: ${(err as Error).message}`); }
  }
  if (!skip.has("archive")) {
    try {
      result.archive = await mineArchives(state.repo, ask, { fetchFn });
      if (result.archive.notes.length && canPr) {
        const pr = await state.github.openPr({ files: result.archive.notes.map((n) => ({ path: n.file, content: n.content })), title: `Archive: ${result.archive.notes.length} history note(s), week ${week}`, body: `Drafted by the weekly job from the Internet Archive and Wikimedia Commons (public domain or licensed items only). Check each against its source before merging.\n\n${result.archive.notes.map((n) => `- ${n.place}: ${n.item.title} (${n.item.url})`).join("\n")}`, labels: ["archive"], base });
        result.archive.pr = pr.url; result.prs.push(pr.url);
      }
    } catch (err) { result.errors.push(`archive: ${(err as Error).message}`); }
  }

  result.text = formatWeekly(result, titles, state.index.semantic);
  try { const dir = path.join(state.cfg.cacheDir, "digests"); await fs.mkdir(dir, { recursive: true }); await fs.writeFile(path.join(dir, `${week}.md`), result.text); } catch { /* best effort */ }

  if (opts.email !== false && state.cfg.email.apiKey) {
    const to = state.cfg.email.digestTo.length ? state.cfg.email.digestTo : stewardAddresses(state.cfg, state.repo);
    if (to.length) {
      try { await emailStewards(state.cfg, state.repo, { to, subject: `Knowy weekly, ${week}: gaps, freshness, links, history`, text: result.text }); result.emailed = to; } catch (err) { result.errors.push(`email: ${(err as Error).message}`); }
    }
  }
  return result;
}

export function formatWeekly(r: WeeklyResult, titles: (id: string) => string, semantic: boolean): string {
  const section = (title: string, body: string | undefined, skipped = "Not run this week.") => `## ${title}\n\n${body ?? skipped}`;
  return [
    `# Knowy weekly, ${r.week}`,
    "",
    `What neighbors asked and couldn't get, what's gone stale, new connections in the notes, and a little history. The agent proposes; stewards decide. Search is ${semantic ? "by words and meaning" : "by words only"}.`,
    "",
    section("Gaps: what Knowy couldn't answer", r.gaps ? formatGapReport(r.gaps) : undefined),
    "",
    section("Freshness: links and dates", r.freshness ? formatFreshnessReport(r.freshness) : undefined),
    "",
    section("Network: proposed cross-links", r.links ? formatLinksReport(r.links, titles) : undefined),
    "",
    section("History: from the archives", r.archive ? formatArchiveReport(r.archive) : undefined),
    "",
    r.prs.length ? `## To review\n\n${r.prs.map((p) => `- ${p}`).join("\n")}\n` : "",
    r.errors.length ? `## Trouble\n\n${r.errors.map((e) => `- ${e}`).join("\n")}\n` : "",
  ].filter((s) => s !== "").join("\n").replace(/\n{3,}/g, "\n\n").replace(/([^\n])\n(## )/g, "$1\n\n$2").trimEnd() + "\n";
}
