/**
 * A Neighborhood API feed (events, groups, assets, plans, notices, dreams).
 *
 * Config, either:
 *   base_url: https://feed.example.org      → GET {base_url}/events, /groups, …
 *   endpoints: { events: https://…/get-public-events }   → only the collections listed
 * plus optional `query` appended to every request, with {today} and {today+N} filled in as
 * YYYY-MM-DD in the neighborhood's time zone. Responses may be a bare array, { data: [...] },
 * or { <collection>: [...] } as the spec's reference implementations return.
 */
import type { NRecord, RecordKind } from "../data/types.js";
import { localDate } from "../data/index.js";
import { toLocalIso } from "./ics.js";
import { sourceRef, type Adapter, type AdapterContext } from "./types.js";

const COLLECTIONS: Array<[string, RecordKind]> = [
  ["events", "event"],
  ["groups", "group"],
  ["assets", "resource"],
  ["plans", "proposal"],
  ["notices", "note"],
  ["dreams", "proposal"],
];

export function fillDates(q: string, now = new Date()): string {
  return q.replace(/\{today(?:\+(\d+))?\}/g, (_m, n) => {
    const d = new Date(now);
    if (n) d.setDate(d.getDate() + Number(n));
    return localDate(d);
  });
}

function urls(ctx: AdapterContext): Array<[string, string]> {
  const c = ctx.source.config ?? {};
  const query = c.query ? fillDates(String(c.query)) : "";
  const withQuery = (u: string) => (query ? `${u}${u.includes("?") ? "&" : "?"}${query}` : u);
  const endpoints = c.endpoints as Record<string, string> | undefined;
  if (endpoints && Object.keys(endpoints).length) return Object.entries(endpoints).map(([coll, u]) => [coll, withQuery(String(u))]);
  const base = String(c.base_url ?? "").replace(/\/$/, "");
  if (!base) return [];
  return COLLECTIONS.map(([coll]) => [coll, withQuery(`${base}/${coll}`)]);
}

export const neighborhoodApiAdapter: Adapter = {
  id: "neighborhood-api",
  async fetch(ctx) {
    const list = urls(ctx);
    if (!list.length) throw new Error("neighborhood-api: set base_url or endpoints");
    const out: Record<string, unknown[]> = {};
    let lastErr: unknown;
    for (const [coll, url] of list) {
      try {
        const res = await ctx.http(url);
        if (!res.ok) throw new Error(`${coll} ${res.status}`);
        const body = (await res.json()) as unknown;
        const b = body as Record<string, unknown>;
        out[coll] = Array.isArray(body) ? body : ((b?.[coll] ?? b?.data ?? []) as unknown[]);
      } catch (err) {
        lastErr = err; // a missing collection is fine as long as one works
      }
    }
    if (!Object.keys(out).length) throw new Error(`neighborhood-api: nothing readable (${(lastErr as Error)?.message ?? "no response"})`);
    return out;
  },
  normalize(raw, ctx): NRecord[] {
    const src = sourceRef(ctx);
    const data = (raw ?? {}) as Record<string, Record<string, unknown>[]>;
    const out: NRecord[] = [];
    for (const [coll, kind] of COLLECTIONS) {
      for (const item of data[coll] ?? []) {
        const loc = item.location as Record<string, unknown> | undefined;
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
