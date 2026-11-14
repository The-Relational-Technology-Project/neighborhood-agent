/**
 * Street cleaning for one block, read live from the city's open data. Configured by a source in
 * sources.yml marked `live_query: street-sweeping` (a Socrata dataset with one row per side of a
 * block: the street, the cross streets, the weekday, the hours, and which weeks of the month).
 * A place with no such source loses nothing.
 *
 * The city's schedule is a starting point. The signs on the block are the last word, and the
 * answer always says so.
 */
import type { Block, DataRepo, SourceDef } from "../data/types.js";
import { localDate } from "../data/index.js";
import { httpFetch } from "../data/loader.js";
import { streetKey } from "./geo.js";

export interface SweepSide {
  /** "East", "West", "North", "South", or the city's own word for the side. */
  side: string;
  /** In words, as the city writes it: "Mon 1st & 3rd". */
  days: string;
  /** "Mon", "Tue", ... */
  weekday: string;
  /** Hours on a 24-hour clock: 12 and 14 mean noon to 2pm. */
  from: number;
  to: number;
  /** Which of that weekday in the month: [1, 3] means the first and third. */
  weeks: number[];
  /** Whether it is swept on holidays. */
  holidays: boolean;
  /** The next day it is due, YYYY-MM-DD in the place's time zone (holidays not considered). */
  next: string | null;
}

export interface Sweeping {
  block_id: string;
  block: string;
  sides: SweepSide[];
  source: { name: string; url: string; license: string | null };
  fetched_at: string;
  note: string;
}

const NOTE = "From the city's published schedule. The signs on the block are the last word, and they change: read them when you park.";
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function findSweepSource(repo: Pick<DataRepo, "sources">): SourceDef | undefined {
  return repo.sources.find((s) => s.status === "live" && String((s as unknown as Record<string, unknown>).live_query ?? "") === "street-sweeping");
}

/** The next date, from `today` on, that is the right weekday and the right week of its month. */
export function nextSweep(weekday: string, weeks: number[], today = localDate()): string | null {
  const want = DAYS.indexOf(weekday.slice(0, 3));
  if (want < 0 || !weeks.length) return null;
  const d = new Date(`${today}T12:00:00Z`);
  for (let i = 0; i < 62; i++) {
    if (d.getUTCDay() === want && weeks.includes(Math.ceil(d.getUTCDate() / 7))) return d.toISOString().slice(0, 10);
    d.setUTCDate(d.getUTCDate() + 1);
  }
  return null;
}

type Row = Record<string, string>;

/** Rows for one block: the row's street is the block's street, and its two cross streets are the block's. */
export function rowsForBlock(rows: Row[], block: Block): Row[] {
  const [street, ...cross] = block.streets.map(streetKey);
  if (!street || cross.length < 2) return [];
  return rows.filter((r) => {
    if (streetKey(r.corridor ?? "") !== street) return false;
    const ends = String(r.limits ?? "").split(/\s+-\s+/).map(streetKey);
    return ends.length === 2 && cross.every((c) => ends.includes(c));
  });
}

export function toSides(rows: Row[], today = localDate()): SweepSide[] {
  const seen = new Set<string>();
  const out: SweepSide[] = [];
  for (const r of rows) {
    const weeks = [1, 2, 3, 4, 5].filter((n) => r[`week${n}`] === "1");
    const side: SweepSide = {
      side: r.blockside || (r.cnnrightleft === "L" ? "Left" : r.cnnrightleft === "R" ? "Right" : "Both"),
      days: r.fullname ?? r.weekday ?? "", weekday: (r.weekday ?? "").slice(0, 3),
      from: Number(r.fromhour), to: Number(r.tohour), weeks, holidays: r.holidays === "1",
      next: nextSweep(r.weekday ?? "", weeks, today),
    };
    const key = `${side.side}|${side.weekday}|${side.from}|${side.to}|${weeks.join("")}`;
    if (!seen.has(key)) { seen.add(key); out.push(side); }
  }
  return out.sort((a, b) => a.side.localeCompare(b.side) || DAYS.indexOf(a.weekday) - DAYS.indexOf(b.weekday));
}

const cache = new Map<string, { at: number; value: Sweeping | undefined }>();
const KEEP_MS = 12 * 60 * 60_000;

/** The street cleaning schedule for one block, or undefined when the place has no source or the city lists none. */
export async function sweepingFor(repo: Pick<DataRepo, "sources">, block: Block): Promise<Sweeping | undefined> {
  const src = findSweepSource(repo);
  if (!src) return undefined;
  const hit = cache.get(block.id);
  if (hit && Date.now() - hit.at < KEEP_MS) return hit.value ? { ...hit.value, sides: hit.value.sides.map((s) => ({ ...s, next: nextSweep(s.weekday, s.weeks) })) } : undefined;
  const cfg = src.config ?? {};
  // The street's first word is enough to narrow the query; the exact match happens here, so
  // "6th Ave" never matches "46th Ave".
  const first = (block.streets[0] ?? "").trim().split(/\s+/)[0].toUpperCase().replace(/'/g, "''").replace(/%/g, "");
  if (!first) return undefined;
  let value: Sweeping | undefined;
  try {
    const u = new URLSearchParams({ $where: `upper(corridor) like '${first}%'`, $limit: "400" });
    const token = process.env.SOCRATA_APP_TOKEN;
    const res = await httpFetch(`https://${String(cfg.domain)}/resource/${String(cfg.dataset)}.json?${u}`, { headers: token ? { "X-App-Token": token } : {} });
    if (!res.ok) throw new Error(`street cleaning data ${res.status}`);
    const sides = toSides(rowsForBlock((await res.json()) as Row[], block));
    value = sides.length ? { block_id: block.id, block: block.name, sides, source: { name: src.name, url: src.url, license: src.license ?? null }, fetched_at: new Date().toISOString(), note: NOTE } : undefined;
  } catch (err) {
    console.warn("[sweeping]", block.id, (err as Error).message);
    return undefined; // not cached: try again next time
  }
  cache.set(block.id, { at: Date.now(), value });
  return value;
}

const hour = (h: number) => (h === 0 ? "midnight" : h === 12 ? "noon" : h < 12 ? `${h}am` : `${h - 12}pm`);

/** The blocks a lookup is about (one block, or the blocks that meet at a corner), each with its schedule if the city lists one. */
export async function sweepingForBlocks(repo: Pick<DataRepo, "sources">, blocks: Block[]): Promise<Sweeping[]> {
  if (!findSweepSource(repo)) return [];
  return (await Promise.all(blocks.slice(0, 4).map((b) => sweepingFor(repo, b)))).filter((s): s is Sweeping => Boolean(s));
}

export function formatSweeping(s: Sweeping): string {
  const lines = s.sides.map((x) => `- ${x.side} side: ${x.days}, ${hour(x.from)} to ${hour(x.to)}${x.next ? ` (next: ${x.next})` : ""}${x.holidays ? "" : "; not on city holidays"}`);
  return [`Street cleaning on ${s.block} (${s.source.name}, ${s.source.url}):`, ...lines, s.note].join("\n");
}
