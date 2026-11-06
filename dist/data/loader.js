/**
 * Loads every live source in sources.yml through its adapter, with the per-source cache, and
 * builds the search index. This is the one place that touches the network for data.
 */
import { adapters } from "../adapters/registry.js";
import { logInjection, looksLikeInjection } from "../safety/injection.js";
import { parseDuration, SourceCache } from "./cache.js";
import { SearchIndex } from "./index.js";
export function httpFetch(url, init = {}) {
    const headers = new Headers(init.headers);
    if (!headers.has("user-agent"))
        headers.set("user-agent", "neighborhood-agent/0.1 (+https://github.com/The-Relational-Technology-Project/neighborhood-agent)");
    return fetch(url, { ...init, headers, signal: init.signal ?? AbortSignal.timeout(20_000) });
}
export async function loadSources(repo, cacheDir, opts = {}) {
    const cache = new SourceCache(cacheDir);
    const records = [];
    const statuses = [];
    for (const source of repo.sources) {
        const status = { id: source.id, name: source.name, url: source.url, status: source.status, adapter: source.adapter, records: 0, vital_sign: source.vital_sign, license: source.license, note: source.note };
        statuses.push(status);
        if (source.vital_sign && source.adapter !== "repo")
            continue; // vital signs are read live by src/vitals
        if (source.status !== "live" || !source.adapter)
            continue;
        if (opts.only && !opts.only.includes(source.id))
            continue;
        const adapter = adapters[source.adapter];
        if (!adapter) {
            status.error = `no adapter named ${source.adapter}`;
            continue;
        }
        const ttl = parseDuration(source.refresh);
        const cached = await cache.get(source.id);
        const fetchedAt = new Date().toISOString();
        const ctx = { repo, source, fetchedAt, secret: (name) => (name ? process.env[name] : undefined), http: httpFetch };
        let raw;
        let usedCache = false;
        if (!opts.force && adapter.id !== "repo" && cache.isFresh(cached)) {
            raw = cached.raw;
            usedCache = true;
        }
        else {
            try {
                raw = await adapter.fetch(ctx);
            }
            catch (err) {
                status.error = err.message;
                if (cached) {
                    raw = cached.raw;
                    usedCache = true;
                    status.stale = true;
                }
                else {
                    continue;
                }
            }
        }
        const at = usedCache && cached ? cached.fetched_at : fetchedAt;
        let recs;
        try {
            recs = adapter.normalize(raw, { ...ctx, fetchedAt: at });
        }
        catch (err) {
            status.error = `normalize: ${err.message}`;
            continue;
        }
        for (const r of recs) {
            const hit = looksLikeInjection(`${r.title}\n${r.text}`);
            if (hit) {
                r.suspicious = true;
                await logInjection(cacheDir, { source: source.id, record: r.id, match: hit });
            }
        }
        if (!usedCache && adapter.id !== "repo")
            await cache.set({ source_id: source.id, fetched_at: fetchedAt, ttl_ms: ttl, raw, records: recs });
        status.fetched_at = at;
        status.records = recs.length;
        records.push(...recs);
    }
    return { index: new SearchIndex(records, repo.corrections), statuses };
}
//# sourceMappingURL=loader.js.map