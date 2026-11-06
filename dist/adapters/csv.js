import { renderTemplate } from "./socrata.js";
import { sourceRef } from "./types.js";
export function parseCsv(text) {
    const rows = [];
    let row = [], cell = "", q = false;
    const s = text.replace(/^﻿/, "");
    for (let i = 0; i < s.length; i++) {
        const ch = s[i];
        if (q) {
            if (ch === '"' && s[i + 1] === '"') {
                cell += '"';
                i++;
            }
            else if (ch === '"')
                q = false;
            else
                cell += ch;
        }
        else if (ch === '"')
            q = true;
        else if (ch === ",") {
            row.push(cell);
            cell = "";
        }
        else if (ch === "\n" || ch === "\r") {
            if (ch === "\r" && s[i + 1] === "\n")
                i++;
            row.push(cell);
            rows.push(row);
            row = [];
            cell = "";
        }
        else
            cell += ch;
    }
    if (cell || row.length) {
        row.push(cell);
        rows.push(row);
    }
    const [head, ...body] = rows.filter((r) => r.some((c) => c.trim()));
    if (!head)
        return [];
    const keys = head.map((h) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, ""));
    return body.map((r) => Object.fromEntries(keys.map((k, i) => [k, (r[i] ?? "").trim()])));
}
export const csvAdapter = {
    id: "csv",
    async fetch(ctx) {
        const url = String(ctx.source.config?.url ?? "");
        if (!url)
            throw new Error("csv: url missing");
        const res = await ctx.http(url);
        if (!res.ok)
            throw new Error(`csv: ${res.status}`);
        return await res.text();
    },
    normalize(raw, ctx) {
        const c = ctx.source.config ?? {};
        const labels = (c.labels ?? {});
        const src = sourceRef(ctx);
        const kind = String(c.kind ?? "resource");
        return parseCsv(String(raw ?? "")).map((row, i) => {
            const id = c.id ? renderTemplate(String(c.id).includes("{") ? String(c.id) : `{${String(c.id)}}`, row, labels) : String(i);
            const date = c.date ? String(row[String(c.date)] ?? "").slice(0, 10) : "";
            return {
                id: `${src.id}:csv:${id || i}`,
                kind,
                title: c.title ? renderTemplate(String(c.title), row, labels) : Object.values(row)[0] ?? `row ${i + 1}`,
                text: c.text ? renderTemplate(String(c.text), row, labels) : Object.entries(row).map(([k, v]) => (v ? `${k}: ${v}` : "")).filter(Boolean).join(". "),
                date: date || undefined,
                location: c.location ? String(row[String(c.location)] ?? "") || undefined : undefined,
                url: c.url ? renderTemplate(String(c.url), row, labels) || src.url : src.url,
                source: src,
                fetched_at: ctx.fetchedAt,
                tags: [kind, ...(Array.isArray(c.tags) ? c.tags : [])],
                extra: row,
            };
        });
    },
};
//# sourceMappingURL=csv.js.map