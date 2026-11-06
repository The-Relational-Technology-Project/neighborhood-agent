/** A Neighborhood API feed (events, groups, assets, plans, notices, dreams). Config: base_url. */
import type { NRecord, RecordKind } from "../data/types.js";
import { sourceRef, type Adapter } from "./types.js";

const COLLECTIONS: Array<[string, RecordKind]> = [
  ["events", "event"],
  ["groups", "group"],
  ["assets", "resource"],
  ["plans", "proposal"],
  ["notices", "note"],
  ["dreams", "proposal"],
];

export const neighborhoodApiAdapter: Adapter = {
  id: "neighborhood-api",
  async fetch(ctx) {
    const base = String(ctx.source.config?.base_url ?? "").replace(/\/$/, "");
    if (!base) throw new Error("neighborhood-api: base_url not set");
    const out: Record<string, unknown[]> = {};
    for (const [coll] of COLLECTIONS) {
      try {
        const res = await ctx.http(`${base}/${coll}`);
        if (!res.ok) continue;
        const body = (await res.json()) as unknown;
        out[coll] = Array.isArray(body) ? body : ((body as { data?: unknown[] })?.data ?? []);
      } catch {
        // a missing collection is fine
      }
    }
    if (!Object.keys(out).length) throw new Error("neighborhood-api: nothing readable");
    return out;
  },
  normalize(raw, ctx): NRecord[] {
    const src = sourceRef(ctx);
    const data = (raw ?? {}) as Record<string, Record<string, unknown>[]>;
    const out: NRecord[] = [];
    for (const [coll, kind] of COLLECTIONS) {
      for (const item of data[coll] ?? []) {
        const loc = item.location as Record<string, unknown> | undefined;
        out.push({
          id: `${src.id}:${coll}:${String(item.id ?? item.name)}`,
          kind,
          title: String(item.name ?? item.title ?? ""),
          text: String(item.description ?? ""),
          date: item.start ? String(item.start).slice(0, 10) : undefined,
          start: item.start ? String(item.start) : undefined,
          end: item.end ? String(item.end) : undefined,
          location: loc ? [loc.name, loc.address].filter(Boolean).join(", ") : undefined,
          url: item.url ? String(item.url) : src.url,
          source: src,
          fetched_at: ctx.fetchedAt,
          tags: Array.isArray(item.category) ? item.category.map(String) : [],
          extra: item,
        });
      }
    }
    return out;
  },
};
