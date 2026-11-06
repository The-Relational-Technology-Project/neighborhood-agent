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
  | "recommendation";

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
  events: FrontmatterDoc[];
  proposals: FrontmatterDoc[];
  corrections: Correction[];
  archive: FrontmatterDoc[];
  /** Neighbors' recommendations, one file per source under recs/. */
  recs: RecsFile[];
  questionLogMd: string;
  /** Settings parsed from place.md (`key: value` lines at the end). */
  settings: Record<string, string>;
}

export interface FrontmatterDoc {
  file: string;
  data: Record<string, unknown>;
  body: string;
}
