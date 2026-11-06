import { sourceRef } from "./types.js";
const COLLECTIONS = [
    ["events", "event"],
    ["groups", "group"],
    ["assets", "resource"],
    ["plans", "proposal"],
    ["notices", "note"],
    ["dreams", "proposal"],
];
export const neighborhoodApiAdapter = {
    id: "neighborhood-api",
    async fetch(ctx) {
        const base = String(ctx.source.config?.base_url ?? "").replace(/\/$/, "");
        if (!base)
            throw new Error("neighborhood-api: base_url not set");
        const out = {};
        for (const [coll] of COLLECTIONS) {
            try {
                const res = await ctx.http(`${base}/${coll}`);
                if (!res.ok)
                    continue;
                const body = (await res.json());
                out[coll] = Array.isArray(body) ? body : (body?.data ?? []);
            }
            catch {
                // a missing collection is fine
            }
        }
        if (!Object.keys(out).length)
            throw new Error("neighborhood-api: nothing readable");
        return out;
    },
    normalize(raw, ctx) {
        const src = sourceRef(ctx);
        const data = (raw ?? {});
        const out = [];
        for (const [coll, kind] of COLLECTIONS) {
            for (const item of data[coll] ?? []) {
                const loc = item.location;
                out.push({
                    id: `${src.id}:${coll}:${String(item.id ?? item.name)}`,
                    kind,
                    title: String(item.name ?? item.title ?? ""),
                    text: String(item.description ?? ""),
                    date: item.start ? String(item.start).slice(0, 10) : undefined,
                    start: item.start ? String(item.start) : undefined,
                    end: item.end ? String(item.end) : undefined,
                    location: loc ? [loc.name, loc.address].filter(Boolean).join(", ") : undefined,
                    url: item.url ? String(item.url) : src.url,
                    source: src,
                    fetched_at: ctx.fetchedAt,
                    tags: Array.isArray(item.category) ? item.category.map(String) : [],
                    extra: item,
                });
            }
        }
        return out;
    },
};
//# sourceMappingURL=neighborhood-api.js.map