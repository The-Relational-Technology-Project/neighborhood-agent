import { parseDuration } from "../data/cache.js";
import type { DataRepo } from "../data/types.js";
import { vitalReaders } from "./feeds.js";
import type { VitalSign } from "./types.js";

interface Entry { at: number; ttl: number; signs: VitalSign[] }
const memo = new Map<string, Entry>();

/** Read every live vital-sign source in sources.yml, cached per source TTL in memory. */
export async function getVitalSigns(repo: DataRepo, opts: { force?: boolean } = {}): Promise<VitalSign[]> {
  const out: VitalSign[] = [];
  const jobs = repo.sources.filter((s) => s.vital_sign && s.status === "live" && s.adapter && vitalReaders[s.adapter]);
  await Promise.all(jobs.map(async (src) => {
    const ttl = parseDuration(src.refresh, 3_600_000);
    const hit = memo.get(src.id);
    if (!opts.force && hit && Date.now() - hit.at < ttl) {
      out.push(...hit.signs);
      return;
    }
    try {
      const signs = await vitalReaders[src.adapter!](src, repo);
      memo.set(src.id, { at: Date.now(), ttl, signs });
      out.push(...signs);
    } catch (err) {
      if (hit) {
        out.push(...hit.signs.map((s) => ({ ...s, error: "stale" })));
      } else {
        out.push({ id: src.id, constituent: "unknown", label: src.name, value: "unavailable", source: { name: src.name, url: src.url }, fetched_at: new Date().toISOString(), error: (err as Error).message });
      }
    }
  }));
  const order = ["tide", "water", "air", "plovers", "park", "seen", "coyote", "plover-seen"];
  return out.sort((a, b) => (order.indexOf(a.id) + 100) % 100 - ((order.indexOf(b.id) + 100) % 100));
}

/** The excluded-but-relevant feeds (e.g. water quality with no public feed) for the sources page and answers. */
export function vitalSignNotes(repo: DataRepo): Array<{ name: string; url: string; license?: string }> {
  return repo.sources.filter((s) => s.vital_sign && s.status !== "live").map((s) => ({ name: s.name, url: s.url, license: s.license }));
}

export function formatVitals(signs: VitalSign[]): string {
  return signs.map((s) => `${s.label}: ${s.value}${s.detail ? `. ${s.detail}` : ""} [source: ${s.source.name}, ${s.source.url}, fetched ${s.fetched_at}]${s.error ? ` (${s.error})` : ""}`).join("\n");
}
