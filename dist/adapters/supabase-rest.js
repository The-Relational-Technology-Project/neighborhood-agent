import { localDate } from "../data/index.js";
import { sourceRef } from "./types.js";
function cfg(ctx) {
    const c = ctx.source.config ?? {};
    return {
        projectUrl: String(c.project_url ?? "").replace(/\/$/, ""),
        key: ctx.secret(c.key_env ? String(c.key_env) : undefined),
        tables: (c.tables ?? []),
    };
}
export const supabaseRestAdapter = {
    id: "supabase-rest",
    async fetch(ctx) {
        const { projectUrl, key, tables } = cfg(ctx);
        if (!projectUrl)
            throw new Error("supabase-rest: project_url missing");
        if (!key)
            throw new Error(`supabase-rest: no key in env ${String(ctx.source.config?.key_env ?? "")}`);
        const today = localDate();
        const out = { tables: {} };
        for (const t of tables) {
            const filter = (t.filter ?? "").replace(/\{today\}/g, today);
            const url = `${projectUrl}/rest/v1/${t.table}?select=${encodeURIComponent(t.select)}${filter ? `&${filter}` : ""}`;
            const res = await ctx.http(url, { headers: { apikey: key, Authorization: `Bearer ${key}` } });
            if (!res.ok)
                throw new Error(`supabase-rest: ${t.table} ${res.status}`);
            out.tables[t.table] = (await res.json());
        }
        return out;
    },
    normalize(raw, ctx) {
        const { tables } = cfg(ctx);
        const data = raw?.tables ?? {};
        const src = sourceRef(ctx);
        const out = [];
        for (const t of tables) {
            for (const row of (data[t.table] ?? [])) {
                const rec = rowToRecord(t, row, src, ctx.fetchedAt);
                if (rec)
                    out.push(rec);
            }
        }
        return out;
    },
};
function s(v) {
    return v == null ? "" : String(v);
}
function rowToRecord(t, row, src, fetchedAt) {
    const id = `${src.id}:${t.table}:${s(row.id) || JSON.stringify(row).slice(0, 40)}`;
    const base = { id, source: src, fetched_at: fetchedAt, extra: row };
    switch (t.table) {
        case "events": {
            const date = s(row.event_date) || s(row.start_time).slice(0, 10);
            return {
                ...base,
                kind: "event",
                title: s(row.title),
                text: [s(row.description), row.event_type ? `Type: ${s(row.event_type)}.` : ""].filter(Boolean).join(" "),
                date,
                start: s(row.start_time) || undefined,
                end: s(row.end_time) || undefined,
                location: s(row.location) || undefined,
                url: s(row.source_url) || src.url,
                tags: [s(row.event_type)].filter(Boolean),
            };
        }
        case "daily_menus": {
            const restaurant = s(row.restaurant);
            const item = s(row.special_item);
            const isPizza = s(row.category) === "pizza";
            return {
                ...base,
                kind: "note",
                title: isPizza ? `${restaurant} daily pizza, ${s(row.menu_date)}` : `${restaurant} menu, ${s(row.menu_date)}`,
                text: `${item}${row.price ? ` (${s(row.price)})` : ""}${row.hours ? `. ${s(row.hours)}` : ""}${row.location ? `. ${s(row.location)}` : ""}`,
                date: s(row.menu_date),
                url: src.url,
                tags: [s(row.category), "menu", isPizza ? "pizza" : ""].filter(Boolean),
            };
        }
        case "news_items":
            return {
                ...base,
                kind: "archive-note",
                title: s(row.title),
                text: `${s(row.summary)} (${s(row.source_name)})`,
                date: s(row.published_at).slice(0, 10) || undefined,
                url: s(row.source_url) || src.url,
                tags: ["news"],
            };
        case "communities":
            return {
                ...base,
                kind: "resource",
                title: s(row.name),
                text: `${s(row.description)} ${row.public_location_label ? `Where: ${s(row.public_location_label)}.` : ""}`.trim(),
                url: row.slug ? `${src.url}/c/${s(row.slug)}` : src.url,
                tags: ["sharing", "lending", "tools"],
            };
        default: {
            const title = s(row.title ?? row.name);
            if (!title)
                return undefined;
            return {
                ...base,
                kind: t.kind,
                title,
                text: s(row.description ?? row.summary ?? row.text),
                date: s(row.date ?? row.event_date).slice(0, 10) || undefined,
                url: s(row.url ?? row.source_url) || src.url,
            };
        }
    }
}
//# sourceMappingURL=supabase-rest.js.map