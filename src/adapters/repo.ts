/** The neighborhood repo itself: events, proposals, corrections, people, places, resources, constituents, archive. */
import type { NRecord } from "../data/types.js";
import { slug, sourceRef, type Adapter, type AdapterContext } from "./types.js";

export const repoAdapter: Adapter = {
  id: "repo",
  async fetch() {
    // The repo is already on disk; the loader hands it to normalize via ctx.repo.
    return { loaded: true };
  },
  normalize(_raw, ctx): NRecord[] {
    const { repo } = ctx;
    const src = sourceRef(ctx);
    const base = { source: src, fetched_at: ctx.fetchedAt };
    const out: NRecord[] = [];

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
        url: `${src.url}/blob/main/events/${e.file}`,
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
        url: `${src.url}/blob/main/proposals/${p.file}`,
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
        url: `${src.url}/blob/main/corrections/${c.file}`,
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
        extra: person as unknown as Record<string, unknown>,
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
        extra: place as unknown as Record<string, unknown>,
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
        extra: r as unknown as Record<string, unknown>,
      });
    }

    for (const c of repo.constituents) {
      out.push({
        ...base,
        id: `repo:constituents:${c.slug}`,
        kind: "constituent",
        title: c.name,
        text: `${c.body}\n\nAdvocates: ${c.advocates.join("; ") || "none listed"}. Feeds: ${c.feeds.join(", ") || "none"}.`,
        url: `${src.url}/blob/main/constituents/${c.slug}.md`,
        tags: [c.kind, "constituent", "more-than-human"],
      });
    }

    for (const a of repo.archive) {
      out.push({
        ...base,
        id: `repo:archive:${a.file.replace(/\.md$/, "")}`,
        kind: "archive-note",
        title: String(a.data.title ?? a.file.replace(/\.md$/, "")),
        text: a.body,
        url: `${src.url}/blob/main/archive/${a.file}`,
      });
    }

    return out;
  },
};
