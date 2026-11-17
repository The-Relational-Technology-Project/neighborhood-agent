/**
 * Vital signs for more-than-human neighbors: tide, water, air, the sun, plover season, park alerts,
 * which birds people logged this week, and who's been seen lately. Each reads one public feed, carries its source, and fails soft.
 */
import { localDate } from "../data/index.js";
import { httpFetch } from "../data/loader.js";
const fmtTime = (iso) => {
    const m = iso.match(/(\d{2}):(\d{2})/);
    if (!m)
        return iso;
    const h = Number(m[1]);
    return `${((h + 11) % 12) + 1}:${m[2]}${h < 12 ? "am" : "pm"}`;
};
const noaaTides = async (src) => {
    const station = String(src.config?.station ?? "9414290");
    const url = `https://api.tidesandcurrents.noaa.gov/api/prod/datagetter?date=today&station=${station}&product=predictions&datum=MLLW&interval=hilo&units=english&time_zone=lst_ldt&format=json`;
    const res = await httpFetch(url);
    const body = (await res.json());
    const preds = body.predictions ?? [];
    if (!preds.length)
        throw new Error("no predictions");
    const now = new Date();
    const nowLocal = new Intl.DateTimeFormat("en-CA", { timeZone: "America/Los_Angeles", hourCycle: "h23", hour: "2-digit", minute: "2-digit" }).format(now);
    const next = preds.find((p) => p.t.slice(11) >= nowLocal) ?? preds[preds.length - 1];
    const all = preds.map((p) => `${p.type === "H" ? "high" : "low"} ${fmtTime(p.t)} (${Number(p.v).toFixed(1)} ft)`).join(", ");
    return [{
            id: "tide",
            constituent: "ocean",
            label: "Tide",
            value: `next ${next.type === "H" ? "high" : "low"} ${fmtTime(next.t)}, ${Number(next.v).toFixed(1)} ft`,
            detail: `Today: ${all}. Station ${station}, MLLW.`,
            source: { name: src.name, url: src.url },
            fetched_at: new Date().toISOString(),
        }];
};
const openMeteoMarine = async (src) => {
    const lat = Number(src.config?.latitude ?? 37.753);
    const lon = Number(src.config?.longitude ?? -122.51);
    const url = `https://marine-api.open-meteo.com/v1/marine?latitude=${lat}&longitude=${lon}&current=wave_height,sea_surface_temperature,wave_period&timezone=America%2FLos_Angeles`;
    const res = await httpFetch(url);
    const body = (await res.json());
    const c = body.current;
    if (!c)
        throw new Error("no current block");
    const f = c.sea_surface_temperature != null ? Math.round((c.sea_surface_temperature * 9) / 5 + 32) : undefined;
    const ft = c.wave_height != null ? (c.wave_height * 3.281).toFixed(1) : undefined;
    return [{
            id: "water",
            constituent: "ocean",
            label: "Water",
            value: [f != null ? `${f}°F` : "", ft ? `${ft} ft waves` : "", c.wave_period != null ? `${Math.round(c.wave_period)}s period` : ""].filter(Boolean).join(", "),
            detail: "Model estimate from Open-Meteo, not a buoy.",
            source: { name: src.name, url: src.url },
            fetched_at: new Date().toISOString(),
        }];
};
const openMeteoAir = async (src) => {
    const lat = Number(src.config?.latitude ?? 37.753);
    const lon = Number(src.config?.longitude ?? -122.505);
    const url = `https://air-quality-api.open-meteo.com/v1/air-quality?latitude=${lat}&longitude=${lon}&current=us_aqi,pm2_5&timezone=America%2FLos_Angeles`;
    const res = await httpFetch(url);
    const body = (await res.json());
    const aqi = body.current?.us_aqi;
    if (aqi == null)
        throw new Error("no aqi");
    const band = aqi <= 50 ? "good" : aqi <= 100 ? "moderate" : aqi <= 150 ? "unhealthy for sensitive groups" : aqi <= 200 ? "unhealthy" : "very unhealthy";
    return [{
            id: "air",
            constituent: "air",
            label: "Air",
            value: `AQI ${aqi}, ${band}`,
            detail: body.current?.pm2_5 != null ? `PM2.5 ${body.current.pm2_5} µg/m³. CAMS model via Open-Meteo.` : undefined,
            source: { name: src.name, url: src.url },
            fetched_at: new Date().toISOString(),
        }];
};
export function ploverStatus(today, start = "07-01", end = "05-15") {
    const md = today.slice(5);
    const wraps = start > end;
    const inSeason = wraps ? md >= start || md <= end : md >= start && md <= end;
    const yr = Number(today.slice(0, 4));
    const endYear = wraps && md >= start ? yr + 1 : yr;
    const startYear = wraps && md <= end ? yr - 1 : yr;
    return {
        inSeason,
        text: inSeason
            ? `protection season through ${monthDay(end)} ${endYear}: dogs on a six-foot leash in the protection area`
            : `off season until ${monthDay(start)} ${md > end ? yr : startYear + 1}`,
    };
}
function monthDay(md) {
    const [m, d] = md.split("-").map(Number);
    return `${["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"][m - 1]} ${d}`;
}
const ploverSeason = async (src, repo) => {
    const plovers = repo.constituents.find((c) => c.slug === "plovers");
    const season = (plovers?.frontmatter.season ?? {});
    const st = ploverStatus(localDate(), season.protection_start ?? "07-01", season.protection_end ?? "05-15");
    return [{
            id: "plovers",
            constituent: "plovers",
            label: "Plovers",
            value: st.text,
            detail: season.note,
            source: { name: src.name, url: src.url },
            fetched_at: new Date().toISOString(),
        }];
};
const npsAlerts = async (src) => {
    const park = String(src.config?.park_code ?? "goga");
    const keyEnv = String(src.config?.key_env ?? "NPS_API_KEY");
    const key = process.env[keyEnv] ?? "DEMO_KEY";
    const res = await httpFetch(`https://developer.nps.gov/api/v1/alerts?parkCode=${park}&api_key=${encodeURIComponent(key)}`);
    const body = (await res.json());
    const alerts = body.data ?? [];
    const beach = alerts.filter((a) => /ocean beach|fort funston|great highway|sloat|plover|sunset/i.test(`${a.title} ${a.description}`));
    const list = beach.length ? beach : alerts.slice(0, 3);
    return [{
            id: "park",
            constituent: "dunes",
            label: "Park alerts",
            value: beach.length ? `${beach.length} for the beach side` : alerts.length ? `${alerts.length} park-wide, none for the beach` : "none",
            detail: list.map((a) => `${a.title}${a.url ? ` (${a.url})` : ""}: ${a.description.slice(0, 220)}`).join("\n"),
            source: { name: src.name, url: src.url },
            fetched_at: new Date().toISOString(),
        }];
};
const inaturalist = async (src) => {
    const c = src.config ?? {};
    const q = new URLSearchParams({ nelat: String(c.nelat ?? 37.78), nelng: String(c.nelng ?? -122.47), swlat: String(c.swlat ?? 37.72), swlng: String(c.swlng ?? -122.52), per_page: String(c.per_page ?? 30), order: "desc", order_by: "observed_on", verifiable: "true" });
    const res = await httpFetch(`https://api.inaturalist.org/v1/observations?${q}`);
    const body = (await res.json());
    const obs = (body.results ?? []).filter((o) => o.taxon);
    const seen = new Map();
    for (const o of obs) {
        const name = o.taxon?.preferred_common_name ?? o.taxon?.name ?? "something";
        if (!seen.has(name))
            seen.set(name, { when: o.observed_on ?? "", where: o.place_guess ?? "", uri: o.uri });
    }
    const top = [...seen.entries()].slice(0, 6);
    const coyote = obs.find((o) => /coyote/i.test(o.taxon?.preferred_common_name ?? ""));
    const plover = obs.find((o) => /plover/i.test(o.taxon?.preferred_common_name ?? ""));
    const out = [{
            id: "seen",
            constituent: "dunes",
            label: "Seen lately",
            value: top.map(([n]) => n.toLowerCase()).join(", ") || "nothing reported",
            detail: top.map(([n, v]) => `${n}: ${v.when}${v.where ? ` at ${v.where}` : ""} ${v.uri}`).join("\n"),
            source: { name: src.name, url: src.url },
            fetched_at: new Date().toISOString(),
        }];
    if (coyote)
        out.push({ id: "coyote", constituent: "coyotes", label: "Coyote", value: `last reported ${coyote.observed_on ?? "recently"}${coyote.place_guess ? ` near ${coyote.place_guess}` : ""}`, detail: coyote.uri, source: { name: src.name, url: coyote.uri }, fetched_at: new Date().toISOString() });
    if (plover)
        out.push({ id: "plover-seen", constituent: "plovers", label: "Plover sighting", value: `${plover.taxon?.preferred_common_name} reported ${plover.observed_on ?? "recently"}`, detail: plover.uri, source: { name: src.name, url: plover.uri }, fetched_at: new Date().toISOString() });
    return out;
};
/** Drop a leading house number from a place name, so a sighting is never pinned to a home. */
const blockLevel = (place) => place.replace(/^\s*\d+[A-Za-z]?\s+(?=\S)/, "").trim();
const tzName = () => process.env.TZ_NAME ?? "America/Los_Angeles";
function clock(d) {
    const parts = new Intl.DateTimeFormat("en-US", { timeZone: tzName(), hour: "numeric", minute: "2-digit", hour12: true }).format(d);
    return parts.replace(/\s?([AP])M$/i, (_m, a) => `${a.toLowerCase()}m`);
}
/**
 * Birds people logged nearby in the last few days: every species with how many times it was logged,
 * and the latest sightings with their time and place. A record of what people uploaded, not a count
 * of what is here.
 */
const inaturalistBirds = async (src) => {
    const c = src.config ?? {};
    const days = Math.min(30, Math.max(1, Number(c.days ?? 7)));
    const today = localDate();
    const from = new Date(`${today}T12:00:00Z`);
    from.setUTCDate(from.getUTCDate() - (days - 1));
    const d1 = from.toISOString().slice(0, 10);
    const box = { nelat: String(c.nelat ?? 37.78), nelng: String(c.nelng ?? -122.47), swlat: String(c.swlat ?? 37.72), swlng: String(c.swlng ?? -122.52) };
    const common = { ...box, iconic_taxa: String(c.iconic_taxa ?? "Aves"), d1, d2: today, verifiable: "true" };
    const [countsRes, latestRes] = await Promise.all([
        httpFetch(`https://api.inaturalist.org/v1/observations/species_counts?${new URLSearchParams({ ...common, per_page: "100" })}`),
        httpFetch(`https://api.inaturalist.org/v1/observations?${new URLSearchParams({ ...common, per_page: "30", order: "desc", order_by: "observed_on" })}`),
    ]);
    const counts = (await countsRes.json()).results ?? [];
    const latest = (await latestRes.json()).results ?? [];
    const name = (t) => t?.preferred_common_name ?? t?.name ?? "";
    const species = counts.map((r) => ({ name: name(r.taxon), n: r.count })).filter((r) => r.name);
    const seenToday = new Set(latest.filter((o) => o.observed_on === today).map((o) => name(o.taxon)).filter(Boolean));
    const recent = [];
    const had = new Set();
    for (const o of latest) {
        const n = name(o.taxon);
        if (!n || had.has(n) || o.taxon?.rank !== "species")
            continue;
        had.add(n);
        const at = o.time_observed_at ? `, ${clock(new Date(o.time_observed_at))}` : "";
        const where = o.place_guess ? ` at ${blockLevel(o.place_guess)}` : "";
        recent.push(`${n}: ${o.observed_on ?? ""}${at}${where} ${o.uri}`);
        if (recent.length >= 12)
            break;
    }
    const top = species.slice(0, 8).map((r) => r.name.toLowerCase());
    const more = species.length - top.length;
    const window = days === 1 ? "today" : `the last ${days} days`;
    const view = `https://www.inaturalist.org/observations?${new URLSearchParams({ ...box, iconic_taxa: common.iconic_taxa, d1, subview: "table" })}`;
    return [{
            id: "birds",
            constituent: "birds",
            label: days === 1 ? "Birds today" : "Birds this week",
            value: species.length ? `${top.join(", ")}${more > 0 ? `, and ${more} more` : ""}` : `none logged in ${window}`,
            detail: species.length
                ? [
                    `${species.length} species logged in ${window} (${d1} to ${today}), most logged first: ${species.map((r) => `${r.name} (${r.n})`).join(", ")}.`,
                    seenToday.size ? `Logged today, ${today}: ${[...seenToday].join(", ")}.` : `Nothing logged yet today, ${today}; people often upload in the evening.`,
                    `Latest sightings:\n${recent.join("\n")}`,
                    "This is what people photographed or recorded and uploaded, so common birds are undercounted and it is not a census.",
                ].join("\n")
                : undefined,
            source: { name: src.name, url: view },
            fetched_at: new Date().toISOString(),
        }];
};
/** Sunrise and sunset for a day at a point, by NOAA's solar position equations. Good to about a minute at these latitudes. */
export function sunTimes(day, lat, lon) {
    const rad = Math.PI / 180;
    const jd = Date.parse(`${day}T12:00:00Z`) / 86_400_000 + 2440587.5;
    const t = (jd - 2451545) / 36525;
    const L0 = (280.46646 + t * (36000.76983 + t * 0.0003032)) % 360;
    const M = 357.52911 + t * (35999.05029 - 0.0001537 * t);
    const e = 0.016708634 - t * (0.000042037 + 0.0000001267 * t);
    const C = Math.sin(M * rad) * (1.914602 - t * (0.004817 + 0.000014 * t)) + Math.sin(2 * M * rad) * (0.019993 - 0.000101 * t) + Math.sin(3 * M * rad) * 0.000289;
    const omega = 125.04 - 1934.136 * t;
    const lambda = L0 + C - 0.00569 - 0.00478 * Math.sin(omega * rad);
    const eps0 = 23 + (26 + (21.448 - t * (46.815 + t * (0.00059 - t * 0.001813))) / 60) / 60;
    const eps = eps0 + 0.00256 * Math.cos(omega * rad);
    const decl = Math.asin(Math.sin(eps * rad) * Math.sin(lambda * rad));
    const y = Math.tan((eps / 2) * rad) ** 2;
    const eqTime = 4 * (y * Math.sin(2 * L0 * rad) - 2 * e * Math.sin(M * rad) + 4 * e * y * Math.sin(M * rad) * Math.cos(2 * L0 * rad) - 0.5 * y * y * Math.sin(4 * L0 * rad) - 1.25 * e * e * Math.sin(2 * M * rad)) / rad;
    const noonMin = 720 - 4 * lon - eqTime; // minutes after 00:00 UTC
    const hourAngle = (zenith) => {
        const cosH = Math.cos(zenith * rad) / (Math.cos(lat * rad) * Math.cos(decl)) - Math.tan(lat * rad) * Math.tan(decl);
        return cosH < -1 || cosH > 1 ? null : Math.acos(cosH) / rad;
    };
    const ha = hourAngle(90.833);
    const haCivil = hourAngle(96);
    if (ha == null || haCivil == null)
        return null;
    const base = Date.parse(`${day}T00:00:00Z`);
    const at = (min) => new Date(base + min * 60_000);
    return { rise: at(noonMin - 4 * ha), set: at(noonMin + 4 * ha), dawn: at(noonMin - 4 * haCivil), dusk: at(noonMin + 4 * haCivil) };
}
const sun = async (src) => {
    const lat = Number(src.config?.latitude ?? 37.753);
    const lon = Number(src.config?.longitude ?? -122.505);
    const today = localDate();
    const next = new Date(`${today}T12:00:00Z`);
    next.setUTCDate(next.getUTCDate() + 1);
    const tomorrow = next.toISOString().slice(0, 10);
    const a = sunTimes(today, lat, lon);
    const b = sunTimes(tomorrow, lat, lon);
    if (!a || !b)
        throw new Error("no sunrise or sunset at this latitude today");
    const len = (x) => { const m = Math.round((x.set.getTime() - x.rise.getTime()) / 60_000); return `${Math.floor(m / 60)}h ${m % 60}m`; };
    const now = Date.now();
    const value = now < a.rise.getTime() ? `rises ${clock(a.rise)}, sets ${clock(a.set)}` : now < a.set.getTime() ? `sets ${clock(a.set)} today` : `set ${clock(a.set)}; rises ${clock(b.rise)} tomorrow`;
    const line = (label, day, x) => `${label} (${day}): first light ${clock(x.dawn)}, sunrise ${clock(x.rise)}, sunset ${clock(x.set)}, last light ${clock(x.dusk)}, ${len(x)} of daylight.`;
    return [{
            id: "sun",
            constituent: "sky",
            label: "Sun",
            value,
            detail: `${line("Today", today, a)} ${line("Tomorrow", tomorrow, b)} Computed for the horizon at sea level, within about a minute; fog and the hills decide what you actually see. First and last light are civil twilight.`,
            source: { name: src.name, url: src.url },
            fetched_at: new Date().toISOString(),
        }];
};
export const vitalReaders = {
    "noaa-tides": noaaTides,
    "open-meteo-marine": openMeteoMarine,
    "open-meteo-air": openMeteoAir,
    "plover-season": ploverSeason,
    "nps-alerts": npsAlerts,
    inaturalist,
    "inaturalist-birds": inaturalistBirds,
    sun,
};
//# sourceMappingURL=feeds.js.map