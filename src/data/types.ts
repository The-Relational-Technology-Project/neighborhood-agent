/** The small set of record types every adapter normalizes into. */
export type RecordKind =
  | "event"
  | "place"
  | "group"
  | "resource"
  | "person"
  | "proposal"
  | "correction"
  | "archive-note"
  | "note"
  | "constituent"
  | "recommendation"
  | "development";

export interface SourceRef {
  id: string;
  name: string;
  url: string;
}

export interface Correction {
  target: string;
  field: string;
  was?: string;
  now: string;
  how_known?: string;
  by?: string;
  date: string;
  note?: string;
  file: string;
}

export interface NRecord {
  /** `${source.id}:${collection}:${localId}` so corrections can target it. */
  id: string;
  kind: RecordKind;
  title: string;
  text: string;
  url?: string;
  /** ISO date (YYYY-MM-DD) for events, menus, notes with a day. */
  date?: string;
  /** ISO datetime for events. */
  start?: string;
  end?: string;
  location?: string;
  tags?: string[];
  source: SourceRef;
  fetched_at: string;
  /** When a human last verified this (places, people). */
  verified_at?: string | null;
  corrections?: Correction[];
  /** Flagged by the injection scanner. The text is still data; this just marks it. */
  suspicious?: boolean;
  extra?: Record<string, unknown>;
}

export interface SourceTable {
  table: string;
  kind: RecordKind;
  select: string;
  filter?: string;
}

export interface SourceDef {
  id: string;
  name: string;
  url: string;
  type: "api" | "feed" | "page" | "repo-file";
  adapter?: string;
  refresh?: string;
  license?: string;
  status: "live" | "planned" | "excluded";
  note?: string;
  /** One plain line for neighbors on the sources page. */
  about?: string;
  vital_sign?: boolean;
  config?: Record<string, unknown> & { tables?: SourceTable[] };
}

export interface Constituent {
  slug: string;
  name: string;
  kind: string;
  feeds: string[];
  advocates: string[];
  body: string;
  frontmatter: Record<string, unknown>;
}

export interface Person {
  name: string;
  org?: string;
  role?: string;
  reach?: string;
  topics?: string[];
  listed?: string;
  consent?: string;
  source?: string;
}

export interface Place {
  name: string;
  address?: string;
  what?: string;
  url?: string;
  hours?: string | null;
  hours_source?: string | null;
  last_verified?: string | null;
  tags?: string[];
}

/** A group that's glad to meet people at a life change (doors.yml). */
export interface Door {
  group: string;
  moments: string[];
  what?: string;
  how_to_join?: string;
  url?: string;
  ok_to_point?: string | boolean;
  confirmed?: string;
}

/** A cross-link between two records (links.yml): "this rec is for that place", "this group runs that event". */
export interface Link {
  from: string;
  to: string;
  why?: string;
  /** Who proposed it: a steward, or "agent" (then a steward merged it). */
  by?: string;
  added?: string;
}

export interface Resource {
  name: string;
  what: string;
  url: string;
  answers?: string[];
  how_to_use?: string;
  source?: string;
}

export interface RecLink { label: string; url: string }

export interface Rec {
  name: string;
  category?: string;
  subcategory?: string;
  kind?: string;
  what?: string;
  vouches?: number | string;
  when?: string;
  links?: RecLink[];
  contact?: string;
  from_earlier_knowledge_base?: boolean;
}

export interface RecsFile {
  file: string;
  meta: { title?: string; from?: string; as_of?: string; caveat?: string; privacy?: string; how_to_reach?: string; how_to_read?: string; highlights?: string[] };
  recs: Rec[];
}

export interface DataRepo {
  root: string;
  sha?: string;
  placeMd: string;
  stewardsMd: string;
  readmeMd: string;
  sources: SourceDef[];
  constituents: Constituent[];
  people: Person[];
  orgs: Person[];
  places: Place[];
  resources: Resource[];
  /** Groups that welcome people at life changes, from doors.yml. Only ok_to_point: yes are used. */
  doors: Door[];
  /** Cross-links between records, from links.yml. */
  links: Link[];
  events: FrontmatterDoc[];
  proposals: FrontmatterDoc[];
  corrections: Correction[];
  archive: FrontmatterDoc[];
  /** Sources neighbors suggested, with the stewards' decisions. Shown, never used for answers. */
  suggestions: FrontmatterDoc[];
  /** Neighbors' recommendations, one file per source under recs/. */
  recs: RecsFile[];
  questionLogMd: string;
  /** Files that failed to parse on this load (e.g. "sources.yml: bad indentation at line 4"). */
  loadErrors: string[];
  /** Settings parsed from place.md (`key: value` lines at the end). */
  settings: Record<string, string>;
}

export interface FrontmatterDoc {
  file: string;
  data: Record<string, unknown>;
  body: string;
}
