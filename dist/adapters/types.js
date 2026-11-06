export function sourceRef(ctx) {
    return { id: ctx.source.id, name: ctx.source.name, url: ctx.source.url };
}
export function slug(s) {
    return s
        .toLowerCase()
        .normalize("NFKD")
        .replace(/[^\w\s-]/g, "")
        .trim()
        .replace(/[\s_]+/g, "-")
        .replace(/-+/g, "-")
        .slice(0, 60);
}
//# sourceMappingURL=types.js.map