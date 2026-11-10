import { slug, sourceRef } from "./types.js";
/** Split a note on its "## " headings. */
export function splitSections(body) {
    const chunks = body.split(/^## +(.+?)\s*$/m);
    const parts = [];
    for (let i = 1; i < chunks.length; i += 2)
        if (chunks[i + 1]?.trim())
            parts.push({ heading: chunks[i].trim(), text: chunks[i + 1].trim() });
    return { intro: chunks[0].trim(), parts };
}
/** A knower can be asked when a steward added them, they have a contact ref, and nobody paused them. */
export function isActiveKnower(k) {
    return Boolean(k.data.ref) && String(k.data.knows ?? "").trim() !== "" && !["paused", "left", "off"].includes(String(k.data.status ?? "active").toLowerCase());
}
export const repoAdapter = {
    id: "repo",
    async fetch() {
        // The repo is already on disk; the loader hands it to normalize via ctx.repo.
        return { loaded: true };
    },
    normalize(_raw, ctx) {
        const { repo } = ctx;
        const src = sourceRef(ctx);
        const base = { source: src, fetched_at: ctx.fetchedAt };
        const out = [];
        // Links neighbors see: the site's own pages when the source URL is the site; GitHub files only
        // when the steward pointed the source at GitHub (forks without a site).
        const onGithub = /github\.com/.test(src.url);
        let origin = src.url;
        try {
            origin = new URL(src.url).origin;
        }
        catch { /* keep as is */ }
        const link = (file, page) => (onGithub ? `${src.url}/blob/main/${file}` : `${origin}${page}`);
        for (const e of repo.events) {
            const d = e.data;
            const date = String(d.date ?? e.file.slice(0, 10));
            const start = d.start ? `${date}T${String(d.start)}` : undefined;
            out.push({
                ...base,
                id: `repo:events:${e.file.replace(/\.md$/, "")}`,
                kind: "event",
                title: String(d.title ?? e.file),
                text: [e.body, d.host ? `Host: ${d.host}` : "", d.contact ? `Contact: ${d.contact}` : ""].filter(Boolean).join("\n"),
                date,
                start,
                end: d.end ? `${date}T${String(d.end)}` : undefined,
                location: d.place ? String(d.place) : undefined,
                url: /^https?:\/\//.test(String(d.contact ?? "")) ? String(d.contact) : onGithub ? `${src.url}/blob/main/events/${e.file}` : undefined,
                verified_at: d.added ? String(d.added) : undefined,
                extra: d,
            });
        }
        for (const p of repo.proposals) {
            const d = p.data;
            out.push({
                ...base,
                id: `repo:proposals:${p.file.replace(/\.md$/, "")}`,
                kind: "proposal",
                title: String(d.title ?? p.file),
                text: `Status: ${String(d.status ?? "open")}. Proposed by ${String(d.proposer ?? "a neighbor")} on ${String(d.opened ?? "")}.\n${p.body}`,
                date: d.opened ? String(d.opened) : undefined,
                url: link(`proposals/${p.file}`, "/proposals"),
                tags: ["proposal", String(d.status ?? "open")],
                extra: d,
            });
        }
        for (const c of repo.corrections) {
            out.push({
                ...base,
                id: `repo:corrections:${c.file.replace(/\.md$/, "")}`,
                kind: "correction",
                title: `Correction: ${c.target} (${c.field})`,
                text: `${c.was ? `Was: ${c.was}. ` : ""}Now: ${c.now}. ${c.how_known ? `How known: ${c.how_known}. ` : ""}By ${c.by ?? "a neighbor"} on ${c.date}.${c.note ? `\n${c.note}` : ""}`,
                date: c.date,
                url: link(`corrections/${c.file}`, "/correct"),
            });
        }
        for (const person of [...repo.people, ...repo.orgs]) {
            out.push({
                ...base,
                id: `repo:people:${slug(person.name)}`,
                kind: "person",
                title: person.name,
                text: [person.org ? `${person.org}.` : "", person.role ?? "", person.reach ? `Reach: ${person.reach}` : "", person.topics?.length ? `Good for: ${person.topics.join(", ")}` : ""].filter(Boolean).join(" "),
                url: person.reach?.startsWith("http") ? person.reach : undefined,
                tags: person.topics ?? [],
                verified_at: person.listed ?? null,
                extra: person,
            });
        }
        for (const place of repo.places) {
            out.push({
                ...base,
                id: `repo:places:${slug(place.name)}`,
                kind: "place",
                title: place.name,
                text: [place.what ?? "", place.address ? `Address: ${place.address}.` : "", place.hours ? `Hours: ${place.hours} (source: ${place.hours_source ?? "unknown"}, verified ${place.last_verified ?? "never"}).` : "Hours: not known."].filter(Boolean).join(" "),
                url: place.url,
                location: place.address,
                tags: place.tags ?? [],
                verified_at: place.last_verified ?? null,
                extra: place,
            });
        }
        for (const r of repo.resources) {
            out.push({
                ...base,
                id: `repo:resources:${slug(r.name)}`,
                kind: "resource",
                title: r.name,
                text: [r.what, r.answers?.length ? `Answers: ${r.answers.join("; ")}.` : "", r.how_to_use ? `How to use: ${r.how_to_use}` : ""].filter(Boolean).join(" "),
                url: r.url,
                tags: r.answers ?? [],
                extra: r,
            });
        }
        for (const c of repo.constituents) {
            out.push({
                ...base,
                id: `repo:constituents:${c.slug}`,
                kind: "constituent",
                title: c.name,
                text: `${c.body}\n\nAdvocates: ${c.advocates.join("; ") || "none listed"}. Feeds: ${c.feeds.join(", ") || "none"}.`,
                url: link(`constituents/${c.slug}.md`, "/about"),
                tags: [c.kind, "constituent", "more-than-human"],
            });
        }
        // A long note is indexed one "## section" at a time, so a search returns the part that answers
        // the question rather than the top of the file. Notes without sections stay one record.
        for (const a of repo.archive) {
            const name = a.file.replace(/\.md$/, "");
            const title = String(a.data.title ?? name);
            const tags = Array.isArray(a.data.topics) ? a.data.topics.map(String) : [];
            const url = onGithub ? `${src.url}/blob/main/archive/${a.file}` : `${origin}/commons/notes/${name}`;
            const { intro, parts } = splitSections(a.body);
            if (!parts.length) {
                out.push({ ...base, id: `repo:archive:${name}`, kind: "archive-note", title, text: a.body, url, tags });
                continue;
            }
            if (intro)
                out.push({ ...base, id: `repo:archive:${name}`, kind: "archive-note", title, text: `${intro}\n\nSections: ${parts.map((p) => p.heading).join("; ")}.`, url, tags });
            const seen = new Set();
            for (const p of parts) {
                let key = slug(p.heading) || "section";
                while (seen.has(key))
                    key += "-2";
                seen.add(key);
                out.push({ ...base, id: `repo:archive:${name}:${key}`, kind: "archive-note", title: `${title}: ${p.heading}`, text: p.text, url, tags });
            }
        }
        for (const k of repo.knowers) {
            if (!isActiveKnower(k))
                continue;
            const d = k.data;
            const as = String(d.described_as ?? "a neighbor");
            out.push({
                ...base,
                id: `repo:knowers:${k.file.replace(/\.md$/, "")}`,
                kind: "knower",
                title: `A neighbor who can be asked: ${as}`,
                text: `Knows about: ${String(d.knows ?? "")}${k.body ? `\n${k.body}` : ""}\nOffered to be asked${d.since ? ` on ${String(d.since)}` : ""}. Describe them only as "${as}". To pass a neighbor's question along, call ask_a_neighbor with this id.`,
                url: `${origin}/commons`,
                tags: [...(Array.isArray(d.topics) ? d.topics.map(String) : []), "ask a neighbor"],
                verified_at: d.since ? String(d.since) : undefined,
            });
        }
        for (const k of repo.knowledge) {
            const d = k.data;
            const name = k.file.replace(/\.md$/, "");
            const day = d.shared ? String(d.shared) : /^\d{4}-\d{2}-\d{2}/.test(name) ? name.slice(0, 10) : undefined;
            out.push({
                ...base,
                id: `repo:knowledge:${name}`,
                kind: "knowledge",
                title: String(d.title ?? name),
                text: [d.question ? `A neighbor asked: ${String(d.question)}` : "", k.body, `Shared by ${String(d.shared_by ?? "a neighbor")}${day ? ` on ${day}` : ""}.${d.how_known ? ` How they know: ${String(d.how_known)}.` : ""} This is a neighbor's own account.`].filter(Boolean).join("\n"),
                url: onGithub ? `${src.url}/blob/main/knowledge/${k.file}` : `${origin}/commons/shared/${name}`,
                tags: Array.isArray(d.topics) ? d.topics.map(String) : [],
                verified_at: day,
            });
        }
        return out;
    },
};
//# sourceMappingURL=repo.js.map