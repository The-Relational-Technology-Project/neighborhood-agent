import type { DataRepo, NRecord, SourceDef } from "../data/types.js";

export interface AdapterContext {
  repo: DataRepo;
  source: SourceDef;
  fetchedAt: string;
  /** Resolve a secret named in the source config (`key_env`). */
  secret: (envName: string | undefined) => string | undefined;
  /** Fetch with a timeout and a plain user agent. */
  http: (url: string, init?: RequestInit) => Promise<Response>;
}

export interface Adapter {
  id: string;
  /** Fetch the raw payload. Throw on failure; the loader keeps the stale cache. */
  fetch(ctx: AdapterContext): Promise<unknown>;
  /** Turn the raw payload into records. Must be pure and safe to re-run on a cached payload. */
  normalize(raw: unknown, ctx: AdapterContext): NRecord[];
}

export function sourceRef(ctx: AdapterContext) {
  return { id: ctx.source.id, name: ctx.source.name, url: ctx.source.url };
}

export function slug(s: string): string {
  return s
    .toLowerCase()
    .normalize("NFKD")
    .replace(/[^\w\s-]/g, "")
    .trim()
    .replace(/[\s_]+/g, "-")
    .replace(/-+/g, "-")
    .slice(0, 60);
}
