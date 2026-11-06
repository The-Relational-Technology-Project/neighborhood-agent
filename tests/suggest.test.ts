import { describe, expect, it } from "vitest";
import { classifySuggestion } from "../src/agent/suggest.js";
import { makeDraft, signDraft, verifyDraft } from "../src/agent/drafts.js";
import { parseCsv, csvAdapter } from "../src/adapters/csv.js";
import { parseFeed } from "../src/adapters/rss.js";
import type { AdapterContext } from "../src/adapters/types.js";
import type { DataRepo, SourceDef } from "../src/data/types.js";

describe("classifying a suggested source", () => {
  it("sorts links and files into kinds with a steward hint", () => {
    expect(classifySuggestion("https://docs.google.com/spreadsheets/d/abc/edit").type).toBe("spreadsheet");
    expect(classifySuggestion("https://docs.google.com/document/d/abc/edit").type).toBe("doc");
    expect(classifySuggestion("https://calendar.google.com/calendar/ical/x/public/basic.ics").type).toBe("calendar");
    expect(classifySuggestion("https://example.org/feed").type).toBe("feed");
    expect(classifySuggestion("https://sunsetboard.org").type).toBe("site");
    expect(classifySuggestion(undefined, "Recs.pdf").type).toBe("doc");
    expect(classifySuggestion(undefined, "list.xlsx").type).toBe("spreadsheet");
    expect(classifySuggestion("https://docs.google.com/spreadsheets/d/abc").hint).toMatch(/csv source/);
    expect(classifySuggestion(undefined, "Recs.pdf").hint).toMatch(/OK with it being public/);
  });
});

describe("source drafts", () => {
  it("files a suggestion with a plain summary and a hint only stewards see", () => {
    const d = makeDraft({ kind: "source", ask: "our daycare list", fields: { url: "https://docs.google.com/spreadsheets/d/abc", what: "Daycares parents liked", kept_by: "a parents' group", ok_to_share: "Not sure, please check" } }, "2026-11-06");
    expect(d.path).toBe("suggestions/2026-11-06-docsgooglecom.md");
    expect(d.labels).toEqual(["source"]);
    expect(d.content).toContain("type: spreadsheet");
    expect(d.content).toContain("status: new");
    expect(d.summary).toContainEqual(["OK to be public?", "Not sure, please check"]);
    expect(d.summary.map(([, v]) => v).join(" ")).not.toMatch(/csv source|recs\//);
    expect(d.hint).toMatch(/csv source/);
    expect(verifyDraft(signDraft(d))?.kind).toBe("source");
  });
  it("names an uploaded file without storing it", () => {
    const d = makeDraft({ kind: "source", ask: "x", fields: { file: "Recs.pdf", what: "Group recs" } }, "2026-11-06");
    expect(d.content).toContain("file: Recs.pdf (sent to the stewards by email, not stored here)");
    expect(d.summary).toContainEqual(["File", "Recs.pdf"]);
  });
});

describe("csv and rss adapters", () => {
  it("parses quoted CSV and templates rows", () => {
    const rows = parseCsv('Name,"Where, exactly",Notes\nWinnie\'s,"38th & Judah","Takes ""very"" young infants"\n');
    expect(rows).toEqual([{ name: "Winnie's", where_exactly: "38th & Judah", notes: 'Takes "very" young infants' }]);
    const ctx = { repo: {} as DataRepo, source: { id: "sheet", name: "Daycare sheet", url: "https://x", type: "api", status: "live", config: { title: "{name}", text: "{notes}[ Where: {where_exactly}.]", kind: "recommendation", id: "name" } } as SourceDef, fetchedAt: "t", secret: () => undefined, http: async () => { throw new Error("offline"); } } as AdapterContext;
    const [r] = csvAdapter.normalize('Name,"Where, exactly",Notes\nWinnie\'s,"38th & Judah","Takes very young infants"\n', ctx);
    expect(r).toMatchObject({ kind: "recommendation", title: "Winnie's", text: "Takes very young infants Where: 38th & Judah." });
  });
  it("reads RSS and Atom", () => {
    const items = parseFeed(`<rss><channel><item><title><![CDATA[Fog & tea]]></title><link>https://x/1</link><pubDate>Thu, 05 Nov 2026 10:00:00 GMT</pubDate><description>&lt;p&gt;Hi&lt;/p&gt;</description></item></channel></rss><feed><entry><title>Atom one</title><link href="https://x/2"/><updated>2026-11-04T00:00:00Z</updated><summary>S</summary></entry></feed>`);
    expect(items).toEqual([{ title: "Fog & tea", link: "https://x/1", date: "Thu, 05 Nov 2026 10:00:00 GMT", summary: "Hi" }, { title: "Atom one", link: "https://x/2", date: "2026-11-04T00:00:00Z", summary: "S" }]);
  });
});

describe("the suggest form", () => {
  it("asks for a link or a file, and won't take files without email", async () => {
    const { AppState } = await import("../src/state.js");
    const { createApp } = await import("../src/app.js");
    const { FIXTURE, tmpCache } = await import("./helpers.js");
    const cfg = { ...(await import("../src/config.js")).loadConfig(), dataRepo: FIXTURE, cacheDir: await tmpCache(), github: {}, email: { from: "x", to: [] } };
    const state = new AppState(cfg as never);
    const app = createApp(state);
    const empty = new FormData(); empty.set("what", "something");
    expect(await (await app.request("/suggest", { method: "POST", body: empty })).text()).toContain("Add a link or a file.");
    const withFile = new FormData(); withFile.set("what", "recs"); withFile.set("file", new File(["hello"], "recs.pdf"));
    expect(await (await app.request("/suggest", { method: "POST", body: withFile })).text()).toContain("Share a link instead");
    const page = await (await app.request("/sources")).text();
    expect(page).toContain("Suggest something Knowy should read");
  });
});
