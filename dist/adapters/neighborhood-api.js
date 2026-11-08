import { localDate } from "../data/index.js";
import { toLocalIso } from "./ics.js";
import { sourceRef } from "./types.js";
const COLLECTIONS = [
    ["events", "event"],
    ["groups", "group"],
    ["assets", "resource"],
    ["plans", "proposal"],
    ["notices", "note"],
    ["dreams", "proposal"],
    ["menus", "note"],
    ["news_items", "archive-note"],
];
const KNOWN = new Set(COLLECTIONS.map(([c]) => c));
export function fillDates(q, now = new Date()) {
    return q.replace(/\{today(?:([+-])(\d+))?\}/g, (_m, sign, n) => {
        const d = new Date(now);
        if (n)
            d.setDate(d.getDate() + (sign === "-" ? -1 : 1) * Number(n));
        return localDate(d);
    });
}
function urls(ctx) {
    const c = ctx.source.config ?? {};
    const query = c.query ? fillDates(String(c.query)) : "";
    const withQuery = (u) => (query ? `${u}${u.includes("?") ? "&" : "?"}${query}` : u);
    const endpoints = c.endpoints;
    if (endpoints && Object.keys(endpoints).length)
        return Object.entries(endpoints).map(([name, u]) => [name, withQuery(fillDates(String(u)))]);
    const base = String(c.base_url ?? "").replace(/\/$/, "");
    if (!base)
        return [];
    return COLLECTIONS.map(([coll]) => [coll, withQuery(`${base}/${coll}`)]);
}
export const neighborhoodApiAdapter = {
    id: "neighborhood-api",
    async fetch(ctx) {
        const list = urls(ctx);
        if (!list.length)
            throw new Error("neighborhood-api: set base_url or endpoints");
        const out = {};
        let lastErr;
        for (const [name, url] of list) {
            try {
                const res = await ctx.http(url);
                if (!res.ok)
                    throw new Error(`${name} ${res.status}`);
                const body = (await res.json());
                const b = body;
                const keyed = !Array.isArray(body) && b ? Object.keys(b).find((k) => KNOWN.has(k) && Array.isArray(b[k])) : undefined;
                const coll = KNOWN.has(name) ? name : (keyed ?? name);
                const items = Array.isArray(body) ? body : (b?.[coll] ?? b?.data ?? []);
                out[coll] = [...(out[coll] ?? []), ...items];
            }
            catch (err) {
                lastErr = err; // a missing collection is fine as long as one works
            }
        }
        if (!Object.keys(out).length)
            throw new Error(`neighborhood-api: nothing readable (${lastErr?.message ?? "no response"})`);
        return out;
    },
    normalize(raw, ctx) {
        const src = sourceRef(ctx);
        const data = (raw ?? {});
        const out = [];
        for (const [coll, kind] of COLLECTIONS) {
            for (const item of data[coll] ?? []) {
                if (coll === "menus" || coll === "news_items") {
                    out.push(coll === "menus" ? menuRecord(item, src, ctx.fetchedAt) : newsRecord(item, src, ctx.fetchedAt));
                    continue;
                }
                const loc = item.location;
                // Spec times carry an offset; show them on the neighborhood's wall clock.
                const startIso = item.start ? String(item.start) : undefined;
                const endIso = item.end ? String(item.end) : undefined;
                const start = startIso && !Number.isNaN(Date.parse(startIso)) ? toLocalIso(new Date(startIso)) : startIso;
                const end = endIso && !Number.isNaN(Date.parse(endIso)) ? toLocalIso(new Date(endIso)) : endIso;
                const category = Array.isArray(item.category) ? item.category.map(String) : item.category ? [String(item.category)] : [];
                out.push({
                    id: `${src.id}:${coll}:${String(item.id ?? item.name)}`,
                    kind,
                    title: String(item.name ?? item.title ?? ""),
                    text: [item.description ? String(item.description) : "", category.length ? `Type: ${category.join(", ")}.` : "", item.cost ? `Cost: ${String(item.cost)}.` : ""].filter(Boolean).join(" "),
                    date: start ? start.slice(0, 10) : undefined,
                    start,
                    end,
                    location: loc ? [loc.name, loc.address].filter(Boolean).join(", ") || undefined : undefined,
                    url: item.url ? String(item.url) : src.url,
                    source: src,
                    fetched_at: ctx.fetchedAt,
                    tags: category,
                    extra: item,
                });
            }
        }
        return out;
    },
};
function str(v) {
    return v == null ? "" : String(v);
}
function cats(item) {
    return Array.isArray(item.category) ? item.category.map(String) : item.category ? [String(item.category)] : [];
}
/** A dated menu: Arizmendi's pizza of the day, the SFUSD school lunch. */
function menuRecord(item, src, fetchedAt) {
    const category = cats(item);
    const name = str(item.name);
    const date = str(item.date).slice(0, 10);
    const isPizza = category.includes("pizza");
    const loc = item.location;
    const where = loc ? [loc.name, loc.address].filter(Boolean).map(String).join(", ") : "";
    const items = Array.isArray(item.items) ? item.items.map(String) : [];
    const what = items.length > 1 ? items.join("; ") : str(item.description) || items[0] || "";
    return {
        id: `${src.id}:menus:${str(item.id) || `${name}:${date}`}`,
        kind: "note",
        title: isPizza ? `${name} daily pizza, ${date}` : `${name}, ${date}`,
        text: [what + (item.price ? ` (${str(item.price)})` : ""), str(item.hours), where].filter(Boolean).join(". "),
        date: date || undefined,
        location: where || undefined,
        url: str(item.url) || src.url,
        source: src,
        fetched_at: fetchedAt,
        tags: [...category, "menu"],
        extra: item,
    };
}
/** A local news headline, with the outlet it came from. */
function newsRecord(item, src, fetchedAt) {
    const outlet = str(item.source?.name);
    const published = str(item.published_at);
    const date = published && !Number.isNaN(Date.parse(published)) ? toLocalIso(new Date(published)).slice(0, 10) : published.slice(0, 10);
    return {
        id: `${src.id}:news_items:${str(item.id) || str(item.url)}`,
        kind: "archive-note",
        title: str(item.name ?? item.title),
        text: `${str(item.description)}${outlet ? ` (${outlet})` : ""}`.trim(),
        date: date || undefined,
        url: str(item.url) || src.url,
        source: src,
        fetched_at: fetchedAt,
        tags: [...cats(item), "news"],
        extra: item,
    };
}
//# sourceMappingURL=neighborhood-api.js.map