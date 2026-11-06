/**
 * Vital signs for more-than-human neighbors: tide, water, air, plover season, park alerts, and
 * who's been seen lately. Each reads one public feed, carries its source, and fails soft.
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
export const vitalReaders = {
    "noaa-tides": noaaTides,
    "open-meteo-marine": openMeteoMarine,
    "open-meteo-air": openMeteoAir,
    "plover-season": ploverSeason,
    "nps-alerts": npsAlerts,
    inaturalist,
};
//# sourceMappingURL=feeds.js.map