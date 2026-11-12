/**
 * The commons pages: what the neighborhood knows, who has offered to be asked, and the two ways to
 * give (share something you know; offer to be asked). No AI runs on any of these.
 */
import { isActiveKnower } from "../adapters/repo.js";
import { aboutBlock, type Nearby } from "../blocks/geo.js";
import type { BlockNote, FrontmatterDoc } from "../data/types.js";
import type { AppState } from "../state.js";
import { esc, md } from "./html.js";
import { shell } from "./pages.js";

export interface CommonsOpts { relay: boolean; canSend: boolean; result?: { ok?: string; error?: string } }

const HP = '<input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">';
const noteName = (d: FrontmatterDoc) => d.file.replace(/\.md$/, "");

export function commonsPage(state: AppState, opts: CommonsOpts): string {
  const knowers = state.repo.knowers.filter(isActiveKnower);
  const shared = state.repo.knowledge.slice().sort((a, b) => b.file.localeCompare(a.file));
  const notes = state.repo.archive;
  const body = `
<p class="stamp">Commons</p>
<h1>What the neighborhood knows</h1>
<p class="sub">Knowing a place is something neighbors give each other. Everything here was given by someone, belongs to everyone, and is free to read and reuse. Knowy holds the start of most stories. A neighbor usually holds the rest.</p>
${opts.result?.ok ? `<p class="ok"><b>${esc(opts.result.ok)}</b></p>` : ""}${opts.result?.error ? `<p class="err">${esc(opts.result.error)}</p>` : ""}
<h2 id="ask">Neighbors who've offered to be asked</h2>
${knowers.length ? `<ul class="srclist">${knowers.map((k) => `<li><div class="srchead">${esc(String(k.data.described_as ?? "A neighbor"))}</div><p>${esc(String(k.data.knows ?? ""))}</p></li>`).join("")}</ul>
<p>To ask one of them, <a href="/">ask Knowy your question</a>. It tells you what it knows, then offers to pass your question along. You can leave your email so they can write back, or leave nothing and the answer comes back here for everyone.</p>` : `<p>Nobody yet. You could be the first.</p>`}
<h2 id="offer">Offer to be asked</h2>
<p>Lived here a long time? Know the birds, the surf, the history of your block, how to get a street tree planted? Let neighbors ask you. Your name and email are kept private: they aren't shown here, Knowy never sees them, and a question reaches you by email without the asker learning your address. You answer only if you want to, and every email has a link to stop.</p>
${opts.relay ? `<form method="post" action="/commons/offer" class="card">
  <label for="o-knows">What could neighbors ask you about? <small>(shown here)</small></label><textarea class="full" id="o-knows" name="knows" rows="3" required maxlength="400" placeholder="The Carville houses, what Judah looked like in the 70s, the shorebirds at the south end"></textarea>
  <label for="o-as">How should Knowy describe you? <small>(shown here; no name needed)</small></label><input type="text" id="o-as" name="described_as" maxlength="100" placeholder="a neighbor on 46th since 1974">
  <label for="o-name">Your name <small>(private)</small></label><input type="text" id="o-name" name="name" required maxlength="80" autocomplete="name">
  <label for="o-email">Your email <small>(private)</small></label><input type="email" id="o-email" name="email" required maxlength="200" autocomplete="email">
  ${HP}
  <p style="margin:16px 0 0"><button type="submit">Send me a link to confirm</button></p>
</form>` : `<p class="note">This isn't switched on here yet. <a href="/contact">Write to the stewards</a> and they'll let you know when it is.</p>`}
<h2 id="share">Share something you know</h2>
<p>A memory, a piece of the block's history, something you've watched change. A steward reads it first; then it's public, and Knowy passes it on as one neighbor's account. You can also just tell Knowy in the chat.</p>
${opts.canSend ? `<form method="post" action="/commons/share" class="card">
  <label for="s-title">What's it about?</label><input type="text" id="s-title" name="title" required maxlength="120" placeholder="The horses that used to graze at 45th and Vicente">
  <label for="s-what">What you know</label><textarea class="full" id="s-what" name="what" rows="6" required maxlength="4000"></textarea>
  <label for="s-how">How you know it <small>(optional)</small></label><input type="text" id="s-how" name="how_known" maxlength="200" placeholder="I grew up on that block">
  <label for="s-by">How to credit you <small>(optional)</small></label><input type="text" id="s-by" name="shared_by" maxlength="100" placeholder="a neighbor">
  ${HP}
  <p style="margin:16px 0 0"><button type="submit">Give it to the neighborhood</button></p>
</form>` : `<p><a href="/contact">Write to the stewards</a>.</p>`}
${state.repo.blocks.length ? `<h2 id="blocks">Block by block</h2><p>${state.repo.blockNotes.filter((n) => n.kind !== "photo").length} notes and ${state.repo.blockNotes.filter((n) => n.kind === "photo").length} old photographs, each pinned to a corner. <a href="/commons/blocks">Look up your block</a>, or ask Knowy what's special about it.</p>` : ""}
${shared.length ? `<h2 id="shared">From neighbors</h2><ul>${shared.map((k) => `<li><a href="/commons/shared/${esc(noteName(k))}">${esc(String(k.data.title ?? noteName(k)))}</a> <small>${esc(String(k.data.shared_by ?? "a neighbor"))}${k.data.shared ? `, ${esc(String(k.data.shared))}` : ""}</small></li>`).join("")}</ul>` : ""}
${notes.length ? `<h2 id="notes">History and field notes</h2><p>Gathered from public sources, each one named, as a place to start. A neighbor's correction wins over any of it.</p><ul>${notes.map((n) => `<li><a href="/commons/notes/${esc(noteName(n))}">${esc(String(n.data.title ?? noteName(n)))}</a></li>`).join("")}</ul>` : ""}
<p class="note">Shared under CC BY 4.0: anyone may reuse it with credit. Looked after by the stewards.</p>`;
  return shell(state, "/commons", "Commons", body);
}

export function notePage(state: AppState, doc: FrontmatterDoc, kind: "notes" | "shared"): string {
  const d = doc.data;
  const meta = kind === "shared"
    ? `Shared by ${esc(String(d.shared_by ?? "a neighbor"))}${d.shared ? ` on ${esc(String(d.shared))}` : ""}. One neighbor's account.${d.how_known ? ` How they know: ${esc(String(d.how_known))}.` : ""}`
    : d.researched ? `Gathered from the public sources named in each section, ${esc(String(d.researched))}. A place to start; a neighbor may know more.` : "";
  const body = `
<p class="stamp"><a href="/commons">Commons</a></p>
<h1>${esc(String(d.title ?? noteName(doc)))}</h1>
${meta ? `<p class="sub">${meta}</p>` : ""}
${d.question ? `<p class="note">A neighbor asked: ${esc(String(d.question))}</p>` : ""}
${md(doc.body)}
<p class="note">Know more, or know better? <a href="/">Tell Knowy</a>, or <a href="/commons#share">share it here</a>.</p>`;
  return shell(state, "/commons", String(d.title ?? "Commons"), body);
}

const srcLinks = (n: BlockNote) => (n.sources?.length ? `<small>Sources: ${n.sources.map((s) => `<a href="${esc(s.url)}" rel="noopener">${esc(s.name)}</a>`).join(", ")}</small>` : "");
function noteItem(n: BlockNote, far?: string): string {
  if (n.kind === "photo") {
    const links = n.sources?.length ? n.sources : n.photo ? [{ name: n.photo.credit ?? "the photograph", url: n.photo.page }] : [];
    return `<li><div class="srchead">${esc(n.title)}${n.years ? `, ${esc(n.years)}` : ""}</div><small>${far ? `${esc(far)}. ` : ""}${links.map((l) => `<a href="${esc(l.url)}" rel="noopener">${esc(l.name)}</a>`).join(", ")}</small></li>`;
  }
  return `<li><div class="srchead">${esc(n.title)}${n.years ? ` <small>${esc(n.years)}</small>` : ""}</div><p>${esc(n.text)}</p><small>${far ? `${esc(far)}${n.at ? `, at ${esc(n.at)}` : ""}. ` : n.extent ? `${esc(n.extent)}. ` : ""}</small>${srcLinks(n)}</li>`;
}
const noteList = (xs: Nearby[]) => `<ul class="srclist">${xs.map((x) => noteItem(x.note, x.far)).join("")}</ul>`;

/** Look up one block: what the notes hold about it and what is pinned nearby. No AI runs here. */
export function blocksPage(state: AppState, where: string): string {
  const { blocks, blockNotes } = state.repo;
  const a = where ? aboutBlock(state.repo, where, { notes: 8, photos: 8 }) : undefined;
  const r = a?.resolved;
  const found = r && r.lat !== undefined;
  const shown = found ? (r.status === "corner" ? r.blocks.slice(0, 4) : r.blocks.slice(0, 1)) : [];
  const result = !a || !r ? "" : !found
    ? `<p class="err">Couldn't place that. Try a street and its two cross streets (46th between Moraga and Noriega), or a corner (46th and Judah).</p>`
    : `<h2>${esc(r.status === "corner" ? `The corner of ${r.label}` : r.label)}</h2>
<ul>${shown.map((b) => `<li><b>${esc(b.name)}</b>${b.about ? `: ${esc(b.about)}` : ""}</li>`).join("")}</ul>
${state.repo.blocksSources && shown.some((b) => b.about) ? `<p><small>${esc(state.repo.blocksSources)}</small></p>` : ""}
${a.near.length ? `<h2>${a.widened ? "The closest, a few blocks off" : "On or near this block"}</h2>${noteList(a.near)}` : ""}
${a.photos.length ? `<h2>Old photographs taken near here</h2><p>Pins in an archive's own map. Each link opens the photograph there, with its date and caption.</p>${noteList(a.photos)}` : ""}
${a.area.length ? `<h2>The wider stretch</h2>${noteList(a.area)}` : ""}
${a.everywhere.length ? `<h2>True of every block here</h2><ul class="srclist">${a.everywhere.map((n) => noteItem(n)).join("")}</ul>` : ""}
${!a.near.length && !a.photos.length ? `<p>Nothing is pinned near this block yet.</p>` : ""}
<p class="note">Know something about this block? <a href="/commons#share">Share it</a>, or <a href="/">tell Knowy</a>. A neighbor's own account wins over any of this.</p>`;
  const body = `
<p class="stamp"><a href="/commons">Commons</a></p>
<h1>Block by block</h1>
<p class="sub">History, the ground underfoot, and old photographs, pinned to the corner they belong to. ${blocks.length} blocks, ${blockNotes.filter((n) => n.kind !== "photo").length} notes, ${blockNotes.filter((n) => n.kind === "photo").length} photographs. Gathered from public sources as a place to start.</p>
<form method="get" action="/commons/blocks" class="card">
  <label for="b-where">Your block or corner <small>(streets only, no house number)</small></label><input type="text" id="b-where" name="where" maxlength="200" required value="${esc(where)}" placeholder="46th between Moraga and Noriega">
  <p style="margin:16px 0 0"><button type="submit">Look it up</button></p>
</form>
${result}`;
  return shell(state, "/commons", "Block by block", body);
}

/** A small page with a message and, optionally, one form. Used by the links in emails. */
export function linkPage(state: AppState, title: string, inner: string): string {
  return shell(state, "/commons", title, `<p class="stamp"><a href="/commons">Commons</a></p><h1>${esc(title)}</h1>${inner}`, '<meta name="robots" content="noindex"><meta name="referrer" content="no-referrer">');
}

export function confirmOfferPage(state: AppState, token: string, o: { described_as: string; knows: string; email: string }): string {
  return linkPage(state, "Confirm: neighbors can ask you", `
<p class="sub">Here's what neighbors will see. Your name and ${esc(o.email)} stay private.</p>
<div class="card"><b class="k">${esc(o.described_as || "a neighbor")}</b><p>${esc(o.knows)}</p></div>
<p>A steward reads this first. After that, when a neighbor's question fits, Knowy emails it to you. Answer if you'd like. Every email has a link to stop.</p>
<form method="post" action="/commons/confirm"><input type="hidden" name="t" value="${esc(token)}"><p><button type="submit">Yes, neighbors can ask me</button></p></form>`);
}

export function answerPage(state: AppState, token: string, a: { question: string; credit: string }, error?: string): string {
  return linkPage(state, "Share your answer with the neighborhood", `
<p class="sub">A neighbor asked:</p>
<div class="card"><p>${esc(a.question)}</p></div>
${error ? `<p class="err">${esc(error)}</p>` : ""}
<form method="post" action="/commons/answer" class="card">
  <input type="hidden" name="t" value="${esc(token)}">
  <label for="a-what">What you know</label><textarea class="full" id="a-what" name="what" rows="8" required maxlength="4000"></textarea>
  <label for="a-how">How you know it <small>(optional)</small></label><input type="text" id="a-how" name="how_known" maxlength="200">
  <label for="a-by">How to credit you</label><input type="text" id="a-by" name="shared_by" maxlength="100" value="${esc(a.credit)}">
  ${HP}
  <p><small>A steward reads it first. Then it's public (CC BY 4.0) and Knowy passes it on as one neighbor's account. Please leave out other people's names and addresses.</small></p>
  <p style="margin:16px 0 0"><button type="submit">Give it to the neighborhood</button></p>
</form>`);
}

export function stopPage(state: AppState, token: string): string {
  return linkPage(state, "Stop being asked", `
<p class="sub">No more questions will come to you, and your name and email will be deleted. You can offer again any time.</p>
<form method="post" action="/commons/stop"><input type="hidden" name="t" value="${esc(token)}"><p><button type="submit">Yes, stop</button></p></form>`);
}
