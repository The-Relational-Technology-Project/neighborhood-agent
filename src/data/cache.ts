/**
 * Per-source cache on disk. Keeps the raw payload next to the normalized records so a steward can
 * audit what the agent saw. Never hits a source on every message.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { NRecord } from "./types.js";

export interface CacheEntry {
  source_id: string;
  fetched_at: string;
  ttl_ms: number;
  raw: unknown;
  records: NRecord[];
  error?: string;
}

export function parseDuration(s: string | undefined, fallbackMs = 3_600_000): number {
  if (!s) return fallbackMs;
  const m = String(s).trim().match(/^(\d+)\s*(ms|s|m|h|d)$/);
  if (!m) return fallbackMs;
  const n = Number(m[1]);
  const unit = { ms: 1, s: 1000, m: 60_000, h: 3_600_000, d: 86_400_000 }[m[2]]!;
  return n * unit;
}

export class SourceCache {
  constructor(private dir: string) {}

  private file(id: string): string {
    return path.join(this.dir, "sources", `${id.replace(/[^a-z0-9_-]/gi, "_")}.json`);
  }

  async get(id: string): Promise<CacheEntry | undefined> {
    try {
      return JSON.parse(await fs.readFile(this.file(id), "utf8")) as CacheEntry;
    } catch {
      return undefined;
    }
  }

  async set(entry: CacheEntry): Promise<void> {
    await fs.mkdir(path.dirname(this.file(entry.source_id)), { recursive: true });
    await fs.writeFile(this.file(entry.source_id), JSON.stringify(entry, null, 1));
  }

  isFresh(entry: CacheEntry | undefined, now = Date.now()): boolean {
    if (!entry) return false;
    return now - Date.parse(entry.fetched_at) < entry.ttl_ms;
  }
}
