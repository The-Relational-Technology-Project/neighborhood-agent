/**
 * The archive miner: a few history notes a month, tied to places the notes already know, from
 * archives whose terms allow it. Two are read: the Internet Archive (items in the public domain by
 * date, or with a license URL) and Wikimedia Commons (every file carries a license). OpenSFHistory
 * is linked, never fetched, as the data repo's archive/README asks. The model picks at most one
 * item per place that is plainly about that place, and drafts a short note with its citation.
 * Notes go to archive/ by PR.
 */
import type { DataRepo, Place } from "../data/types.js";
import { slug } from "../adapters/types.js";
import { parseJson, type Ask } from "./llm.js";

export interface ArchiveItem {
  source: "Internet Archive" | "Wikimedia Commons";
  title: string;
  url: string;
  date?: string;
  license?: string;
  description?: string;
}

const UA = { "user-agent": "neighborhood-agent/0.1 (https://knowy.org; knowy@relationaltechproject.org)" };
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Fetch with one retry on 429, waiting what the server asks (capped). Archives are shared public services; be polite. */
async function polite(url: string, fetchFn: typeof fetch): Promise<Response> {
  let res = await fetchFn(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  if (res.status === 429) {
    const after = Number(res.headers.get("retry-after"));
    await sleep(Number.isFinite(after) && after > 0 ? Math.min(30_000, after * 1000) : 5_000);
    res = await fetchFn(url, { headers: UA, signal: AbortSignal.timeout(20_000) });
  }
  return res;
}

/** Public domain in the US by age, or carrying a license URL. */
export function usable(item: ArchiveItem, year = new Date().getFullYear()): boolean {
  if (item.license) return true;
  const y = item.date ? Number(item.date.slice(0, 4)) : NaN;
  return Number.isFinite(y) && y > 0 && y <= year - 96;
}

export async function searchInternetArchive(query: string, fetchFn: typeof fetch, rows = 8): Promise<ArchiveItem[]> {
  const q = `(${query}) AND "San Francisco" AND mediatype:(image OR texts)`;
  const url = `https://archive.org/advancedsearch.php?q=${encodeURIComponent(q)}&fl[]=identifier&fl[]=title&fl[]=date&fl[]=licenseurl&fl[]=description&rows=${rows}&output=json`;
  const res = await polite(url, fetchFn);
  if (!res.ok) throw new Error(`Internet Archive ${res.status}`);
  const json = (await res.json()) as { response?: { docs?: Array<{ identifier: string; title?: string | string[]; date?: string; licenseurl?: string; description?: string | string[] }> } };
  const one = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);
  return (json.response?.docs ?? []).map((d) => ({ source: "Internet Archive" as const, title: String(one(d.title) ?? d.identifier), url: `https://archive.org/details/${d.identifier}`, date: d.date ? String(d.date).slice(0, 10) : undefined, license: d.licenseurl, description: one(d.description)?.replace(/<[^>]+>/g, "").slice(0, 400) }));
}

export async function searchCommons(query: string, fetchFn: typeof fetch, limit = 8): Promise<ArchiveItem[]> {
  const url = `https://commons.wikimedia.org/w/api.php?action=query&generator=search&gsrsearch=${encodeURIComponent(`${query} "San Francisco"`)}&gsrnamespace=6&gsrlimit=${limit}&prop=imageinfo&iiprop=url|extmetadata&iiextmetadatafilter=LicenseShortName|DateTimeOriginal|ImageDescription&format=json`;
  const res = await polite(url, fetchFn);
  if (!res.ok) throw new Error(`Wikimedia Commons ${res.status}`);
  const json = (await res.json()) as { query?: { pages?: Record<string, { title: string; imageinfo?: Array<{ descriptionurl?: string; extmetadata?: Record<string, { value?: string }> }> }> } };
  return Object.values(json.query?.pages ?? {}).map((p) => {
    const info = p.imageinfo?.[0];
    const meta = info?.extmetadata ?? {};
    const strip = (s?: string) => s?.replace(/<[^>]+>/g, "").replace(/\s+/g, " ").trim();
    return { source: "Wikimedia Commons" as const, title: p.title.replace(/^File:/, "").replace(/\.\w+$/, ""), url: info?.descriptionurl ?? `https://commons.wikimedia.org/wiki/${encodeURIComponent(p.title)}`, date: strip(meta.DateTimeOriginal?.value)?.slice(0, 10), license: strip(meta.LicenseShortName?.value) || "see file page", description: strip(meta.ImageDescription?.value)?.slice(0, 400) };
  });
}

export interface ArchiveNote { file: string; content: string; place: string; item: ArchiveItem }

export interface ArchiveReport {
  places: string[];
  candidates: number;
  notes: ArchiveNote[];
  pr?: string;
  note?: string;
}

/** Which places get a turn this week: a rotating slice, so the whole list is covered over a season. */
export function placesThisWeek(places: Place[], week: number, per = 3): Place[] {
  if (!places.length) return [];
  const start = (week * per) % places.length;
  return Array.from({ length: Math.min(per, places.length) }, (_, i) => places[(start + i) % places.length]);
}

export async function mineArchives(repo: DataRepo, ask: Ask | undefined, opts: { fetchFn?: typeof fetch; week?: number; per?: number; today?: string } = {}): Promise<ArchiveReport> {
  const fetchFn = opts.fetchFn ?? fetch;
  const today = opts.today ?? new Date().toISOString().slice(0, 10);
  const week = opts.week ?? Math.floor(Date.now() / (7 * 86_400_000));
  const places = placesThisWeek(repo.places, week, opts.per ?? 3);
  const report: ArchiveReport = { places: places.map((p) => p.name), candidates: 0, notes: [] };
  if (!places.length) return report;
  if (!ask) { report.note = "no model configured; nothing drafted"; return report; }
  const known = new Set(repo.archive.flatMap((a) => [...a.body.matchAll(/https?:\/\/\S+/g)].map((m) => m[0].replace(/[).,]+$/, ""))));
  for (const place of places) {
    let items: ArchiveItem[] = [];
    const name = place.name.replace(/[^\w\s'-]/g, " ").trim();
    for (const search of [() => searchInternetArchive(`"${name}"`, fetchFn), () => searchCommons(`"${name}"`, fetchFn)]) {
      try { items.push(...(await search())); } catch (err) { report.note = [report.note, (err as Error).message].filter(Boolean).join("; "); }
      if (opts.fetchFn === undefined) await sleep(1_000);
    }
    if (report.note) report.note = [...new Set(report.note.split("; "))].join("; ");
    items = items.filter((i) => usable(i) && !known.has(i.url));
    report.candidates += items.length;
    if (!items.length) continue;
    try {
      const out = await ask(
        `You pick history for a neighborhood's shared notes. Given a place and archive items found by searching its name, choose at most ONE item that is plainly about this place or its block (not just the same city, not a namesake elsewhere) and that tells a neighbor something about its past: an old photograph, a map, a document, an account from before about 1980. A recent snapshot of the building is not history and gets no pick. Be strict: most weeks the right answer is {"pick": null}. Otherwise reply with JSON only: {"pick": <item number>, "title": "<note title, under 8 words>", "note": "<two to four plain sentences: what the item shows, when, and why it matters to the place today. Only facts from the item's own title, date, and description. No speculation.>"}. No other text.`,
        `Place: ${place.name}${place.address ? `, ${place.address}` : ""}${place.what ? `. ${place.what}` : ""}\n\nItems:\n${items.map((it, i) => `${i}. ${it.title} (${it.source}${it.date ? `, ${it.date}` : ""}${it.license ? `, ${it.license}` : ", public domain by date"})\n   ${it.url}\n   ${it.description ?? ""}`).join("\n\n")}`,
        500,
      );
      const parsed = parseJson<{ pick: number | null; title?: string; note?: string }>(out);
      if (!parsed || parsed.pick === null || parsed.pick === undefined || !items[parsed.pick] || !parsed.note) continue;
      const item = items[parsed.pick];
      const title = (parsed.title ?? item.title).slice(0, 80);
      const file = `${today}-${slug(place.name)}-${slug(title)}.md`.replace(/-+/g, "-");
      const content = [
        "---",
        `title: ${JSON.stringify(title)}`,
        `place: ${JSON.stringify(place.name)}`,
        `source: ${JSON.stringify(item.source)}`,
        `url: ${item.url}`,
        item.date ? `date: ${JSON.stringify(item.date)}` : "",
        `license: ${JSON.stringify(item.license ?? "public domain (by date)")}`,
        `added: ${today}`,
        "proposed_by: agent",
        "---",
        "",
        String(parsed.note).trim(),
        "",
        `Source: [${item.title}](${item.url}), ${item.source}${item.date ? `, ${item.date}` : ""}. ${item.license ? `License: ${item.license}.` : "Public domain by date."}`,
        "",
        `More on this block: search [OpenSFHistory](https://opensfhistory.org/) and the [Western Neighborhoods Project](https://www.outsidelands.org/) for "${name}".`,
        "",
      ].filter((l) => l !== null).join("\n").replace(/\n\n\n+/g, "\n\n");
      report.notes.push({ file: `archive/${file}`, content, place: place.name, item });
    } catch (err) { report.note = [report.note, `${place.name}: ${(err as Error).message}`].filter(Boolean).join("; "); }
  }
  return report;
}

export function formatArchiveReport(r: ArchiveReport): string {
  const lines = [`Looked for history on: ${r.places.join("; ") || "(no places listed)"}. ${r.candidates} usable item(s) found.`];
  if (r.notes.length) {
    lines.push("", `${r.notes.length} note(s) drafted${r.pr ? `, in ${r.pr}` : ""}:`);
    for (const n of r.notes) lines.push(`  ${n.place}: ${n.item.title} (${n.item.source}${n.item.date ? `, ${n.item.date}` : ""})  ${n.item.url}`);
  } else lines.push("Nothing worth a note this week.");
  if (r.note) lines.push("", `(${r.note})`);
  return lines.join("\n");
}
