/**
 * Drafts for the three write actions. The model asks for a draft; the app holds it in memory;
 * only a neighbor's tap on "Yes, open the PR" turns it into a pull request.
 */
import { randomUUID } from "node:crypto";
import { toFrontmatter } from "../data/frontmatter.js";
import { localDate } from "../data/index.js";
import { slug } from "../adapters/types.js";

export type DraftKind = "event" | "correction" | "proposal";

export interface DraftInput {
  kind: DraftKind;
  /** The neighbor's ask in their own words, for the PR body. */
  ask: string;
  fields: Record<string, string | undefined>;
}

export interface Draft {
  id: string;
  kind: DraftKind;
  path: string;
  content: string;
  title: string;
  body: string;
  labels: string[];
  created_at: string;
  ask: string;
}

export const drafts = new Map<string, Draft>();
const DRAFT_TTL_MS = 60 * 60 * 1000;

function sweep() {
  const cutoff = Date.now() - DRAFT_TTL_MS;
  for (const [id, d] of drafts) if (Date.parse(d.created_at) < cutoff) drafts.delete(id);
}

const clean = (v: string | undefined) => (v ?? "").toString().trim();

export function makeDraft(input: DraftInput, today = localDate()): Draft {
  sweep();
  const f = input.fields;
  const ask = clean(input.ask) || "(not given)";
  let path: string;
  let content: string;
  let title: string;
  let why: string;
  switch (input.kind) {
    case "event": {
      const date = clean(f.date) || today;
      const name = clean(f.title) || "Untitled event";
      path = `events/${date}-${slug(name) || "event"}.md`;
      content = toFrontmatter(
        {
          title: name,
          date,
          ...(clean(f.start) ? { start: clean(f.start) } : {}),
          ...(clean(f.end) ? { end: clean(f.end) } : {}),
          place: clean(f.place) || "to be confirmed",
          host: clean(f.host) || "a neighbor",
          contact: clean(f.contact) || "ask the agent",
          source: "told to the agent by the host",
          added: today,
        },
        clean(f.description) || "No description yet.",
      );
      title = `Event: ${name} on ${date}`;
      why = "A neighbor asked to add this event to the neighborhood calendar.";
      break;
    }
    case "correction": {
      const target = clean(f.target) || "unknown";
      path = `corrections/${today}-${slug(target) || "correction"}.md`;
      content = toFrontmatter(
        {
          target,
          field: clean(f.field) || "other",
          ...(clean(f.was) ? { was: clean(f.was) } : {}),
          now: clean(f.now) || "(not given)",
          how_known: clean(f.how_known) || "(not given)",
          by: clean(f.by) || "a neighbor",
          date: today,
        },
        clean(f.note) || "",
      );
      title = `Correction: ${target} (${clean(f.field) || "other"})`;
      why = "A neighbor said the agent had this wrong. Corrections in the repo override fetched data.";
      break;
    }
    case "proposal": {
      const name = clean(f.title) || "A proposal";
      path = `proposals/${today}-${slug(name) || "proposal"}.md`;
      content = toFrontmatter(
        { title: name, proposer: clean(f.proposer) || "a neighbor", status: "open", opened: today, related: [] },
        [
          `## What\n\n${clean(f.what) || "(not given)"}`,
          `## Why now\n\n${clean(f.why) || "(not given)"}`,
          `## Already exists?\n\n${clean(f.already_exists) || "The agent found nothing that already does this."}`,
          `## Comments\n\n- ${today}, agent: opened on behalf of a neighbor.`,
        ].join("\n\n"),
      );
      title = `Proposal: ${name}`;
      why = "A neighbor wants this and nothing in the repo already does it. A proposal is a public note, not a commitment.";
      break;
    }
  }
  const draft: Draft = {
    id: randomUUID(),
    kind: input.kind,
    path,
    content,
    title,
    labels: [input.kind],
    created_at: new Date().toISOString(),
    ask,
    body: [
      `**What the neighbor asked for, in their words**\n\n> ${ask.replace(/\n/g, "\n> ")}`,
      `**What the agent changed**\n\nAdds \`${path}\`.`,
      `**Why**\n\n${why}`,
      `The neighbor saw this exact content and said yes. A steward reviews and merges; nothing is live until then. Opened by the neighborhood agent.`,
    ].join("\n\n"),
  };
  drafts.set(draft.id, draft);
  return draft;
}
