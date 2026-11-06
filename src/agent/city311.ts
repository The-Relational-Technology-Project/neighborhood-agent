/**
 * Live 311 lookups against a Socrata 311 dataset, configured by the source in sources.yml marked
 * `live_query: 311`. Answers counts and recent cases for the neighborhood, or one case by number.
 *
 * Privacy: addresses are shown at block level ("1200 block of 46TH AVE"), the way police data is
 * published, so a report can't be pinned to a house. Reporters aren't in the data and are never
 * guessed. Photos aren't linked.
 */
import type { DataRepo, SourceDef } from "../data/types.js";
import { localDate } from "../data/index.js";
import { httpFetch } from "../data/loader.js";

export interface Query311 { case_id?: string; topic?: string; street?: string; status?: "open" | "closed" | "any"; days?: number }

export function find311Source(repo: DataRepo): SourceDef | undefined {
  return repo.sources.find((s) => s.status === "live" && String((s as unknown as Record<string, unknown>).live_query ?? "") === "311");
}

/** "1234 46TH AVE, SAN FRANCISCO, CA, 94122" → "1200 block of 46TH AVE"; intersections stay as they are. */
export function toBlock(address: string): string {
  const a = address.replace(/,\s*SAN FRANCISCO.*$/i, "").trim();
  const m = a.match(/^(\d+)[A-Z]?\s+(.+)$/i);
  if (!m) return a.replace(/^Intersection of /i, "");
  return `${Math.floor(Number(m[1]) / 100) * 100} block of ${m[2]}`;
}

const esc = (s: string) => s.replace(/'/g, "''").replace(/%/g, "");

/** Plain words neighbors use, mapped to what the city's data calls them. Sources can add more. */
export const DEFAULT_TOPIC_ALIASES: Record<string, string[]> = {
  pothole: ["pavement_defect"], potholes: ["pavement_defect"], pavement: ["pavement_defect"],
  sidewalk: ["sidewalk", "curb"], crack: ["sidewalk_defect", "pavement_defect"],
  trash: ["cleaning", "litter", "garbage"], garbage: ["cleaning", "garbage"], litter: ["cleaning", "litter"], dumping: ["cleaning", "dumping"],
  streetlight: ["streetlight"], "street light": ["streetlight"], light: ["streetlight"],
  tree: ["tree"], trees: ["tree"], graffiti: ["graffiti"], noise: ["noise"], encampment: ["encampment"], homeless: ["encampment"],
  parking: ["parking"], "abandoned car": ["abandoned vehicle", "abandoned_vehicle"], car: ["vehicle", "parking"],
  sewer: ["sewer"], flooding: ["sewer", "flood"], muni: ["muni"], signs: ["sign"],
};

export function build311Where(q: Query311, cfg: Record<string, unknown>, now = new Date()): string {
  if (q.case_id) return `service_request_id = '${esc(q.case_id.replace(/\D/g, ""))}'`;
  const parts: string[] = [];
  if (cfg.neighborhood_field && cfg.neighborhood) parts.push(`${String(cfg.neighborhood_field)} = '${esc(String(cfg.neighborhood))}'`);
  const days = Math.min(365, Math.max(1, Math.round(q.days ?? 30)));
  const since = new Date(now); since.setDate(since.getDate() - days);
  parts.push(`requested_datetime > '${localDate(since)}'`);
  if (q.status === "open") parts.push(`status_description = 'Open'`);
  if (q.status === "closed") parts.push(`status_description = 'Closed'`);
  if (q.street) parts.push(`upper(street) like '%${esc(q.street.toUpperCase().replace(/\s+(STREET|ST|AVENUE|AVE|BLVD|BOULEVARD|WAY)\.?$/i, ""))}%'`);
  if (q.topic) {
    const key = q.topic.toLowerCase().trim();
    const aliases = { ...DEFAULT_TOPIC_ALIASES, ...((cfg.topic_aliases ?? {}) as Record<string, string[]>) };
    const terms = [...new Set([key, ...(aliases[key] ?? [])])].map(esc).filter(Boolean);
    const ors = terms.flatMap((t) => [`lower(service_name) like '%${t}%'`, `lower(service_subtype) like '%${t}%'`, `lower(service_details) like '%${t}%'`]);
    parts.push(`(${ors.join(" OR ")})`);
  }
  return parts.join(" AND ");
}

async function soda(cfg: Record<string, unknown>, params: Record<string, string>): Promise<Record<string, string>[]> {
  const u = new URLSearchParams(params);
  const token = process.env.SOCRATA_APP_TOKEN;
  const res = await httpFetch(`https://${String(cfg.domain)}/resource/${String(cfg.dataset)}.json?${u}`, { headers: token ? { "X-App-Token": token } : {} });
  if (!res.ok) throw new Error(`311 data ${res.status}`);
  return (await res.json()) as Record<string, string>[];
}

export async function run311(repo: DataRepo, q: Query311): Promise<string> {
  const src = find311Source(repo);
  if (!src) return "No 311 source is configured for this neighborhood.";
  const cfg = src.config ?? {};
  const where = build311Where(q, cfg);
  const fields = "service_request_id,requested_datetime,closed_date,updated_datetime,status_description,status_notes,agency_responsible,service_name,service_subtype,service_details,address";
  const caseLink = (id: string) => String(cfg.case_url ?? "https://mobile311.sfgov.org/tickets/{id}").replace("{id}", id);
  const line = (r: Record<string, string>) =>
    `#${r.service_request_id} · ${r.service_name}${r.service_subtype ? ` / ${r.service_subtype}` : ""}${r.service_details ? ` (${r.service_details})` : ""} · ${toBlock(r.address ?? "")} · opened ${String(r.requested_datetime ?? "").slice(0, 10)} · ${r.status_description}${r.closed_date ? ` ${String(r.closed_date).slice(0, 10)}` : ""}${r.status_notes ? ` · city note: ${String(r.status_notes).slice(0, 140)}` : ""} · ${r.agency_responsible ?? ""} · ${caseLink(r.service_request_id)}`;

  const header = `Source: ${src.name} (${src.url}), queried live ${new Date().toISOString().slice(0, 16).replace("T", " ")} UTC. Addresses are rounded to the block. Reporters are not in the data.`;
  if (q.case_id) {
    const rows = await soda(cfg, { $select: fields, $where: where, $limit: "1" });
    if (!rows.length) return `${header}\nNo 311 case ${q.case_id} found. New cases can take a day to appear in the open data.`;
    return `${header}\n${line(rows[0])}`;
  }
  const [counts, recent] = await Promise.all([
    soda(cfg, { $select: "service_name, status_description, count(*) AS n", $where: where, $group: "service_name, status_description", $order: "n DESC", $limit: "40" }),
    soda(cfg, { $select: fields, $where: where, $order: "requested_datetime DESC", $limit: "12" }),
  ]);
  const total = counts.reduce((a, r) => a + Number(r.n), 0);
  const open = counts.filter((r) => r.status_description === "Open").reduce((a, r) => a + Number(r.n), 0);
  const byService = new Map<string, { open: number; total: number }>();
  for (const r of counts) { const e = byService.get(r.service_name) ?? { open: 0, total: 0 }; e.total += Number(r.n); if (r.status_description === "Open") e.open += Number(r.n); byService.set(r.service_name, e); }
  const top = [...byService.entries()].sort((a, b) => b[1].total - a[1].total).slice(0, 10).map(([k, v]) => `${k}: ${v.total} (${v.open} open)`);
  const scope = `${String(cfg.neighborhood ?? "the neighborhood")}, last ${Math.min(365, Math.max(1, Math.round(q.days ?? 30)))} days${q.topic ? `, matching "${q.topic}"` : ""}${q.street ? `, on ${q.street}` : ""}${q.status && q.status !== "any" ? `, ${q.status}` : ""}`;
  return [header, `Scope: ${scope}. Total ${total}, open ${open}.`, top.length ? `By type: ${top.join("; ")}.` : "No cases.", recent.length ? "Most recent:" : "", ...recent.map(line), `To report something new: ${String(cfg.report_url ?? "https://sf311.org")} or call 311.`].filter(Boolean).join("\n");
}
