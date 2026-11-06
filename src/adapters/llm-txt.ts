/**
 * Reads a site's text-for-machines endpoint (llm.txt style) and turns `### Category` / `**Group**`
 * sections into group records. outersunset.us publishes exactly this.
 */
import type { NRecord } from "../data/types.js";
import { slug, sourceRef, type Adapter } from "./types.js";

export interface ParsedGroup {
  category: string;
  name: string;
  description: string;
  link?: string;
  meets?: string;
}

export function parseGroupsText(text: string): ParsedGroup[] {
  const groups: ParsedGroup[] = [];
  let category = "";
  let cur: ParsedGroup | undefined;
  const flush = () => {
    if (cur && cur.name) groups.push({ ...cur, description: cur.description.trim() });
    cur = undefined;
  };
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    const h = line.match(/^###\s+(?:\d+\.\s*)?(.+)$/);
    if (h) { flush(); category = h[1].trim(); continue; }
    if (line.startsWith("## ")) { flush(); category = ""; continue; }
    const g = line.match(/^\*\*(.+?)\*\*$/);
    if (g && category) { flush(); cur = { category, name: g[1].trim(), description: "" }; continue; }
    if (!cur) continue;
    const link = line.match(/^Link:\s*(\S+)/i);
    if (link) { cur.link = link[1]; continue; }
    const meets = line.match(/^(?:Meets|When):\s*(.+)/i);
    if (meets) { cur.meets = meets[1]; continue; }
    if (line) cur.description += (cur.description ? " " : "") + line;
  }
  flush();
  return groups;
}

export const llmTxtAdapter: Adapter = {
  id: "llm-txt",
  async fetch(ctx) {
    const c = ctx.source.config ?? {};
    const urls = [String(c.text_url ?? ""), String(c.fallback_url ?? "")].filter(Boolean);
    let lastErr: unknown;
    for (const url of urls) {
      try {
        const res = await ctx.http(url);
        if (!res.ok) throw new Error(`llm-txt: ${url} ${res.status}`);
        const text = await res.text();
        if (text.trim().length > 100) return text;
      } catch (err) {
        lastErr = err;
      }
    }
    throw lastErr ?? new Error("llm-txt: no url");
  },
  normalize(raw, ctx): NRecord[] {
    const src = sourceRef(ctx);
    return parseGroupsText(String(raw ?? "")).map((g) => ({
      id: `${src.id}:groups:${slug(g.name)}`,
      kind: "group" as const,
      title: g.name,
      text: `${g.description}${g.meets ? ` Meets: ${g.meets}.` : ""} Category: ${g.category}.`,
      url: g.link ?? src.url,
      source: src,
      fetched_at: ctx.fetchedAt,
      tags: [g.category, "group"],
    }));
  },
};
