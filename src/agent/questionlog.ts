/**
 * The aggregated question log: one row per exchange, by topic and ISO week. Stored locally as
 * counts only, rendered into log/questions.md by PR. No names, no handles, no message text.
 */
import fs from "node:fs/promises";
import path from "node:path";

export const TOPICS = [
  "events", "food", "places-and-hours", "meeting-people", "groups", "sharing-and-borrowing", "beach-and-ocean",
  "wildlife", "dogs", "kids-and-family", "housing", "safety", "transit", "history", "the-agent", "proposal",
  "correction", "about-a-person", "other",
] as const;
export type Topic = (typeof TOPICS)[number];

export interface Row { asked: number; referral: number; dont_know: number }
export type LogData = Record<string, Record<string, Row>>; // week -> topic -> row

export function isoWeek(d = new Date()): string {
  const date = new Date(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()));
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const yearStart = new Date(Date.UTC(date.getUTCFullYear(), 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86400000 + 1) / 7);
  return `${date.getUTCFullYear()}-W${String(week).padStart(2, "0")}`;
}

export class QuestionLog {
  private data: LogData = {};
  private file: string;
  constructor(cacheDir: string) { this.file = path.join(cacheDir, "questionlog.json"); }

  async load(): Promise<void> {
    try { this.data = JSON.parse(await fs.readFile(this.file, "utf8")) as LogData; } catch { this.data = {}; }
  }

  async add(topic: string, referral: boolean, dontKnow: boolean, week = isoWeek()): Promise<void> {
    const t: Topic = (TOPICS as readonly string[]).includes(topic) ? (topic as Topic) : "other";
    const wk = (this.data[week] ??= {});
    const row = (wk[t] ??= { asked: 0, referral: 0, dont_know: 0 });
    row.asked += 1; if (referral) row.referral += 1; if (dontKnow) row.dont_know += 1;
    try { await fs.mkdir(path.dirname(this.file), { recursive: true }); await fs.writeFile(this.file, JSON.stringify(this.data)); } catch { /* best effort */ }
  }

  /** How many times a topic has come up, all weeks. */
  count(topic: string): number {
    let n = 0;
    for (const wk of Object.values(this.data)) n += wk[topic]?.asked ?? 0;
    return n;
  }

  all(): LogData { return structuredClone(this.data); }

  /** Rows for weeks not already in the repo's log, newest week first. */
  rowsNotIn(existingMd: string): string[] {
    const present = new Set([...existingMd.matchAll(/^\|\s*(\d{4}-W\d{2})\s*\|\s*([a-z-]+)\s*\|/gm)].map((m) => `${m[1]}|${m[2]}`));
    const rows: string[] = [];
    for (const week of Object.keys(this.data).sort().reverse()) {
      for (const [topic, r] of Object.entries(this.data[week]).sort()) {
        if (!present.has(`${week}|${topic}`)) rows.push(`| ${week} | ${topic} | ${r.asked} | ${r.referral} | ${r.dont_know} |`);
      }
    }
    return rows;
  }
}
