import { describe, expect, it } from "vitest";
import fs from "node:fs/promises";
import { loadRepo } from "../src/data/repo.js";
import { parseFrontmatter, toFrontmatter } from "../src/data/frontmatter.js";
import { FIXTURE, OUTER_SUNSET } from "./helpers.js";

describe("data repo loading", () => {
  it("reads the fixture repo's files into one structure", async () => {
    const repo = await loadRepo(FIXTURE);
    expect(repo.placeMd).toContain("Elsewhere");
    expect(repo.sources.map((s) => s.id)).toEqual(["repo", "town-calendar", "elsewhere-recs", "plover-season"]);
    expect(repo.recs).toHaveLength(1);
    expect(repo.recs[0]).toMatchObject({ file: "recs/neighbors.yml", meta: { title: "Elsewhere Neighbors Recs" } });
    expect(repo.recs[0].recs.map((r) => r.name)).toEqual(["Sam", "River Plumbing Co"]);
    expect(repo.constituents.map((c) => c.slug)).toEqual(["plovers", "river"]);
    expect(repo.constituents.find((c) => c.slug === "plovers")?.advocates[0]).toContain("Bird Club");
    expect(repo.people[0].name).toBe("Pat Example");
    expect(repo.orgs[0].name).toBe("Elsewhere Tool Library");
    expect(repo.places).toHaveLength(2);
    expect(repo.resources[0].answers).toContain("do we have a tool library");
    expect(repo.events[0].data.title).toBe("River Day");
    expect(repo.proposals[0].data.status).toBe("open");
    expect(repo.corrections[0]).toMatchObject({ target: "The Diner", field: "hours", now: "6am to 2pm, closed Mondays" });
    expect(repo.archive.map((a) => a.file)).toEqual(["the-mill.md"]);
    expect(repo.settings.daily_note).toBe("off");
  });

  it("skips templates and READMEs inside folders", async () => {
    const repo = await loadRepo(FIXTURE);
    expect(repo.events.some((e) => e.file.startsWith("_"))).toBe(false);
    expect(repo.archive.some((a) => a.file.toLowerCase() === "readme.md")).toBe(false);
  });

  it("round-trips frontmatter", () => {
    const text = toFrontmatter({ title: "Block party", date: "2026-12-06", start: "14:00" }, "Bring a chair.");
    const back = parseFrontmatter(text);
    expect(back.data).toEqual({ title: "Block party", date: "2026-12-06", start: "14:00" });
    expect(back.body.trim()).toBe("Bring a chair.");
  });

  it("keeps personal contacts out of the real Outer Sunset recs", async () => {
    try { await fs.access(OUTER_SUNSET); } catch { return; }
    const repo = await loadRepo(OUTER_SUNSET);
    const recs = repo.recs.flatMap((f) => f.recs);
    expect(recs.length).toBeGreaterThan(200);
    const phone = /\(?\b\d{3}\)?[\s.-]*\d{3}-\d{4}\b/;
    const email = /[\w.+-]+@[\w-]+(?:\.[\w-]+)+/;
    for (const r of recs) {
      expect(r.what ?? "", `${r.name} has a personal webmail address`).not.toMatch(/@(gmail|yahoo|hotmail|icloud|outlook|aol)\./i);
      // A business-domain email (patricia@defontelaw.com) marks a public business; webmail never does.
      const businessEmail = (r.what ?? "").match(email) && !/@(gmail|yahoo|hotmail|icloud|outlook|aol)\./i.test(r.what ?? "");
      if (!r.links?.length && !businessEmail) {
        expect(r.what ?? "", `${r.name} has no public link but carries a phone`).not.toMatch(phone);
        expect(r.what ?? "", `${r.name} has no public link but carries an email`).not.toMatch(email);
      }
    }
  });

  it("loads the real Outer Sunset repo when present", async () => {
    try { await fs.access(OUTER_SUNSET); } catch { return; }
    const repo = await loadRepo(OUTER_SUNSET);
    expect(repo.sources.length).toBeGreaterThan(10);
    expect(repo.constituents.map((c) => c.slug).sort()).toEqual(["coyotes", "dunes", "ocean", "plovers"]);
    expect(repo.resources.some((r) => r.name === "Community Supplies")).toBe(true);
    const live = repo.sources.filter((s) => s.status === "live" && !s.vital_sign);
    for (const s of live) expect(s.adapter, `${s.id} needs an adapter`).toBeTruthy();
  });
});
