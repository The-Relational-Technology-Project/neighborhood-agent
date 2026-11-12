const R = 6_371_000;
const rad = (d) => (d * Math.PI) / 180;
export function distanceM(a, b) {
    const dLat = rad(b.lat - a.lat);
    const dLng = rad(b.lng - a.lng);
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
    return 2 * R * Math.asin(Math.sqrt(h));
}
const COMPASS = ["north", "northeast", "east", "southeast", "south", "southwest", "west", "northwest"];
function bearing(from, to) {
    const y = Math.sin(rad(to.lng - from.lng)) * Math.cos(rad(to.lat));
    const x = Math.cos(rad(from.lat)) * Math.sin(rad(to.lat)) - Math.sin(rad(from.lat)) * Math.cos(rad(to.lat)) * Math.cos(rad(to.lng - from.lng));
    const deg = ((Math.atan2(y, x) * 180) / Math.PI + 360) % 360;
    return COMPASS[Math.round(deg / 45) % 8];
}
/** "about 300 ft west", "right here". */
export function howFar(from, to) {
    const m = distanceM(from, to);
    if (m < 60)
        return "right here";
    const ft = m * 3.28084;
    const dist = ft < 1000 ? `about ${Math.round(ft / 50) * 50} ft` : `about ${(ft / 5280).toFixed(1)} mi`;
    return `${dist} ${bearing(from, to)}`;
}
/** Street words compared loosely: "46th Avenue", "46th Ave" and "46" are the same street. */
export function streetKey(s) {
    return s
        .normalize("NFKC")
        .toLowerCase()
        .replace(/\(.*?\)/g, " ")
        .replace(/(\d+)\s*(st|nd|rd|th)\b/g, "$1")
        .replace(/&|\+|@|\//g, " ")
        .replace(/[^a-z0-9]+/g, " ")
        .replace(/\b(avenue|ave|av|street|st|boulevard|blvd|drive|dr|highway|hwy|way|place|pl|road|rd|lane|ln|court|ct)\b/g, " ")
        .replace(/\s+/g, " ")
        .trim();
}
const has = (q, key) => key !== "" && ` ${q} `.includes(` ${key} `);
/**
 * Find the block or corner someone means. Accepts a block id, "lat,lng", a block
 * ("46th between Moraga and Noriega", "Judah from 45th to 46th") or a corner ("46th and Judah").
 * A house number is never needed and is ignored.
 */
export function resolveWhere(blocks, where) {
    const raw = where.trim();
    if (!raw || !blocks.length)
        return { status: "none", label: raw, blocks: [] };
    const byId = blocks.find((b) => b.id === raw);
    if (byId)
        return { status: "block", label: byId.name, lat: byId.lat, lng: byId.lng, blocks: [byId] };
    const ll = raw.match(/^\s*(-?\d{1,3}\.\d+)\s*,\s*(-?\d{1,3}\.\d+)\s*$/);
    if (ll) {
        const p = { lat: Number(ll[1]), lng: Number(ll[2]) };
        const near = blocks.map((b) => ({ b, d: distanceM(p, b) })).sort((a, b) => a.d - b.d)[0];
        if (!near || near.d > 400)
            return { status: "none", label: raw, blocks: [], hint: "That spot is outside the blocks in the notes." };
        return { status: "point", label: `near ${near.b.name}`, ...p, blocks: [near.b] };
    }
    // A leading house number ("1535 46th Ave") says where a person lives. Drop it; the block is enough.
    const q = streetKey(raw.replace(/^\s*\d{3,5}\s+(?=\d)/, ""));
    const scored = blocks.map((b) => {
        const keys = [...new Set(b.streets.map(streetKey).filter(Boolean))];
        return { b, n: keys.filter((k) => has(q, k)).length, of: keys.length, keys };
    });
    const best = Math.max(0, ...scored.map((s) => s.n));
    if (best === 0)
        return { status: "none", label: raw, blocks: [], hint: "No street in the notes matches. Ask for the street and its two cross streets." };
    const top = scored.filter((s) => s.n === best);
    const whole = top.filter((s) => s.n === s.of);
    if (whole.length === 1 || (best >= 3 && whole.length)) {
        const b = whole[0].b;
        return { status: "block", label: b.name, lat: b.lat, lng: b.lng, blocks: [b] };
    }
    if (best >= 2 && top.length <= 6) {
        // Two streets named: the corner where they meet, taken as the middle of the blocks that touch it.
        const named = [...new Set(top.flatMap((s) => s.b.streets.filter((st) => has(q, streetKey(st)))))];
        const lat = top.reduce((a, s) => a + s.b.lat, 0) / top.length;
        const lng = top.reduce((a, s) => a + s.b.lng, 0) / top.length;
        return { status: "corner", label: named.slice(0, 2).join(" & "), lat, lng, blocks: top.map((s) => s.b) };
    }
    return { status: "vague", label: raw, blocks: [], hint: "That names a whole street. Ask which cross streets: a block (46th between Moraga and Noriega) or a corner (46th and Judah)." };
}
const isPhoto = (n) => n.kind === "photo";
const reachOf = (n) => (n.reach === "area" || n.reach === "everywhere" ? n.reach : "spot");
function hash(s) {
    let h = 2166136261;
    for (let i = 0; i < s.length; i++)
        h = Math.imul(h ^ s.charCodeAt(i), 16777619);
    return h >>> 0;
}
/** Everything the notes hold about one block or corner. */
export function aboutBlock(repo, where, opts = {}) {
    const resolved = resolveWhere(repo.blocks, where);
    const empty = { resolved, near: [], photos: [], area: [], everywhere: [], widened: false };
    if (resolved.lat === undefined || resolved.lng === undefined)
        return empty;
    const p = { lat: resolved.lat, lng: resolved.lng };
    const all = repo.blockNotes.map((note) => ({ note, meters: distanceM(p, note), far: howFar(p, note) })).sort((a, b) => a.meters - b.meters);
    const spots = all.filter((x) => reachOf(x.note) === "spot" && !isPhoto(x.note));
    let near = spots.filter((x) => x.meters <= (x.note.radius_m ?? 260));
    let widened = false;
    if (near.length < 2) {
        near = spots.filter((x) => x.meters <= 560);
        widened = near.length > 0;
    }
    const photoHits = all.filter((x) => isPhoto(x.note));
    let photos = photoHits.filter((x) => x.meters <= 220);
    if (!photos.length)
        photos = photoHits.filter((x) => x.meters <= 450);
    const area = all.filter((x) => reachOf(x.note) === "area" && x.meters <= (x.note.radius_m ?? 800));
    const every = repo.blockNotes.filter((n) => reachOf(n) === "everywhere");
    const seed = hash(resolved.blocks[0]?.id ?? resolved.label);
    const everywhere = every.length <= 2 ? every : [every[seed % every.length], every[(seed + 1 + (seed >>> 8) % (every.length - 1)) % every.length]];
    return { resolved, near: near.slice(0, opts.notes ?? 6), photos: photos.slice(0, opts.photos ?? 5), area: area.slice(0, 4), everywhere, widened };
}
const srcLine = (n) => (n.sources?.length ? ` Sources: ${n.sources.map((s) => `[${s.name}](${s.url})`).join(", ")}.` : "");
/** One note as the model and other tools read it. */
export function formatBlockNote(n, far) {
    if (isPhoto(n)) {
        // A pin in an archive: we hold the link and the credit, not the picture or its caption.
        const links = (n.sources?.length ? n.sources : n.photo ? [{ name: n.photo.credit ?? "the photograph", url: n.photo.page }] : []).map((s) => `[${s.name}](${s.url})`).join(", ");
        return `[photo] ${n.title}${n.years ? `, ${n.years}` : ""}${far ? ` (${far})` : ""}\n${n.text}\nLinks, each credited by its name: ${links}`;
    }
    return `[${n.kind ?? "note"}] ${n.title}${n.years ? ` (${n.years})` : ""}${far ? ` (${far}${n.at ? `, at ${n.at}` : ""})` : n.at ? ` (at ${n.at})` : ""}\n${n.text}${n.extent ? ` Covers: ${n.extent}.` : ""}${srcLine(n)}`;
}
export function formatAbout(a, meta) {
    const r = a.resolved;
    if (r.status === "none" || r.status === "vague")
        return `Couldn't place "${r.label}". ${r.hint ?? ""} Never ask for a house number; the block or the corner is enough.`;
    const out = [];
    const blocks = r.status === "corner" ? r.blocks.slice(0, 4) : r.blocks.slice(0, 1);
    out.push(r.status === "corner" ? `The corner of ${r.label}. The blocks that meet here:` : `The block: ${r.label}.`);
    for (const b of blocks)
        out.push(`- ${b.name}${b.about ? `: ${b.about}` : ""}`);
    if (meta?.sources && blocks.some((b) => b.about))
        out.push(`(Block figures: ${meta.sources})`);
    if (a.near.length)
        out.push("", a.widened ? "Nothing is pinned on this block itself. The closest, a few blocks off:" : "Pinned on or near this block:", ...a.near.map((x) => formatBlockNote(x.note, x.far)));
    if (a.photos.length)
        out.push("", "Old photographs taken near here:", ...a.photos.map((x) => formatBlockNote(x.note, x.far)));
    if (a.area.length)
        out.push("", "About the wider stretch this block sits in:", ...a.area.map((x) => formatBlockNote(x.note)));
    if (a.everywhere.length)
        out.push("", "True of every block here:", ...a.everywhere.map((n) => formatBlockNote(n)));
    if (!a.near.length && !a.photos.length && !a.area.length)
        out.push("", "Nothing is pinned near this block yet. Say so in a line, and invite the neighbor to share what they know about it.");
    return out.join("\n\n").replace(/\n{3,}/g, "\n\n");
}
//# sourceMappingURL=geo.js.map