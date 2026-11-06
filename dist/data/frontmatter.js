import YAML from "yaml";
/** Minimal frontmatter splitter: `---\nyaml\n---\nbody`. */
export function parseFrontmatter(text) {
    const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
    if (!m)
        return { data: {}, body: text };
    let data = {};
    try {
        const parsed = YAML.parse(m[1]);
        if (parsed && typeof parsed === "object")
            data = parsed;
    }
    catch {
        data = {};
    }
    return { data, body: m[2] ?? "" };
}
export function toFrontmatter(data, body) {
    const yaml = YAML.stringify(data).trimEnd();
    return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}
//# sourceMappingURL=frontmatter.js.map