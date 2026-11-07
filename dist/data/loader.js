/**
 * Loads every live source in sources.yml through its adapter, with the per-source cache, and
 * builds the search index. This is the one place that touches the network for data.
 */
import { adapters } from "../adapters/registry.js";
import { logInjection, looksLikeInjection } from "../safety/injection.js";
import { parseDuration, SourceCache } from "./cache.js";
import { SearchIndex } from "./index.js";
import { chunksFor, VectorStore } from "../search/vectors.js";
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
        const extra = source;
        const status = { id: source.id, name: source.name, url: source.url, status: source.status, adapter: source.adapter, records: 0, vital_sign: source.vital_sign, license: source.license, note: source.note, live_query: extra.live_query, group: extra.group, type: source.type, about: source.about };
        statuses.push(status);
        if (source.vital_sign && source.adapter !== "repo")
            continue; // vital signs are read live by src/vitals
        if (source.status !== "live" || !source.adapter)
            continue;
        if (opts.only && !opts.only.includes(source.id))
            continue;
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
        const ctx = { repo, source, fetchedAt, secret: (name) => (name ? process.env[name] : undefined), http: httpFetch };
        let raw;
        let usedCache = false;
        if (!opts.force && !["repo", "recs"].includes(adapter.id) && cache.isFresh(cached)) {
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
        if (!usedCache && !["repo", "recs"].includes(adapter.id))
            await cache.set({ source_id: source.id, fetched_at: fetchedAt, ttl_ms: ttl, raw, records: recs });
        status.fetched_at = at;
        status.records = recs.length;
        records.push(...recs);
    }
    const index = new SearchIndex(records, repo.corrections);
    const embedding = await embedAll(index, cacheDir, opts.embedder);
    return { index, statuses, embedding };
}
/**
 * Give every record a vector so search can match by meaning. Only chunks not already in the store
 * are sent to the embedder, so a rebuild after one merged PR embeds one record. A failure leaves
 * the index lexical only (and semantic over whatever vectors were already stored).
 */
export async function embedAll(index, cacheDir, embedder) {
    if (!embedder)
        return { embedder: "none", records: 0, embedded: 0 };
    const store = new VectorStore(cacheDir, embedder);
    await store.load();
    const chunks = index.all().flatMap(chunksFor);
    const res = await store.ensure(chunks);
    if (res.error)
        console.warn(`[search] embedding: ${res.error}`);
    index.attachVectors(store);
    return { embedder: embedder.id, records: index.vectors, embedded: res.embedded, error: res.error };
}
//# sourceMappingURL=loader.js.map