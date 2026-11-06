import { localDate } from "../data/index.js";
import { sourceRef } from "./types.js";
export function fillSoqlDates(s, now = new Date()) {
    return s.replace(/\{today(?:([+-])(\d+))?\}/g, (_m, sign, n) => {
        const d = new Date(now);
        if (n)
            d.setDate(d.getDate() + (sign === "-" ? -Number(n) : Number(n)));
        return localDate(d);
    });
}
function fieldValue(row, expr, labels) {
    const [name, filter] = expr.split("|").map((x) => x.trim());
    const raw = row[name];
    if (raw === undefined || raw === null)
        return "";
    let v = typeof raw === "object" ? (raw.url ?? JSON.stringify(raw)) : String(raw);
    v = v.trim();
    if (filter === "date")
        v = v.slice(0, 10);
    else if (filter === "num") {
        const n = Number(v);
        v = Number.isFinite(n) ? String(Math.round(n * 100) / 100) : v;
    }
    else if (filter === "label")
        v = labels[name]?.[v] ?? v;
    else if (filter === "size") {
        const n = Number(v);
        v = !Number.isFinite(n) ? "" : n >= 50 ? "Major housing project" : n >= 10 ? "Large housing project" : n >= 3 ? "Small multi-unit project" : "";
    }
    return v;
}
const EMPTYISH = new Set(["", "0", "0.0", "null", "undefined"]);
export function renderTemplate(tpl, row, labels = {}) {
    const one = (t) => t.replace(/\{([^{}]+)\}/g, (_m, expr) => fieldValue(row, expr, labels));
    const withOptional = tpl.replace(/\[([^[\]]*)\]/g, (_m, inner) => {
        const fields = [...inner.matchAll(/\{([^{}]+)\}/g)].map((m) => fieldValue(row, m[1], labels));
        return fields.some((f) => EMPTYISH.has(f)) ? "" : one(inner);
    });
    return one(withOptional).replace(/\s{2,}/g, " ").trim();
}
export function sodaUrl(c, now = new Date()) {
    const params = new URLSearchParams();
    if (c.select)
        params.set("$select", String(c.select));
    if (c.where)
        params.set("$where", fillSoqlDates(String(c.where), now));
    if (c.order)
        params.set("$order", String(c.order));
    params.set("$limit", String(c.limit ?? 500));
    return `https://${String(c.domain)}/resource/${String(c.dataset)}.json?${params}`;
}
export const socrataAdapter = {
    id: "socrata",
    async fetch(ctx) {
        const c = ctx.source.config ?? {};
        if (!c.domain || !c.dataset)
            throw new Error("socrata: domain and dataset are required");
        const token = process.env.SOCRATA_APP_TOKEN;
        const res = await ctx.http(sodaUrl(c), { headers: token ? { "X-App-Token": token } : {} });
        if (!res.ok)
            throw new Error(`socrata: ${String(c.dataset)} ${res.status} ${(await res.text()).slice(0, 160)}`);
        return await res.json();
    },
    normalize(raw, ctx) {
        const c = ctx.source.config ?? {};
        const labels = (c.labels ?? {});
        const rows = Array.isArray(raw) ? raw : [];
        const src = sourceRef(ctx);
        const kind = String(c.kind ?? "note");
        return rows.map((row, i) => {
            const idSpec = c.id ? String(c.id) : "";
            const id = idSpec.includes("{") ? renderTemplate(idSpec, row, labels) : idSpec ? fieldValue(row, idSpec, labels) : String(i);
            const date = c.date ? fieldValue(row, `${String(c.date)}|date`, labels) : "";
            return {
                id: `${src.id}:${String(c.dataset)}:${id || i}`,
                kind,
                title: c.title ? renderTemplate(String(c.title), row, labels) : id,
                text: c.text ? renderTemplate(String(c.text), row, labels) : "",
                date: date || undefined,
                location: c.location ? fieldValue(row, String(c.location), labels) || undefined : undefined,
                url: c.url ? renderTemplate(String(c.url), row, labels) : src.url,
                source: src,
                fetched_at: ctx.fetchedAt,
                tags: [kind, ...(Array.isArray(c.tags) ? c.tags : [])],
                extra: row,
            };
        });
    },
};
//# sourceMappingURL=socrata.js.map