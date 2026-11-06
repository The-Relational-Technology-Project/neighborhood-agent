/**
 * Drafts for the three write actions. The model asks for a draft; the app holds it in memory;
 * only a neighbor's tap on "Yes, open the PR" turns it into a pull request.
 */
import { createHmac, randomUUID, timingSafeEqual } from "node:crypto";
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
  /** What the neighbor sees on the card: plain labels and values, no files. */
  summary: Array<[string, string]>;
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
  let summary: Array<[string, string]>;
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
          ...(clean(f.contact) ? { contact: clean(f.contact) } : {}),
          source: "told to the agent by the host",
          added: today,
        },
        clean(f.description) || "No description yet.",
      );
      title = `Event: ${name} on ${date}`;
      summary = [["Event", name], ["When", `${date}${clean(f.start) ? `, ${clean(f.start)}${clean(f.end) ? `–${clean(f.end)}` : ""}` : ""}`], ["Where", clean(f.place) || "to be confirmed"], ["Host", clean(f.host) || "a neighbor"], ["Contact", clean(f.contact)], ["About", clean(f.description)]];
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
      summary = [["About", target], ["What's changing", clean(f.field) || "other"], ["Knowy had", clean(f.was)], ["It should be", clean(f.now)], ["How you know", clean(f.how_known)], ["From", clean(f.by) || "a neighbor"]];
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
      summary = [["Idea", name], ["What", clean(f.what)], ["Why now", clean(f.why)], ["Already out there?", clean(f.already_exists) || "Knowy didn't find anything that does this yet"], ["Proposed by", clean(f.proposer) || "a neighbor"]];
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
    summary: summary.filter(([, v]) => v),
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

/**
 * A draft can also travel with the client, signed, so "Yes, open the PR" works on hosts that don't
 * keep memory between requests. The secret comes from DRAFT_SECRET, else from the API key's hash.
 */
function secret(): string {
  return process.env.DRAFT_SECRET || createHmac("sha256", "neighborhood-agent").update(process.env.ANTHROPIC_API_KEY ?? "unsigned").digest("hex");
}

export function signDraft(d: Draft): string {
  const payload = Buffer.from(JSON.stringify(d)).toString("base64url");
  const sig = createHmac("sha256", secret()).update(payload).digest("base64url");
  return `${payload}.${sig}`;
}

export function verifyDraft(token: string | undefined): Draft | undefined {
  if (!token || !token.includes(".")) return undefined;
  const [payload, sig] = token.split(".");
  const expected = createHmac("sha256", secret()).update(payload).digest("base64url");
  const a = Buffer.from(sig), b = Buffer.from(expected);
  if (a.length !== b.length || !timingSafeEqual(a, b)) return undefined;
  try {
    const d = JSON.parse(Buffer.from(payload, "base64url").toString()) as Draft;
    if (!d.path || !d.content || !["event", "correction", "proposal"].includes(d.kind)) return undefined;
    if (Date.parse(d.created_at) < Date.now() - DRAFT_TTL_MS) return undefined;
    return d;
  } catch {
    return undefined;
  }
}
