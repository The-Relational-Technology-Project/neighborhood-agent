/**
 * A daily token budget with a hard stop, and a per-IP rate limit. When the budget is spent the
 * agent says "I'm resting, try again tomorrow" instead of failing silently.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { localDate } from "../data/index.js";

interface Day { date: string; input: number; output: number; cache_read: number; cache_write: number; usd: number; messages: number }

export class Budget {
  private day: Day = { date: localDate(), input: 0, output: 0, cache_read: 0, cache_write: 0, usd: 0, messages: 0 };
  private file: string;
  constructor(cacheDir: string, private limitUsd: number, private inPerM: number, private outPerM: number) {
    this.file = path.join(cacheDir, "budget.json");
  }

  async load(): Promise<void> {
    try {
      const d = JSON.parse(await fs.readFile(this.file, "utf8")) as Day;
      if (d.date === localDate()) this.day = d;
    } catch { /* fresh day */ }
  }

  private roll() {
    const today = localDate();
    if (this.day.date !== today) this.day = { date: today, input: 0, output: 0, cache_read: 0, cache_write: 0, usd: 0, messages: 0 };
  }

  get spent(): number { this.roll(); return this.day.usd; }
  get limit(): number { return this.limitUsd; }
  get today(): Day { this.roll(); return { ...this.day }; }

  canSpend(): boolean { this.roll(); return this.day.usd < this.limitUsd; }

  async record(usage: { input_tokens?: number | null; output_tokens?: number | null; cache_read_input_tokens?: number | null; cache_creation_input_tokens?: number | null }): Promise<void> {
    this.roll();
    const i = usage.input_tokens ?? 0, o = usage.output_tokens ?? 0, cr = usage.cache_read_input_tokens ?? 0, cw = usage.cache_creation_input_tokens ?? 0;
    this.day.input += i; this.day.output += o; this.day.cache_read += cr; this.day.cache_write += cw;
    this.day.usd += (i * this.inPerM + cr * this.inPerM * 0.1 + cw * this.inPerM * 1.25 + o * this.outPerM) / 1_000_000;
    this.day.messages += 1;
    try {
      await fs.mkdir(path.dirname(this.file), { recursive: true });
      await fs.writeFile(this.file, JSON.stringify(this.day));
    } catch { /* best effort */ }
  }
}

export class RateLimiter {
  private hits = new Map<string, number[]>();
  constructor(private max: number, private windowMs = 10 * 60 * 1000) {}
  allow(key: string, now = Date.now()): boolean {
    const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
    if (list.length >= this.max) { this.hits.set(key, list); return false; }
    list.push(now);
    this.hits.set(key, list);
    if (this.hits.size > 5000) for (const [k, v] of this.hits) if (!v.some((t) => now - t < this.windowMs)) this.hits.delete(k);
    return true;
  }
}
