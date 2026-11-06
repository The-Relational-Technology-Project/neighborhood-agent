/**
 * A small iCalendar reader: VEVENTs with DTSTART/DTEND/SUMMARY/LOCATION/DESCRIPTION/URL and
 * weekly or daily RRULEs (BYDAY, UNTIL, COUNT, INTERVAL) expanded over a horizon. Enough for a
 * neighborhood calendar; not a full RFC 5545 implementation.
 */
import fs from "node:fs/promises";
import path from "node:path";
import type { NRecord } from "../data/types.js";
import { localDate } from "../data/index.js";
import { slug, sourceRef, type Adapter, type AdapterContext } from "./types.js";

export interface IcsEvent {
  uid: string;
  summary: string;
  description?: string;
  location?: string;
  url?: string;
  /** Local wall-clock ISO (no zone) or a date for all-day events. */
  start: string;
  end?: string;
  allDay: boolean;
  rrule?: string;
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n/g, "\n")
    .replace(/\n[ \t]/g, "")
    .split("\n");
}

function unescape(v: string): string {
  return v.replace(/\\n/g, "\n").replace(/\\,/g, ",").replace(/\;/g, ";").replace(/\\\\/g, "\\");
}

function parseDt(v: string, params: string): { iso: string; allDay: boolean } {
  const allDay = /VALUE=DATE(?!-TIME)/.test(params) || /^\d{8}$/.test(v);
  const m = v.match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})?(Z)?)?$/);
  if (!m) return { iso: v, allDay };
  const [, y, mo, d, h = "00", mi = "00", sec = "00", z] = m;
  if (allDay) return { iso: `${y}-${mo}-${d}`, allDay: true };
  if (z) {
    // UTC: convert to the neighborhood's local wall clock.
    const date = new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +sec));
    return { iso: toLocalIso(date), allDay: false };
  }
  return { iso: `${y}-${mo}-${d}T${h}:${mi}:${sec}`, allDay: false };
}

export function toLocalIso(date: Date, tz = process.env.TZ_NAME ?? "America/Los_Angeles"): string {
  const parts = new Intl.DateTimeFormat("en-CA", { timeZone: tz, hourCycle: "h23", year: "numeric", month: "2-digit", day: "2-digit", hour: "2-digit", minute: "2-digit", second: "2-digit" }).formatToParts(date);
  const p = Object.fromEntries(parts.map((x) => [x.type, x.value]));
  return `${p.year}-${p.month}-${p.day}T${p.hour}:${p.minute}:${p.second}`;
}

export function parseIcs(text: string): IcsEvent[] {
  const events: IcsEvent[] = [];
  let cur: Partial<IcsEvent> | undefined;
  for (const line of unfold(text)) {
    if (line === "BEGIN:VEVENT") {
      cur = { allDay: false };
      continue;
    }
    if (line === "END:VEVENT") {
      if (cur?.start && cur.summary) events.push({ uid: cur.uid ?? slug(cur.summary + cur.start), ...cur } as IcsEvent);
      cur = undefined;
      continue;
    }
    if (!cur) continue;
    const idx = line.indexOf(":");
    if (idx < 0) continue;
    const head = line.slice(0, idx);
    const value = line.slice(idx + 1);
    const [name, ...paramParts] = head.split(";");
    const params = paramParts.join(";");
    switch (name) {
      case "UID": cur.uid = value; break;
      case "SUMMARY": cur.summary = unescape(value); break;
      case "DESCRIPTION": cur.description = unescape(value); break;
      case "LOCATION": cur.location = unescape(value); break;
      case "URL": cur.url = value; break;
      case "RRULE": cur.rrule = value; break;
      case "DTSTART": { const d = parseDt(value, params); cur.start = d.iso; cur.allDay = d.allDay; break; }
      case "DTEND": cur.end = parseDt(value, params).iso; break;
    }
  }
  return events;
}

const DAYS = ["SU", "MO", "TU", "WE", "TH", "FR", "SA"];

/** Expand recurring events into concrete occurrences between from and to (inclusive dates). */
export function expand(events: IcsEvent[], from: string, to: string): IcsEvent[] {
  const out: IcsEvent[] = [];
  for (const ev of events) {
    if (!ev.rrule) {
      if (ev.start.slice(0, 10) >= from && ev.start.slice(0, 10) <= to) out.push(ev);
      continue;
    }
    const rule = Object.fromEntries(ev.rrule.split(";").map((kv) => kv.split("=") as [string, string]));
    const freq = rule.FREQ;
    if (freq !== "WEEKLY" && freq !== "DAILY") {
      if (ev.start.slice(0, 10) >= from && ev.start.slice(0, 10) <= to) out.push(ev);
      continue;
    }
    const interval = Math.max(1, Number(rule.INTERVAL ?? 1));
    const until = rule.UNTIL ? parseDt(rule.UNTIL, "").iso.slice(0, 10) : undefined;
    const count = rule.COUNT ? Number(rule.COUNT) : undefined;
    const byday = rule.BYDAY ? rule.BYDAY.split(",").map((d) => DAYS.indexOf(d.replace(/^[+-]?\d+/, ""))) : undefined;
    const startDate = ev.start.slice(0, 10);
    const timePart = ev.start.slice(10);
    const durationMs = ev.end ? Date.parse(ev.end) - Date.parse(ev.start) : 0;
    const first = new Date(startDate + "T00:00:00");
    let n = 0;
    for (let i = 0; i < 400; i++) {
      const d = new Date(first);
      d.setDate(first.getDate() + i);
      const ds = d.toISOString().slice(0, 10);
      if (until && ds > until) break;
      if (ds > to) break;
      const weeksSince = Math.floor(i / 7);
      if (freq === "WEEKLY") {
        if (weeksSince % interval !== 0) continue;
        if (byday ? !byday.includes(d.getDay()) : d.getDay() !== first.getDay()) continue;
      } else if (i % interval !== 0) continue;
      n++;
      if (count && n > count) break;
      if (ds < from) continue;
      const start = ds + timePart;
      const end = durationMs ? toLocalIsoNoZone(new Date(Date.parse(start) + durationMs)) : undefined;
      out.push({ ...ev, uid: `${ev.uid}:${ds}`, start, end, rrule: undefined });
    }
  }
  return out.sort((a, b) => a.start.localeCompare(b.start));
}

function toLocalIsoNoZone(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
}

export const icsAdapter: Adapter = {
  id: "ics",
  async fetch(ctx) {
    const url = String(ctx.source.config?.ics_url ?? "");
    if (!url) throw new Error("ics: ics_url missing");
    if (url.startsWith("file:")) return await fs.readFile(path.resolve(ctx.repo.root, url.slice(5)), "utf8");
    const res = await ctx.http(url);
    if (!res.ok) throw new Error(`ics: ${res.status}`);
    return await res.text();
  },
  normalize(raw, ctx): NRecord[] {
    const horizon = Number(ctx.source.config?.horizon_days ?? 60);
    const from = localDate();
    const toDate = new Date();
    toDate.setDate(toDate.getDate() + horizon);
    const to = localDate(toDate);
    const src = sourceRef(ctx);
    return expand(parseIcs(String(raw ?? "")), from, to).map((ev) => ({
      id: `${src.id}:ics:${ev.uid}`,
      kind: "event" as const,
      title: ev.summary,
      text: ev.description ?? "",
      date: ev.start.slice(0, 10),
      start: ev.allDay ? undefined : ev.start,
      end: ev.allDay ? undefined : ev.end,
      location: ev.location,
      url: ev.url ?? src.url,
      source: src,
      fetched_at: ctx.fetchedAt,
      tags: ["calendar"],
    }));
  },
};
