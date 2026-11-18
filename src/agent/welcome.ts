/**
 * The welcome for someone who just moved in: one gathering of what the notes hold for a new
 * neighbor, nearest first when they have said which block. The place writes its own welcome
 * (welcome.md, kept by stewards); this adds the block, what is close by, what is coming up, the
 * groups that are glad to meet new people, and anything matching what the neighbor said they like.
 * It reads only what the other tools read. Nothing about the neighbor is kept.
 */
import type { SearchIndex } from "../data/index.js";
import { localDate } from "../data/index.js";
import type { Block, DataRepo, NRecord } from "../data/types.js";
import { isActiveKnower } from "../adapters/repo.js";
import { aboutBlock, distanceM, formatAbout, howFar, resolveWhere } from "../blocks/geo.js";

export interface WelcomeContext { repo: DataRepo; index: SearchIndex; near?: Block }
export interface WelcomeArgs { where?: string; interests?: string[] }

const DAYS_AHEAD = 14;
const CLOSE_M = 1300;

type Point = { lat: number; lng: number };

function placeOf(repo: DataRepo, text?: string): Point | undefined {
  if (!text) return undefined;
  const r = resolveWhere(repo.blocks, text);
  return r.lat !== undefined && r.lng !== undefined ? { lat: r.lat, lng: r.lng } : undefined;
}

const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9]+/g, " ").trim();

/**
 * Where an event is, from its place in words. A venue the notes already list wins (by its name or
 * its street address); otherwise the streets named, ignoring a neighborhood name that is also a
 * street ("Sunset Rec Center" is not on Sunset Blvd).
 */
function eventPoint(repo: DataRepo, places: Array<{ p: DataRepo["places"][number]; at?: Point }>, location?: string): Point | undefined {
  if (!location) return undefined;
  const loc = norm(location);
  const known = places.find((x) => x.at && ((x.p.name && loc.includes(norm(x.p.name))) || (x.p.address && /^\d/.test(x.p.address) && loc.includes(norm(x.p.address.split(/[,(]/)[0])))));
  if (known) return known.at;
  const settings = repo.settings ?? {};
  const placeWords = [settings.place_label, "sunset", "richmond", "parkside"].filter(Boolean).map((w) => String(w).split(/[ ,]/)[0]);
  let text = location;
  for (const w of placeWords) text = text.replace(new RegExp(`\\b${w}\\b(?!\\s+(blvd|boulevard))`, "gi"), " ");
  const r = resolveWhere(repo.blocks, text);
  return (r.status === "corner" || r.status === "block") && r.lat !== undefined && r.lng !== undefined ? { lat: r.lat, lng: r.lng } : undefined;
}

/** One line per gathering: the same event from two calendars, or a weekly one, shows once, soonest. */
function oncePerTitle(events: NRecord[]): NRecord[] {
  const seen = new Set<string>();
  const kept: NRecord[] = [];
  for (const r of events) {
    const title = norm(r.title);
    const key = norm(r.title.split(/\s[—–-]\s/)[0]);
    const sameHour = kept.some((k) => k.start && k.start === r.start && (norm(k.title).includes(title) || title.includes(norm(k.title))));
    if (seen.has(key) || sameHour) continue;
    seen.add(key);
    kept.push(r);
  }
  return kept;
}

const STOP = new Set(["a", "an", "the", "my", "our", "i", "have", "with", "and", "like", "love", "into"]);

function plusDays(day: string, n: number): string {
  const d = new Date(`${day}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

const when = (r: NRecord) => (r.start ?? r.date ?? "").slice(0, 16).replace("T", " ");
const line = (r: NRecord, far?: string) => `- ${r.title}${when(r) ? `, ${when(r)}` : ""}${r.location ? `, at ${r.location}` : ""}${far ? ` (${far})` : ""}${r.text ? `. ${r.text.replace(/\s+/g, " ").slice(0, 200)}` : ""} [${r.source.name}](${r.url ?? r.source.url})`;

export async function welcomePack(ctx: WelcomeContext, args: WelcomeArgs = {}): Promise<string> {
  const { repo, index } = ctx;
  const out: string[] = [];
  const asked = (args.where ?? "").trim();
  const resolved = asked ? resolveWhere(repo.blocks, asked) : ctx.near ? resolveWhere(repo.blocks, ctx.near.id) : undefined;
  const here: Point | undefined = resolved && resolved.lat !== undefined && resolved.lng !== undefined ? { lat: resolved.lat, lng: resolved.lng } : undefined;

  out.push("# The welcome this place wrote for new neighbors (from the notes; follow it)");
  out.push(repo.welcomeMd.trim() || "This place has not written one yet. Give a warm line, the groups below, and one small way to meet the people on their block.");

  out.push("# Their block");
  if (!repo.blocks.length) out.push("This place keeps no block-by-block notes. Welcome them to the neighborhood as a whole.");
  else if (!resolved) out.push("They have not said which block. Give the neighborhood-wide welcome from what follows, and ask once for their street and its two cross streets (or to share their location) so you can say what is closest. Never ask for a house number.");
  else if (!here) out.push(`Couldn't place "${resolved.label}". ${resolved.hint ?? ""} Ask once for the street and its two cross streets; never a house number. Meanwhile give the neighborhood-wide welcome.`);
  else {
    if (!asked && ctx.near) out.push(`This is the block they shared from their phone (${ctx.near.name}). It is where they are, which may not be where they moved to: say "near ${ctx.near.name}", and let them correct it.`);
    out.push(formatAbout(aboutBlock(repo, asked || ctx.near!.id, { notes: 2, photos: 1 }), { sources: repo.blocksSources }).split("\n\nTrue of every block here:")[0]);
    try {
      const { sweepingForBlocks, formatSweeping } = await import("../blocks/sweeping.js");
      const blocks = resolved.status === "corner" ? resolved.blocks.slice(0, 2) : resolved.blocks.slice(0, 1);
      const sweeps = (await sweepingForBlocks(repo, blocks)).map(formatSweeping);
      if (sweeps.length) out.push("Street cleaning on the block (worth knowing in week one):", ...sweeps);
    } catch { /* the city's schedule is a nice-to-have here */ }
  }

  // Places in the notes, nearest first when we know the block.
  const places = repo.places.map((p) => ({ p, at: placeOf(repo, p.near ?? p.address) }));
  const closePlaces = here
    ? places.filter((x) => x.at).map((x) => ({ ...x, m: distanceM(here, x.at!) })).filter((x) => x.m <= CLOSE_M).sort((a, b) => a.m - b.m).slice(0, 7)
    : [];
  if (closePlaces.length) {
    out.push("# Places in the notes close to their block, nearest first");
    out.push(closePlaces.map((x) => `- ${x.p.name} (${howFar(here!, x.at!)}; ${x.p.address ?? ""}): ${x.p.what ?? ""}${x.p.url ? ` ${x.p.url}` : ""}`).join("\n"));
  }

  // What is coming up in the next two weeks. Events carry a place in words; rank the ones we can place.
  const today = localDate();
  const until = plusDays(today, DAYS_AHEAD);
  const nowLocal = new Intl.DateTimeFormat("sv-SE", { timeZone: process.env.TZ_NAME ?? "America/Los_Angeles", dateStyle: "short", timeStyle: "short" }).format(new Date()).replace(" ", "T");
  const events = oncePerTitle(index.byKind("event", { upcoming: true, limit: 600 }).filter((r) => (r.date ?? r.start) && (r.date ?? r.start!.slice(0, 10)) <= until && (!r.start || r.start.slice(0, 16) >= nowLocal)));
  const placed = events.map((r) => ({ r, at: eventPoint(repo, places, r.location) }));
  const nearEvents = here ? placed.filter((x) => x.at).map((x) => ({ ...x, m: distanceM(here, x.at!) })).filter((x) => x.m <= CLOSE_M).sort((a, b) => (a.r.start ?? a.r.date ?? "").localeCompare(b.r.start ?? b.r.date ?? "")).slice(0, 6) : [];
  if (nearEvents.length) {
    out.push(`# Coming up within a short walk of their block, through ${until}`);
    out.push(nearEvents.map((x) => line(x.r, howFar(here!, x.at!))).join("\n"));
  }
  const shown = new Set(nearEvents.map((x) => x.r.id));
  const rest = events.filter((r) => !shown.has(r.id)).slice(0, nearEvents.length ? 5 : 8);
  if (rest.length) {
    out.push(`# ${nearEvents.length ? "Also coming up" : "Coming up"} around the neighborhood, through ${until} (soonest first)`);
    out.push(rest.map((r) => line(r)).join("\n"));
  }
  if (!events.length) out.push("# Coming up\nNothing is on the calendars for the next two weeks. Point to the events site in the notes instead.");

  const doors = repo.doors.filter((d) => d.moments.includes("new-to-neighborhood"));
  if (doors.length) {
    out.push("# Groups glad to meet someone new (from the notes' doors; point to the group, never a member)");
    out.push(doors.map((d) => `- ${d.group}: ${d.what ?? ""} How to get in: ${d.how_to_join ?? "see the link"} ${d.url ?? ""}`).join("\n"));
  }

  const interests = (args.interests ?? []).map((s) => String(s).trim()).filter(Boolean).slice(0, 4);
  for (const want of interests) {
    const words = want.toLowerCase().split(/\s+/).filter((w) => w && !STOP.has(w)).join(" ");
    const hits = words ? await index.find(words, { kinds: ["group", "resource", "person", "event", "place", "constituent", "archive-note"], upcoming: true, limit: 4 }) : [];
    out.push(`# For what they mentioned: ${want}`);
    out.push(hits.length ? hits.map((r) => line(r)).join("\n") : "Nothing in the notes matches. Say so in a few words and offer to pass the question to the stewards.");
  }

  const knowers = repo.knowers.filter(isActiveKnower).slice(0, 4);
  out.push("# Neighbors who offered to be asked");
  out.push(knowers.length
    ? knowers.map((k) => `- ${String(k.data.described_as ?? "a neighbor")}: ${String(k.data.knows ?? "")}`).join("\n") + "\nOffer to pass a question along (ask_a_neighbor). You never have their names."
    : "None yet. For a person to talk to, use the public points of contact in your instructions.");

  out.push("# How to give it");
  out.push([
    "Write one welcome, warm and plain, for a phone: a first line of welcome, then four or five short bullets, then one question. About 180 words; this is the one answer that may run long.",
    "Order: something true of their block (one or two facts, with the source); the closest places and what each is good for; one to three things coming up soonest and nearest, with day and time; the groups, with the welcome's featured group first; then the one invitation the welcome asks you to make. Leave out anything you have nothing for.",
    "Every fact keeps its source link. Never guess hours. Don't list everything here; pick what is closest and soonest, and what fits what they told you.",
    "End by offering the next small thing the welcome suggests (a note for the neighbors' doors, the block's history, a question passed to a neighbor). One offer, not a menu.",
  ].join("\n"));
  return out.join("\n\n");
}
