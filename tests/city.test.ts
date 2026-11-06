import { describe, expect, it } from "vitest";
import { fillSoqlDates, renderTemplate, socrataAdapter, sodaUrl } from "../src/adapters/socrata.js";
import { build311Where, toBlock } from "../src/agent/city311.js";
import type { AdapterContext } from "../src/adapters/types.js";
import type { DataRepo, SourceDef } from "../src/data/types.js";

const labels = { current_status: { "PL Filed": "planning application filed, under review" } };

describe("socrata templates", () => {
  const row = { nameaddr: "1234 GREAT HIGHWAY", current_status: "PL Filed", current_status_date: "2025-03-18T00:00:00.000", net_pipeline_units: "199.0", pipeline_affordable_units: "197", planner: "", case_no: "2025-001728PRJ" };
  it("fills fields, filters, labels, and drops optional groups with empty values", () => {
    const t = renderTemplate("Proposed.[ Status: {current_status|label}, as of {current_status_date|date}.][ Net new homes: {net_pipeline_units|num}.][ Planner: {planner}.][ Case {case_no}.]", row, labels);
    expect(t).toBe("Proposed. Status: planning application filed, under review, as of 2025-03-18. Net new homes: 199. Case 2025-001728PRJ.");
  });
  it("treats zero as empty inside optional groups", () => {
    expect(renderTemplate("A.[ Affordable: {x|num}.]", { x: "0" })).toBe("A.");
  });
  it("fills {today-N} in SoQL and builds the URL", () => {
    expect(fillSoqlDates("close_date > '{today-365}'", new Date("2026-11-06T20:00:00Z"))).toBe("close_date > '2025-11-06'");
    const u = sodaUrl({ domain: "data.sf.gov", dataset: "6jgi-cpb4", select: "a,b", where: "nhood41 = 'Sunset/Parkside'", limit: 5 });
    expect(u.startsWith("https://data.sf.gov/resource/6jgi-cpb4.json?")).toBe(true);
    expect(decodeURIComponent(u)).toContain("$where=nhood41+=+'Sunset/Parkside'".replace(/\+/g, " ").replace(/ /g, "+"));
  });
  it("normalizes rows into development records with links", () => {
    const ctx = { repo: {} as DataRepo, source: { id: "pipe", name: "SF Development Pipeline", url: "https://data.sf.gov/d/6jgi-cpb4", type: "api", status: "live", config: { domain: "data.sf.gov", dataset: "6jgi-cpb4", kind: "development", id: "{case_no}-{blklot}", title: "{nameaddr}", text: "[Status: {current_status|label}.]", date: "current_status_date", location: "nameaddr", url: "https://sfplanninggis.org/pim?search={case_no}", labels } } as SourceDef, fetchedAt: "t", secret: () => undefined, http: async () => { throw new Error("offline"); } } as AdapterContext;
    const [r] = socrataAdapter.normalize([{ ...row, blklot: "1234001" }], ctx);
    expect(r).toMatchObject({ id: "pipe:6jgi-cpb4:2025-001728PRJ-1234001", kind: "development", title: "1234 GREAT HIGHWAY", date: "2025-03-18", location: "1234 GREAT HIGHWAY", url: "https://sfplanninggis.org/pim?search=2025-001728PRJ", text: "Status: planning application filed, under review." });
  });
});

describe("311", () => {
  const cfg = { neighborhood_field: "neighborhoods_sffind_boundaries", neighborhood: "Outer Sunset" };
  it("rounds addresses to the block and leaves intersections", () => {
    expect(toBlock("1234 46TH AVE, SAN FRANCISCO, CA, 94122")).toBe("1200 block of 46TH AVE");
    expect(toBlock("48 JUDAH ST, SAN FRANCISCO, CA")).toBe("0 block of JUDAH ST");
    expect(toBlock("Intersection of 48TH AVE and JUDAH ST")).toBe("48TH AVE and JUDAH ST");
  });
  it("builds a neighborhood query with topic, street, status, and window", () => {
    const w = build311Where({ topic: "graffiti", street: "Judah St", status: "open", days: 14 }, cfg, new Date("2026-11-06T20:00:00Z"));
    expect(w).toBe("neighborhoods_sffind_boundaries = 'Outer Sunset' AND requested_datetime > '2026-10-23' AND status_description = 'Open' AND upper(street) like '%JUDAH%' AND (lower(service_name) like '%graffiti%' OR lower(service_subtype) like '%graffiti%' OR lower(service_details) like '%graffiti%')");
  });
  it("maps plain words to the city's names", () => {
    const w = build311Where({ topic: "pothole" }, cfg, new Date("2026-11-06T20:00:00Z"));
    expect(w).toContain("lower(service_subtype) like '%pavement_defect%'");
  });
  it("labels project size", () => {
    expect(renderTemplate("[{n|size}.]", { n: "199.0" })).toBe("Major housing project.");
    expect(renderTemplate("[{n|size}.]", { n: "2" })).toBe("");
  });
  it("looks up one case by number and refuses injection", () => {
    expect(build311Where({ case_id: "#202000201941" }, cfg)).toBe("service_request_id = '202000201941'");
    expect(build311Where({ topic: "x' OR '1'='1" }, cfg)).not.toContain("' OR '1'='1");
  });
});
