import { slug } from "./types.js";
function fileFor(ctx) {
    const file = String(ctx.source.config?.file ?? "");
    return ctx.repo.recs.find((r) => r.file === file);
}
export function recText(r, group) {
    const parts = [];
    const where = [r.subcategory, r.kind].filter(Boolean).join(", ");
    if (where)
        parts.push(`${where}.`);
    if (r.what)
        parts.push(r.what);
    if (r.vouches !== undefined)
        parts.push(`Vouched for by ${r.vouches} ${Number(r.vouches) === 1 ? "neighbor" : "neighbors"} in ${group}${r.when ? `, ${r.when}` : ""}.`);
    else if (r.when)
        parts.push(`Mentioned ${r.when}.`);
    if (r.from_earlier_knowledge_base)
        parts.push(`From ${group}'s earlier knowledge base (no date).`);
    if (r.links?.length)
        parts.push(`Links: ${r.links.map((l) => `${l.label} ${l.url}`).join("; ")}.`);
    if (r.contact)
        parts.push(`No public contact listed: ${r.contact} for their number. Do not supply one.`);
    return parts.join(" ");
}
export const recsAdapter = {
    id: "recs",
    async fetch(ctx) {
        const f = fileFor(ctx);
        if (!f)
            throw new Error(`recs: ${String(ctx.source.config?.file ?? "(no file)")} not found in the repo`);
        return { file: f.file, count: f.recs.length };
    },
    normalize(_raw, ctx) {
        const f = fileFor(ctx);
        if (!f)
            return [];
        const group = String(ctx.source.config?.group ?? f.meta.title ?? "the group");
        const asOf = f.meta.as_of ? ` (as of ${f.meta.as_of})` : "";
        const src = { id: ctx.source.id, name: `${f.meta.title ?? ctx.source.name}${asOf}`, url: ctx.source.url };
        const seen = new Map();
        return f.recs.filter((r) => r && r.name).map((r) => {
            let id = slug(r.name) || "rec";
            const n = (seen.get(id) ?? 0) + 1;
            seen.set(id, n);
            if (n > 1)
                id = `${id}-${n}`;
            return {
                id: `${ctx.source.id}:recs:${id}`,
                kind: "recommendation",
                title: r.name,
                text: recText(r, group),
                url: r.links?.[0]?.url ?? src.url,
                source: src,
                fetched_at: ctx.fetchedAt,
                tags: [r.category, r.subcategory, r.kind, "recommendation"].filter((t) => Boolean(t)),
                extra: r,
            };
        });
    },
};
//# sourceMappingURL=recs.js.map