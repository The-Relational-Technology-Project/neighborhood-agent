/**
 * The weekly freshness check. No model needed. Walks every link the notes point to, and every
 * date that says when a human last looked, and reports what's broken or old. Flags, never fixes:
 * a steward decides whether a dead link means a closed business or a moved page.
 */
import type { SourceStatus } from "../data/loader.js";
import type { DataRepo } from "../data/types.js";
import { yearIn } from "../search/fuse.js";

export interface LinkCheck { where: string; name: string; url: string; status: number | string }

export interface FreshnessReport {
  checked: number;
  broken: LinkCheck[];
  /** Sites that refuse automated checks (403); not known to be broken. */
  blocked: LinkCheck[];
  /** Places whose hours or last_verified are missing or older than the window. */
  unverified: Array<{ name: string; last_verified: string | null | undefined; reason: string }>;
  /** Recs whose most recent vouch is two or more years old. */
  oldRecs: { count: number; sample: Array<{ name: string; when: string; file: string }> };
  /** Sources that errored or served stale data on the last build. */
  sources: Array<{ id: string; name: string; problem: string }>;
  note?: string;
}

export interface FreshnessOptions {
  fetchFn?: typeof fetch;
  /** Days before a place's last_verified counts as old. */
  verifyWindowDays?: number;
  today?: string;
  concurrency?: number;
}

const SKIP_HOSTS = /^(https?:\/\/)?(www\.)?(instagram|facebook|x|twitter|linkedin|nextdoor)\.com/i;

/** Every URL the notes point at, with where it lives. Social hosts are skipped: they block bots. */
export function linksToCheck(repo: DataRepo): LinkCheck[] {
  const out: LinkCheck[] = [];
  const add = (where: string, name: string, url?: string | null) => { if (url && /^https?:\/\//i.test(url) && !SKIP_HOSTS.test(url)) out.push({ where, name, url, status: 0 }); };
  for (const p of repo.places) add("places.yml", p.name, p.url);
  for (const r of repo.resources) add("resources.yml", r.name, r.url);
  for (const d of repo.doors) add("doors.yml", d.group, d.url);
  for (const s of repo.sources) if (s.status === "live") add("sources.yml", s.name, s.url);
  for (const f of repo.recs) for (const r of f.recs) for (const l of r.links ?? []) add(f.file, r.name, l.url);
  const seen = new Set<string>();
  return out.filter((l) => { if (seen.has(l.url)) return false; seen.add(l.url); return true; });
}

async function probe(url: string, fetchFn: typeof fetch): Promise<number | string> {
  const headers = { "user-agent": "Mozilla/5.0 (compatible; neighborhood-agent/0.1; +https://github.com/The-Relational-Technology-Project/neighborhood-agent)", accept: "text/html,*/*" };
  try {
    let res = await fetchFn(url, { method: "HEAD", redirect: "follow", headers, signal: AbortSignal.timeout(12_000) });
    if (res.status === 405 || res.status === 403 || res.status === 404 || res.status >= 500) res = await fetchFn(url, { method: "GET", redirect: "follow", headers, signal: AbortSignal.timeout(15_000) });
    return res.status;
  } catch (err) {
    const msg = (err as Error).message || String(err);
    return msg.includes("abort") || msg.includes("timeout") ? "timeout" : msg.slice(0, 60);
  }
}

export async function checkFreshness(repo: DataRepo, statuses: SourceStatus[], opts: FreshnessOptions = {}): Promise<FreshnessReport> {
  const fetchFn = opts.fetchFn ?? fetch;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const windowDays = opts.verifyWindowDays ?? 180;
  const links = linksToCheck(repo);
  const concurrency = opts.concurrency ?? 6;
  let next = 0;
  await Promise.all(Array.from({ length: Math.min(concurrency, links.length) }, async () => {
    while (next < links.length) { const l = links[next++]; l.status = await probe(l.url, fetchFn); }
  }));
  const broken = links.filter((l) => typeof l.status === "string" || (l.status >= 400 && l.status !== 403 && l.status !== 429));
  const blocked = links.filter((l) => l.status === 403 || l.status === 429);

  const unverified: FreshnessReport["unverified"] = [];
  for (const p of repo.places) {
    if (!p.last_verified) unverified.push({ name: p.name, last_verified: p.last_verified, reason: "never verified by a person" });
    else {
      const days = (Date.parse(today) - Date.parse(String(p.last_verified))) / 86_400_000;
      if (Number.isFinite(days) && days > windowDays) unverified.push({ name: p.name, last_verified: p.last_verified, reason: `last verified ${Math.round(days)} days ago` });
    }
  }

  const old: Array<{ name: string; when: string; file: string }> = [];
  const year = Number(today.slice(0, 4));
  for (const f of repo.recs) for (const r of f.recs) { const y = yearIn(r.when); if (y !== undefined && year - y >= 2) old.push({ name: r.name, when: String(r.when), file: f.file }); }

  const sources = statuses.filter((s) => s.error || s.stale).map((s) => ({ id: s.id, name: s.name, problem: s.stale ? `serving stale data (${s.error ?? "fetch failed"})` : s.error! }));

  return { checked: links.length, broken, blocked, unverified, oldRecs: { count: old.length, sample: old.slice(0, 10) }, sources };
}

export function formatFreshnessReport(r: FreshnessReport): string {
  const lines = [`Checked ${r.checked} links.`];
  if (r.broken.length) {
    lines.push("", `${r.broken.length} broken or unreachable:`);
    for (const b of r.broken) lines.push(`  ${b.status}  ${b.name} (${b.where})  ${b.url}`);
  } else lines.push("No broken links.");
  if (r.blocked.length) lines.push(`${r.blocked.length} site(s) refuse automated checks (Yelp and the like), so they weren't verified: ${r.blocked.slice(0, 6).map((b) => b.name).join("; ")}${r.blocked.length > 6 ? "; ..." : ""}.`);
  if (r.unverified.length) {
    lines.push("", `${r.unverified.length} place(s) nobody has verified lately:`);
    for (const u of r.unverified) lines.push(`  ${u.name}: ${u.reason}`);
  }
  if (r.oldRecs.count) {
    lines.push("", `${r.oldRecs.count} rec(s) whose last vouch is two or more years old${r.oldRecs.count > r.oldRecs.sample.length ? ` (first ${r.oldRecs.sample.length})` : ""}:`);
    for (const o of r.oldRecs.sample) lines.push(`  ${o.name} (${o.when}, ${o.file})`);
  }
  if (r.sources.length) {
    lines.push("", `${r.sources.length} source(s) with trouble on the last build:`);
    for (const s of r.sources) lines.push(`  ${s.name}: ${s.problem}`);
  }
  if (r.note) lines.push("", `(${r.note})`);
  return lines.join("\n");
}
