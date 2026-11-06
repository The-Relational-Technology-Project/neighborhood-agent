/**
 * Any Socrata (SODA) dataset, configured in sources.yml: DataSF, and most US city open-data
 * portals. The source says which rows to read and how to turn a row into a record, with small
 * templates so stewards can add a dataset without code:
 *
 *   config:
 *     domain: data.sf.gov
 *     dataset: 6jgi-cpb4
 *     select: case_no,nameaddr,current_status,...     # only these columns are fetched
 *     where: nhood41 = 'Sunset/Parkside'               # SoQL; {today} and {today-N} are filled in
 *     order: current_status_date DESC
 *     limit: 500
 *     kind: development
 *     id: case_no
 *     title: "{nameaddr}"
 *     text: "{description_planning}[ Status: {current_status|label} as of {current_status_date|date}.]"
 *     date: current_status_date
 *     location: nameaddr
 *     url: "https://sfplanninggis.org/pim?search={case_no}"
 *     labels: { current_status: { "PL Filed": "planning application filed" } }
 *
 * Template rules: {field} is the value, {field|date} its YYYY-MM-DD, {field|num} a number without a
 * trailing .0, {field|label} the value through `labels`, {field|size} a size word for a unit count
 * (Major housing project at 50+, Large at 10+, Small multi-unit at 3+, else empty). Text inside [ ] is dropped when any field
 * in it is empty or zero-ish. An optional SOCRATA_APP_TOKEN raises the rate limit.
 */
import type { NRecord, RecordKind } from "../data/types.js";
import { localDate } from "../data/index.js";
import { sourceRef, type Adapter, type AdapterContext } from "./types.js";

type Row = Record<string, unknown>;
type Labels = Record<string, Record<string, string>>;

export function fillSoqlDates(s: string, now = new Date()): string {
  return s.replace(/\{today(?:([+-])(\d+))?\}/g, (_m, sign, n) => {
    const d = new Date(now);
    if (n) d.setDate(d.getDate() + (sign === "-" ? -Number(n) : Number(n)));
    return localDate(d);
  });
}

function fieldValue(row: Row, expr: string, labels: Labels): string {
  const [name, filter] = expr.split("|").map((x) => x.trim());
  const raw = row[name];
  if (raw === undefined || raw === null) return "";
  let v = typeof raw === "object" ? ((raw as { url?: string }).url ?? JSON.stringify(raw)) : String(raw);
  v = v.trim();
  if (filter === "date") v = v.slice(0, 10);
  else if (filter === "num") { const n = Number(v); v = Number.isFinite(n) ? String(Math.round(n * 100) / 100) : v; }
  else if (filter === "label") v = labels[name]?.[v] ?? v;
  else if (filter === "size") { const n = Number(v); v = !Number.isFinite(n) ? "" : n >= 50 ? "Major housing project" : n >= 10 ? "Large housing project" : n >= 3 ? "Small multi-unit project" : ""; }
  return v;
}

const EMPTYISH = new Set(["", "0", "0.0", "null", "undefined"]);

export function renderTemplate(tpl: string, row: Row, labels: Labels = {}): string {
  const one = (t: string) => t.replace(/\{([^{}]+)\}/g, (_m, expr) => fieldValue(row, expr, labels));
  const withOptional = tpl.replace(/\[([^[\]]*)\]/g, (_m, inner: string) => {
    const fields = [...inner.matchAll(/\{([^{}]+)\}/g)].map((m) => fieldValue(row, m[1], labels));
    return fields.some((f) => EMPTYISH.has(f)) ? "" : one(inner);
  });
  return one(withOptional).replace(/\s{2,}/g, " ").trim();
}

export function sodaUrl(c: Record<string, unknown>, now = new Date()): string {
  const params = new URLSearchParams();
  if (c.select) params.set("$select", String(c.select));
  if (c.where) params.set("$where", fillSoqlDates(String(c.where), now));
  if (c.order) params.set("$order", String(c.order));
  params.set("$limit", String(c.limit ?? 500));
  return `https://${String(c.domain)}/resource/${String(c.dataset)}.json?${params}`;
}

export const socrataAdapter: Adapter = {
  id: "socrata",
  async fetch(ctx: AdapterContext) {
    const c = ctx.source.config ?? {};
    if (!c.domain || !c.dataset) throw new Error("socrata: domain and dataset are required");
    const token = process.env.SOCRATA_APP_TOKEN;
    const res = await ctx.http(sodaUrl(c), { headers: token ? { "X-App-Token": token } : {} });
    if (!res.ok) throw new Error(`socrata: ${String(c.dataset)} ${res.status} ${(await res.text()).slice(0, 160)}`);
    return await res.json();
  },
  normalize(raw, ctx): NRecord[] {
    const c = ctx.source.config ?? {};
    const labels = (c.labels ?? {}) as Labels;
    const rows = Array.isArray(raw) ? (raw as Row[]) : [];
    const src = sourceRef(ctx);
    const kind = (String(c.kind ?? "note") as RecordKind);
    return rows.map((row, i) => {
      const idSpec = c.id ? String(c.id) : "";
      const id = idSpec.includes("{") ? renderTemplate(idSpec, row, labels) : idSpec ? fieldValue(row, idSpec, labels) : String(i);
      const date = c.date ? fieldValue(row, `${String(c.date)}|date`, labels) : "";
      return {
        id: `${src.id}:${String(c.dataset)}:${id || i}`,
        kind,
        title: c.title ? renderTemplate(String(c.title), row, labels) : id,
        text: c.text ? renderTemplate(String(c.text), row, labels) : "",
        date: date || undefined,
        location: c.location ? fieldValue(row, String(c.location), labels) || undefined : undefined,
        url: c.url ? renderTemplate(String(c.url), row, labels) : src.url,
        source: src,
        fetched_at: ctx.fetchedAt,
        tags: [kind, ...(Array.isArray(c.tags) ? (c.tags as string[]) : [])],
        extra: row,
      };
    });
  },
};
