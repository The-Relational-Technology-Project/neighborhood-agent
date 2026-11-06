import YAML from "yaml";

/** Minimal frontmatter splitter: `---\nyaml\n---\nbody`. */
export function parseFrontmatter(text: string): { data: Record<string, unknown>; body: string } {
  const m = text.match(/^---\r?\n([\s\S]*?)\r?\n---\r?\n?([\s\S]*)$/);
  if (!m) return { data: {}, body: text };
  let data: Record<string, unknown> = {};
  try {
    const parsed = YAML.parse(m[1]);
    if (parsed && typeof parsed === "object") data = parsed as Record<string, unknown>;
  } catch {
    data = {};
  }
  return { data, body: m[2] ?? "" };
}

export function toFrontmatter(data: Record<string, unknown>, body: string): string {
  const yaml = YAML.stringify(data).trimEnd();
  return `---\n${yaml}\n---\n\n${body.trim()}\n`;
}
