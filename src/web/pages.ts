import type { AppState } from "../state.js";
import type { VitalSign } from "../vitals/types.js";
import { esc, layout, md } from "./html.js";

function siteName(state: AppState): string {
  const m = state.repo.placeMd.match(/Working name:\s*\*\*(.+?)\*\*/);
  return m?.[1] ?? "Neighborhood agent";
}
function placeName(state: AppState): string {
  const m = state.repo.placeMd.match(/^#\s+(.+)$/m);
  return m?.[1] ?? "this neighborhood";
}

const shell = (state: AppState, path: string, title: string, body: string, head?: string) =>
  layout({ title: `${title} · ${siteName(state)}`, siteName: siteName(state), placeName: placeName(state), repoUrl: state.github.repoUrl, path, body, head });

/** One compact line of the most-asked vital signs; the full set is on /sources. */
function vitalLine(signs: VitalSign[]): string {
  const keep = ["tide", "water", "air", "plovers"];
  const short = (s: VitalSign) => (s.id === "plovers" ? (s.value.startsWith("protection") ? "dogs leashed on the south beach" : "off season") : s.id === "water" ? s.value.split(",")[0] : s.value.replace(/^next /, ""));
  const list = signs.filter((s) => keep.includes(s.id) && !s.error);
  if (!list.length) return "";
  return `<div class="vline">${list.map((s) => `<span><b>${esc(s.label)}</b> <a href="/sources" title="${esc(s.source.name)}">${esc(short(s))}</a></span>`).join("")}</div>`;
}

const SUGGESTIONS = ["What's happening this weekend?", "How's the ocean today?", "Who should I talk to about meeting neighbors?", "I want to add an event"];

export function vitalsHtml(signs: VitalSign[]): string {
  if (!signs.length) return "";
  return `<div class="vitals">${signs
    .filter((s) => !s.error || s.error === "stale")
    .map((s) => `<span><b>${esc(s.label)}</b> ${esc(s.value)} <a href="${esc(s.source.url)}" title="${esc(s.source.name)}, fetched ${esc(s.fetched_at.slice(0, 16).replace("T", " "))}">${esc(s.source.name)}</a></span>`)
    .join("")}</div>`;
}

export function homePage(state: AppState, signs: VitalSign[]): string {
  const ready = Boolean(state.agent);
  const body = `
${vitalLine(signs)}
<div class="chat" id="log">
  <div class="msg a"><span class="who a">Agent</span><span class="txt">${ready ? "Ask me anything about the neighborhood. I'll tell you where I got it." : "I'm not connected to a model yet, so I can't answer. The sources page shows what I read."}</span></div>
</div>
${ready ? `<div class="suggest" id="suggest">${SUGGESTIONS.map((q) => `<button type="button">${esc(q)}</button>`).join("")}</div>` : ""}
<form class="ask" id="ask">
  <textarea id="q" rows="1" placeholder="Ask the neighborhood" aria-label="Your question" ${ready ? "" : "disabled"}></textarea>
  <button id="send" type="submit" ${ready ? "" : "disabled"}>Ask</button>
</form>
<script src="/chat.js" defer></script>`;
  return shell(state, "/", "Ask", body);
}

export function aboutPage(state: AppState): string {
  const stewards = state.repo.stewardsMd.match(/\|[\s\S]*?\n\n/)?.[0] ?? "";
  const body = `
<p class="stamp">About</p>
<h1>A neighborhood agent</h1>
<p class="sub">A personal AI agent gets better the more it knows about you. This one belongs to a place instead, and everything it knows is public and shared.</p>
<div class="grid">
  <div class="card"><b class="k">It reads</b><p>Public neighborhood data only: sites neighbors already built, public feeds, this repo. Everything it knows is listed on the <a href="/sources">sources page</a>.</p></div>
  <div class="card"><b class="k">It cites</b><p>Every fact comes with where it came from and when. No source, no claim. If it doesn't know, it says so and names who might.</p></div>
  <div class="card"><b class="k">It asks before it writes</b><p>Asks become pull requests on a public repo. You see the exact change and say yes. Stewards review and merge.</p></div>
  <div class="card"><b class="k">It keeps nothing</b><p>No accounts, no memory of conversations. The only thing that lasts is a change you chose to make public, and one anonymous row in the <a href="${esc(state.github.repoUrl)}/blob/main/log/questions.md">question log</a>.</p></div>
</div>
<h2>Who stewards it</h2>
<p>The place is its stewards: a small group of neighbors who govern the agent together through <a href="${esc(state.github.repoUrl)}">the repo</a>. They set its voice, its sources, and its corrections.</p>
${md(stewards)}
<p><a href="${esc(state.github.repoUrl)}/blob/main/STEWARDS.md">How decisions get made, and how to become a steward</a>.</p>
<h2>How the place is defined</h2>
<p>The agent's standing instructions live in <a href="${esc(state.github.repoUrl)}/blob/main/place.md">place.md</a>. Stewards edit that file to change how it sounds and what it holds close. Here it is, as it stands:</p>
<div class="card">${md(state.repo.placeMd)}</div>
<h2>Its neighbors who aren't human</h2>
<p>The ocean, the dunes, the plovers, and the coyotes have standing. The agent reports their vital signs, brings their interests into answers when a plan touches them, and names their human advocates. It never speaks as them.</p>
<ul>${state.repo.constituents.map((c) => `<li><b>${esc(c.name)}</b>${c.advocates.length ? ` · advocates: ${c.advocates.map((a) => { const m = a.match(/^(.*?),\s*(https?:\/\/\S+)$/); return m ? `<a href="${esc(m[2])}">${esc(m[1])}</a>` : esc(a); }).join("; ")}` : ""}</li>`).join("")}</ul>
<p class="note">Open source, forkable. The code is one repo, the neighborhood's data is another. Another place can fork the code and bring its own data. <a href="https://github.com/The-Relational-Technology-Project/neighborhood-agent#forking-for-another-neighborhood">How</a>.</p>`;
  return shell(state, "/about", "About", body);
}

export function sourcesPage(state: AppState, signs: VitalSign[]): string {
  const rows = state.statuses.map((s) => `<tr><td><a href="${esc(s.url)}">${esc(s.name)}</a>${s.note ? `<br><small>${esc(s.note)}</small>` : ""}</td><td><span class="tag">${esc(s.status)}</span>${s.vital_sign ? ' <span class="tag">vital sign</span>' : ""}</td><td>${s.fetched_at ? esc(s.fetched_at.slice(0, 16).replace("T", " ")) + (s.stale ? " (stale)" : "") : s.status === "live" && !s.vital_sign ? (s.error ? "not yet" : "") : ""}</td><td>${s.vital_sign && s.status === "live" ? "live" : s.records || ""}</td><td><small>${esc(s.license ?? "")}${s.error ? `<br><span class="err">${esc(s.error)}</span>` : ""}</small></td></tr>`).join("");
  const body = `
<p class="stamp">Sources</p>
<h1>What it reads</h1>
<p class="sub">Every source, from <a href="${esc(state.github.repoUrl)}/blob/main/sources.yml">sources.yml</a>. If it isn't here, the agent doesn't know it. Index last built ${esc(state.lastBuild?.slice(0, 16).replace("T", " ") ?? "never")}; ${state.index.size} records.</p>
<table class="stack"><tr><th>Source</th><th>Status</th><th>Last fetched</th><th>Records</th><th>Permission note</th></tr>${rows}</table>
<h2>Vital signs right now</h2>
${vitalsHtml(signs)}
<ul>${signs.map((s) => `<li><b>${esc(s.label)}</b>: ${esc(s.value)}${s.detail ? `<br><small>${esc(s.detail).replace(/\n/g, "<br>")}</small>` : ""}<br><small>${esc(s.source.name)}, fetched ${esc(s.fetched_at.slice(0, 16).replace("T", " "))}${s.error ? ` · <span class="err">${esc(s.error)}</span>` : ""}</small></li>`).join("")}</ul>
<h2>Who it speaks for, and who speaks for them</h2>
<table class="stack"><tr><th>Constituent</th><th>Feeds</th><th>Human advocates</th></tr>${state.repo.constituents.map((c) => `<tr><td><a href="${esc(state.github.repoUrl)}/blob/main/constituents/${esc(c.slug)}.md">${esc(c.name)}</a></td><td>${esc(c.feeds.join(", "))}</td><td>${c.advocates.map((a) => { const m = a.match(/^(.*?),\s*(https?:\/\/\S+)$/); return m ? `<a href="${esc(m[2])}">${esc(m[1])}</a>` : esc(a); }).join("<br>")}</td></tr>`).join("")}</table>
<p class="note">Rules for every source: respect robots.txt and terms; cache with a per-source TTL and never hit a source on every message; keep the raw payload next to the normalized records so a steward can audit what the agent saw; corrections in the repo override source data for that field.</p>`;
  return shell(state, "/sources", "Sources", body);
}

export function proposalsPage(state: AppState, prs: Array<{ number: number; title: string; url: string; labels: string[]; created_at: string }>, prError?: string): string {
  const merged = state.repo.proposals.map((p) => `<div class="card"><b class="k">${esc(String(p.data.status ?? "open"))} · opened ${esc(String(p.data.opened ?? ""))} by ${esc(String(p.data.proposer ?? "a neighbor"))}</b><h3 style="margin-top:0">${esc(String(p.data.title ?? p.file))}</h3>${md(p.body)}<p><a href="${esc(state.github.repoUrl)}/blob/main/proposals/${esc(p.file)}">the file</a></p></div>`).join("");
  const open = prs.map((p) => `<li><a href="${esc(p.url)}">${esc(p.title)}</a> <small>opened ${esc(p.created_at.slice(0, 10))}</small></li>`).join("");
  const body = `
<p class="stamp">Proposals</p>
<h1>What neighbors have asked for</h1>
<p class="sub">A proposal is a public note that someone wants this, so the next person who asks can find them. It isn't a commitment. Ask the agent to open one, or <a href="${esc(state.github.repoUrl)}/tree/main/proposals">add a file</a>.</p>
<h2>Waiting for a steward</h2>
${open ? `<ul>${open}</ul>` : prError ? `<p class="err">Couldn't read open pull requests: ${esc(prError)}. <a href="${esc(state.github.repoUrl)}/pulls?q=is%3Apr+label%3Aproposal">See them on GitHub</a>.</p>` : `<p>None right now. <a href="${esc(state.github.repoUrl)}/pulls?q=is%3Apr+label%3Aproposal">Pull requests labeled proposal</a>.</p>`}
<h2>In the repo</h2>
${merged || "<p>None merged yet.</p>"}`;
  return shell(state, "/proposals", "Proposals", body);
}

export function correctPage(state: AppState, prs: Array<{ number: number; title: string; url: string; created_at: string }>): string {
  const body = `
<p class="stamp">Corrections</p>
<h1>How to correct the agent</h1>
<p class="sub">It will be wrong sometimes. Hours change, places close, a feed lags. Corrections in the repo beat anything the agent fetched, and it says "a neighbor corrected this on &lt;date&gt;" when it uses one.</p>
<div class="grid">
  <div class="card"><b class="k">In chat</b><p>Say "that's wrong" or "they close at 6 now". The agent shows what it currently believes and where that came from, asks how you know, and drafts a correction. You see the exact file. Tap yes and it opens a public pull request.</p></div>
  <div class="card"><b class="k">In the repo</b><p>Copy <a href="${esc(state.github.repoUrl)}/blob/main/corrections/_template.md">corrections/_template.md</a>, fill it in, open a pull request. Or <a href="${esc(state.github.repoUrl)}/issues/new?template=correction.md">open an issue</a> if you'd rather not touch files.</p></div>
</div>
<h2>Corrections waiting for a steward</h2>
${prs.length ? `<ul>${prs.map((p) => `<li><a href="${esc(p.url)}">${esc(p.title)}</a> <small>${esc(p.created_at.slice(0, 10))}</small></li>`).join("")}</ul>` : `<p>None open. <a href="${esc(state.github.repoUrl)}/pulls?q=is%3Apr+label%3Acorrection">Pull requests labeled correction</a>.</p>`}
<h2>Merged corrections</h2>
${state.repo.corrections.length ? `<table class="stack"><tr><th>Date</th><th>What</th><th>Now</th><th>How known</th></tr>${state.repo.corrections.map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(c.target)} (${esc(c.field)})</td><td>${esc(c.now)}</td><td>${esc(c.how_known ?? "")}</td></tr>`).join("")}</table>` : "<p>None yet.</p>"}`;
  return shell(state, "/correct", "Correct", body);
}

export function contactPage(state: AppState, result?: { ok?: string; error?: string }): string {
  const stewardEmails = [...state.repo.stewardsMd.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((m) => m[0]);
  const body = `
<p class="stamp">Contact</p>
<h1>Reach the stewards</h1>
<p class="sub">A note for the people who govern this agent. No account needed. It becomes a public issue on the repo${stewardEmails.length ? `, or email ${stewardEmails.map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join(", ")}` : ""}.</p>
${result?.ok ? `<p class="ok">Sent. ${result.ok}</p>` : ""}${result?.error ? `<p class="err">${esc(result.error)}</p>` : ""}
<form method="post" action="/contact">
  <label for="subject">Subject</label><input type="text" id="subject" name="subject" required maxlength="140">
  <label for="message">Message</label><textarea class="full" id="message" name="message" rows="6" required maxlength="4000"></textarea>
  <label for="reach">How to reach you (optional, will be public)</label><input type="text" id="reach" name="reach" maxlength="140">
  <label for="hp" style="display:none">Leave empty</label><input type="text" id="hp" name="website" style="display:none" tabindex="-1" autocomplete="off">
  <p style="margin-top:14px"><button type="submit">Send to the stewards</button></p>
</form>
<p class="standing">Issues are public. Don't put anything here you wouldn't pin to a pole.</p>`;
  return shell(state, "/contact", "Contact", body);
}
