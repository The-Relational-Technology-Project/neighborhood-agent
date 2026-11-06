/** An RSS or Atom feed: a blog, a newsletter archive, a news site. Config: url, kind, limit. */
import type { NRecord, RecordKind } from "../data/types.js";
import { slug, sourceRef, type Adapter } from "./types.js";

const unescape = (s: string) => s.replace(/&lt;/g, "<").replace(/&gt;/g, ">").replace(/&quot;/g, '"').replace(/&#39;|&apos;/g, "'").replace(/&nbsp;/g, " ").replace(/&amp;/g, "&");
// CDATA first, then entities (feeds often escape their HTML), then strip tags.
const decode = (s: string) => unescape(s.replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, "$1")).replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim();
const tag = (xml: string, name: string) => xml.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, "i"))?.[1] ?? "";

export interface FeedItem { title: string; link: string; date: string; summary: string }

export function parseFeed(xml: string): FeedItem[] {
  const items = [...xml.matchAll(/<item[\s>][\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const entries = [...xml.matchAll(/<entry[\s>][\s\S]*?<\/entry>/gi)].map((m) => m[0]);
  return [
    ...items.map((x) => ({ title: decode(tag(x, "title")), link: decode(tag(x, "link")), date: decode(tag(x, "pubDate") || tag(x, "dc:date")), summary: decode(tag(x, "description") || tag(x, "content:encoded")) })),
    ...entries.map((x) => ({ title: decode(tag(x, "title")), link: x.match(/<link[^>]*href="([^"]+)"/i)?.[1] ?? "", date: decode(tag(x, "updated") || tag(x, "published")), summary: decode(tag(x, "summary") || tag(x, "content")) })),
  ].filter((i) => i.title);
}

export const rssAdapter: Adapter = {
  id: "rss",
  async fetch(ctx) {
    const url = String(ctx.source.config?.url ?? "");
    if (!url) throw new Error("rss: url missing");
    const res = await ctx.http(url);
    if (!res.ok) throw new Error(`rss: ${res.status}`);
    return await res.text();
  },
  normalize(raw, ctx): NRecord[] {
    const c = ctx.source.config ?? {};
    const src = sourceRef(ctx);
    const kind = String(c.kind ?? "archive-note") as RecordKind;
    return parseFeed(String(raw ?? "")).slice(0, Number(c.limit ?? 30)).map((it) => {
      const d = Date.parse(it.date);
      return {
        id: `${src.id}:rss:${slug(it.link || it.title)}`,
        kind,
        title: it.title,
        text: it.summary.slice(0, 600),
        date: Number.isFinite(d) ? new Date(d).toISOString().slice(0, 10) : undefined,
        url: it.link || src.url,
        source: src,
        fetched_at: ctx.fetchedAt,
        tags: [kind, "feed"],
      };
    });
  },
};
