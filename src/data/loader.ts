/**
 * Loads every live source in sources.yml through its adapter, with the per-source cache, and
 * builds the search index. This is the one place that touches the network for data.
 */
import { adapters } from "../adapters/registry.js";
import type { AdapterContext } from "../adapters/types.js";
import { logInjection, looksLikeInjection } from "../safety/injection.js";
import { parseDuration, SourceCache } from "./cache.js";
import { SearchIndex } from "./index.js";
import type { DataRepo, NRecord, SourceDef } from "./types.js";

export interface SourceStatus {
  id: string;
  name: string;
  url: string;
  status: SourceDef["status"];
  adapter?: string;
  fetched_at?: string;
  records: number;
  error?: string;
  stale?: boolean;
  vital_sign?: boolean;
  license?: string;
  note?: string;
  /** Why an optional source wasn't read (e.g. its key isn't set). */
  skipped?: string;
}

export interface LoadResult {
  index: SearchIndex;
  statuses: SourceStatus[];
}

export function httpFetch(url: string, init: RequestInit = {}): Promise<Response> {
  const headers = new Headers(init.headers);
  if (!headers.has("user-agent")) headers.set("user-agent", "neighborhood-agent/0.1 (+https://github.com/The-Relational-Technology-Project/neighborhood-agent)");
  return fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(20_000) });
}

export async function loadSources(repo: DataRepo, cacheDir: string, opts: { force?: boolean; only?: string[] } = {}): Promise<LoadResult> {
  const cache = new SourceCache(cacheDir);
  const records: NRecord[] = [];
  const statuses: SourceStatus[] = [];

  for (const source of repo.sources) {
    const status: SourceStatus = { id: source.id, name: source.name, url: source.url, status: source.status, adapter: source.adapter, records: 0, vital_sign: source.vital_sign, license: source.license, note: source.note };
    statuses.push(status);
    if (source.vital_sign && source.adapter !== "repo") continue; // vital signs are read live by src/vitals
    if (source.status !== "live" || !source.adapter) continue;
    if (opts.only && !opts.only.includes(source.id)) continue;
    const keyEnv = source.config?.key_env ? String(source.config.key_env) : undefined;
    if (source.config?.optional && keyEnv && !process.env[keyEnv]) {
      status.skipped = `set ${keyEnv} to read this`;
      continue;
    }
    const adapter = adapters[source.adapter];
    if (!adapter) {
      status.error = `no adapter named ${source.adapter}`;
      continue;
    }
    const ttl = parseDuration(source.refresh);
    const cached = await cache.get(source.id);
    const fetchedAt = new Date().toISOString();
    const ctx: AdapterContext = { repo, source, fetchedAt, secret: (name) => (name ? process.env[name] : undefined), http: httpFetch };

    let raw: unknown;
    let usedCache = false;
    if (!opts.force && adapter.id !== "repo" && cache.isFresh(cached)) {
      raw = cached!.raw;
      usedCache = true;
    } else {
      try {
        raw = await adapter.fetch(ctx);
      } catch (err) {
        status.error = (err as Error).message;
        if (cached) {
          raw = cached.raw;
          usedCache = true;
          status.stale = true;
        } else {
          continue;
        }
      }
    }
    const at = usedCache && cached ? cached.fetched_at : fetchedAt;
    let recs: NRecord[];
    try {
      recs = adapter.normalize(raw, { ...ctx, fetchedAt: at });
    } catch (err) {
      status.error = `normalize: ${(err as Error).message}`;
      continue;
    }
    for (const r of recs) {
      const hit = looksLikeInjection(`${r.title}\n${r.text}`);
      if (hit) {
        r.suspicious = true;
        await logInjection(cacheDir, { source: source.id, record: r.id, match: hit });
      }
    }
    if (!usedCache && adapter.id !== "repo") await cache.set({ source_id: source.id, fetched_at: fetchedAt, ttl_ms: ttl, raw, records: recs });
    status.fetched_at = at;
    status.records = recs.length;
    records.push(...recs);
  }

  return { index: new SearchIndex(records, repo.corrections), statuses };
}
