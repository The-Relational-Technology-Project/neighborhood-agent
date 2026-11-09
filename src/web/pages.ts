import type { AppState } from "../state.js";
import type { VitalSign } from "../vitals/types.js";
import type { SourceStatus } from "../data/loader.js";
import { esc, layout, md } from "./html.js";

function siteName(state: AppState): string {
  const m = state.repo.placeMd.match(/Working name:\s*\*\*(.+?)\*\*/);
  return m?.[1] ?? "Neighborhood agent";
}
function tagline(state: AppState): string | undefined {
  return state.repo.placeMd.match(/^Tagline:\s*(.+?)\s*$/m)?.[1];
}
/** A neighbor-facing line about the name, from `About:` in place.md. */
function aboutLine(state: AppState): string | undefined {
  return state.repo.placeMd.match(/^About:\s*(.+?)\s*$/m)?.[1];
}
function placeName(state: AppState): string {
  const m = state.repo.placeMd.match(/^#\s+(.+)$/m);
  return m?.[1] ?? "this neighborhood";
}

const shell = (state: AppState, path: string, title: string, body: string, head?: string) =>
  layout({ title: path === "/" ? `${siteName(state)}${tagline(state) ? ` · ${tagline(state)}` : ""}` : `${title} · ${siteName(state)}`, siteName: siteName(state), tagline: tagline(state), placeName: placeName(state), siteUrl: state.cfg.siteUrl, brand: state.brand, repoUrl: state.github.repoUrl, path, body, head });

/** One compact line of the most-asked vital signs; the full set is on /sources. */
function vitalLine(signs: VitalSign[]): string {
  const keep = ["tide", "water", "air", "plovers"];
  const short = (s: VitalSign) => (s.id === "plovers" ? (s.value.startsWith("protection") ? "dogs leashed on the south beach" : "off season") : s.id === "water" ? s.value.split(",")[0] : s.value.replace(/^next /, ""));
  const list = signs.filter((s) => keep.includes(s.id) && !s.error);
  if (!list.length) return "";
  return `<div class="vline">${list.map((s) => `<span><b>${esc(s.label)}</b> <a href="/sources" title="${esc(s.source.name)}">${esc(short(s))}</a></span>`).join("")}</div>`;
}

const SUGGESTIONS = ["Who should I talk to about meeting neighbors?", "What's happening this weekend?", "How's the ocean today?", "I want to add an event"];

export function vitalsHtml(signs: VitalSign[]): string {
  if (!signs.length) return "";
  return `<div class="vitals">${signs
    .filter((s) => !s.error || s.error === "stale")
    .map((s) => `<span><b>${esc(s.label)}</b> ${esc(s.value)} <a href="${esc(s.source.url)}" title="${esc(s.source.name)}, fetched ${esc(s.fetched_at.slice(0, 16).replace("T", " "))}">${esc(s.source.name)}</a></span>`)
    .join("")}</div>`;
}

export function homePage(state: AppState, signs: VitalSign[]): string {
  const ready = Boolean(state.agent);
  const logo = state.brand.has("logo.webp")
    ? `<img src="/brand/logo.webp" alt="${esc(siteName(state))}" width="250" height="236" fetchpriority="high">`
    : `<h1>${esc(siteName(state))}</h1>`;
  const body = `
<div class="chat" id="log" role="log" aria-live="polite">
  <div class="hero">${logo}${tagline(state) ? `<p class="tagline">${esc(tagline(state))}</p>` : ""}${vitalLine(signs)}<p class="promise">Looked after by neighbors · reads only <a href="/sources">public sources</a> · keeps nothing you type · <a href="/about">how it works</a></p></div>
  <div class="msg a"><span class="who a">${esc(siteName(state))}</span><span class="txt">${ready ? "Ask me something about the neighborhood! I'll share what I know and point you to neighbors." : "I'm not connected to a model yet, so I can't answer. The sources page shows what I read."}</span></div>
</div>
<div class="composer">
${ready ? `<div class="suggest" id="suggest">${SUGGESTIONS.map((q) => `<button type="button">${esc(q)}</button>`).join("")}</div>` : ""}
<form class="ask" id="ask">
  <textarea id="q" rows="1" placeholder="Ask the neighborhood" aria-label="Your question" enterkeyhint="send" autocomplete="off" autocapitalize="sentences" ${ready ? "" : "disabled"}></textarea>
  <button id="send" type="submit" ${ready ? "" : "disabled"}>Ask</button>
</form>
</div>
<script src="/chat.js" defer></script>`;
  return shell(state, "/", "Ask", body);
}

/** The parts of place.md written for people: voice, what the place cares about, what it doesn't do. */
function placeSections(state: AppState): string {
  const want = ["Voice", "What this place cares about", "What this place does not do"];
  const out: string[] = [];
  for (const m of state.repo.placeMd.matchAll(/^## (.+)\n([\s\S]*?)(?=^## |(?![\s\S]))/gm)) {
    if (want.includes(m[1].trim())) out.push(`### ${m[1].trim()}\n\n${m[2].replace(/^\w+:\s*\S+\s*$/gm, "").trim()}`);
  }
  return out.join("\n\n");
}

export function aboutPage(state: AppState): string {
  const stewards = state.repo.stewardsMd.match(/\|[\s\S]*?\n\n/)?.[0] ?? "";
  const body = `
<p class="stamp">About</p>
<h1>${esc(siteName(state))}</h1>
<p class="sub">${esc((tagline(state) ?? "A neighborhood agent").replace(/^./, (c) => c.toUpperCase()))} for ${esc(placeName(state).replace(/^The /, "the "))}. A personal AI agent gets better the more it knows about you. This one belongs to a place instead, and everything it knows is public and shared.</p>
${aboutLine(state) ? `<p class="note">${esc(aboutLine(state))}</p>` : ""}
<div class="grid">
  <div class="card"><b class="k">It reads</b><p>Public neighborhood information only: sites neighbors already built, public feeds, and the neighborhood's own notes. Everything it reads is on the <a href="/sources">sources page</a>.</p></div>
  <div class="card"><b class="k">It cites</b><p>Every fact comes with where it came from and when. No source, no claim. If it doesn't know, it says so and names who might.</p></div>
  <div class="card"><b class="k">It checks before it adds</b><p>When you ask it to add or fix something, it shows you what it'll send. A neighborhood steward looks it over before it's added. What's added is public.</p></div>
  <div class="card"><b class="k">It keeps nothing</b><p>No accounts, no memory of conversations. The only things that last are what you chose to send, and an anonymous tally of what people ask about.</p></div>
</div>
<h2>Who looks after it</h2>
<p>A small group of neighbors, the stewards. They set how Knowy sounds, what it reads, and what it's been corrected on, and they look over everything neighbors send in.</p>
${md(stewards)}
<p>Want to help? <a href="/contact">Say hello</a>.</p>
<h2>What it holds close</h2>
<p>Knowy's standing instructions, written by the stewards:</p>
<div class="card">${md(placeSections(state))}</div>
<h2>Its neighbors who aren't human</h2>
<p>The ocean, the dunes, the plovers, and the coyotes have standing. Knowy reports their vital signs, brings their interests into answers when a plan touches them, and names their human advocates. It never speaks as them.</p>
<ul>${state.repo.constituents.map((c) => `<li><b>${esc(c.name)}</b>${c.advocates.length ? ` · advocates: ${c.advocates.map((a) => { const m = a.match(/^(.*?),\s*(https?:\/\/\S+)$/); return m ? `<a href="${esc(m[2])}">${esc(m[1])}</a>` : esc(a); }).join("; ")}` : ""}</li>`).join("")}</ul>`;
  return shell(state, "/about", "About", body);
}

const GROUP_ORDER = ["The neighborhood's own notes", "Sites neighbors built", "City open data", "The ocean, air, and wildlife"];

function groupOf(x: SourceStatus): string {
  if (x.group) return x.group;
  if (x.vital_sign) return GROUP_ORDER[3];
  if (x.adapter === "repo" || x.adapter === "recs") return GROUP_ORDER[0];
  if (x.adapter === "socrata" || x.live_query || /^sf-/.test(x.id)) return GROUP_ORDER[2];
  return GROUP_ORDER[1];
}

const when = (iso?: string) => {
  if (!iso) return "";
  const fmt = (d: Date, o: Intl.DateTimeFormatOptions) => new Intl.DateTimeFormat("en-US", { timeZone: "America/Los_Angeles", ...o }).format(d);
  const d = new Date(iso);
  const day = fmt(d, { month: "short", day: "numeric" });
  const time = fmt(d, { hour: "numeric", minute: "2-digit" }).replace(/\s/g, "").toLowerCase();
  return day === fmt(new Date(), { month: "short", day: "numeric" }) ? time : `${day}, ${time}`;
};

type ListedSource = SourceStatus & { reading?: string };

function groupSources(statuses: SourceStatus[], signs: VitalSign[]) {
  const byTitle = new Map<string, ListedSource[]>();
  for (const x of statuses.filter((s) => s.status === "live")) {
    const reading = signs.filter((v) => v.source.name === x.name && !v.error).map((v) => `${v.label.toLowerCase()} ${v.value}`).join(" · ");
    const g = groupOf(x);
    byTitle.set(g, [...(byTitle.get(g) ?? []), { ...x, reading }]);
  }
  const titles = [...GROUP_ORDER.filter((t) => byTitle.has(t)), ...[...byTitle.keys()].filter((t) => !GROUP_ORDER.includes(t))];
  return {
    live: titles.map((title) => ({ title, items: byTitle.get(title)! })),
    planned: statuses.filter((x) => x.status === "planned"),
    excluded: statuses.filter((x) => x.status === "excluded"),
  };
}

function srcItem(x: ListedSource): string {
  let state: string;
  let tone = "s-ok";
  if (x.skipped) { state = "Not connected yet"; tone = "s-wait"; }
  else if (x.error && !x.stale) { state = "Couldn't reach it on the last try"; tone = "s-warn"; }
  else if (x.live_query) state = "Asked live each time";
  else if (x.vital_sign) state = x.reading ? `Now: ${x.reading}` : "Checked through the day";
  else state = `${x.records.toLocaleString("en-US")} ${x.records === 1 ? "record" : "records"}${x.fetched_at ? ` · refreshed ${when(x.fetched_at)}` : ""}${x.stale ? " · last good copy" : ""}`;
  return `<li><div class="srchead"><a href="${esc(x.url)}">${esc(x.name)}</a></div>${x.about ? `<p>${esc(x.about)}</p>` : ""}${x.license ? `<p class="terms">${esc(x.license)}</p>` : ""}<div class="srcstate ${tone}"><span class="dot" aria-hidden="true"></span><span>${esc(state)}</span></div></li>`;
}

export interface SuggestOpts { mode: "email" | "public" | "none"; pending: Array<{ title: string; created_at: string }>; result?: { ok?: string; error?: string } }

const STATUS_WORDS: Record<string, string> = { new: "a steward is looking at it", added: "added", declined: "not added", "in progress": "being brought in" };

export function sourcesPage(state: AppState, signs: VitalSign[], opts: SuggestOpts = { mode: "none", pending: [] }): string {
  const groups = groupSources(state.statuses, signs);
  const decided = state.repo.suggestions.slice().sort((a, b) => String(b.data.suggested ?? "").localeCompare(String(a.data.suggested ?? ""))).slice(0, 12);
  const canSend = opts.mode !== "none";
  const form = canSend ? `<form method="post" action="/suggest" enctype="multipart/form-data" class="card">
  <label for="url">Link</label><input type="text" id="url" name="url" inputmode="url" placeholder="https://" maxlength="500">
  ${opts.mode === "email" ? `<label for="file">Or a file <small>(PDF, doc, spreadsheet, or text, up to 4 MB; only the stewards see it)</small></label><input type="file" id="file" name="file" accept=".pdf,.doc,.docx,.xls,.xlsx,.csv,.tsv,.md,.txt,.rtf,.odt,.ods,.ics">` : ""}
  <label for="what">What is it, and what could Knowy learn from it?</label><textarea class="full" id="what" name="what" rows="3" required maxlength="2000" placeholder="The parents' group's list of daycares, kept up to date by…"></textarea>
  <label for="kept_by">Who keeps it? <small>(optional)</small></label><input type="text" id="kept_by" name="kept_by" maxlength="200">
  <label for="ok_to_share">Is it OK for it to be public?</label>
  <select id="ok_to_share" name="ok_to_share" class="full"><option>Yes, it's already public</option><option>Yes, the people who made it said so</option><option selected>Not sure, please check</option></select>
  <label for="updates">How often does it change? <small>(optional)</small></label>
  <select id="updates" name="updates" class="full"><option value="">Not sure</option><option>It's a one-time list</option><option>Now and then</option><option>Every week</option><option>Every day</option></select>
  <label for="reach">How to reach you <small>(optional, only the stewards see it)</small></label><input type="text" id="reach" name="reach" maxlength="140">
  <input type="text" name="website" style="display:none" tabindex="-1" autocomplete="off" aria-hidden="true">
  <p style="margin:16px 0 0"><button type="submit">Send to the stewards</button></p>
</form>` : `<p>Tell Knowy in the chat, or <a href="/contact">write to the stewards</a>.</p>`;
  const body = `
<p class="stamp">Sources</p>
<h1>What it reads</h1>
<p class="sub">Every source Knowy reads. If it isn't here, Knowy doesn't know it. Last refreshed ${esc(state.lastBuild?.slice(0, 16).replace("T", " ") ?? "never")} UTC; ${state.index.size} records.</p>
<h2 id="suggest">Suggest something Knowy should read</h2>
<p>A doc, a spreadsheet, a site, a calendar, a group's list. A steward looks at each one and decides how Knowy should use it. Nothing is added until then. You can also just tell Knowy in the chat.</p>
${opts.result?.ok ? `<p class="ok"><b>${esc(opts.result.ok)}</b></p>` : ""}${opts.result?.error ? `<p class="err">${esc(opts.result.error)}</p>` : ""}
${form}
${opts.pending.length || decided.length ? `<h2>Suggested by neighbors</h2><ul>${opts.pending.map((p) => `<li>${esc(p.title.replace(/^Source:\s*/, ""))} <small>sent ${esc(p.created_at.slice(0, 10))} · on its way to a steward</small></li>`).join("")}${decided.map((d) => `<li>${esc(String(d.data.title ?? d.file))} <small>${esc(String(d.data.suggested ?? ""))} · ${esc(STATUS_WORDS[String(d.data.status ?? "new")] ?? String(d.data.status))}${d.data.decision ? `: ${esc(String(d.data.decision))}` : ""}</small></li>`).join("")}</ul>` : ""}
<h2>Everything it reads now</h2>
${groups.live.map((g) => `<div class="srcgroup"><h3>${esc(g.title)}</h3><ul class="srclist">${g.items.map(srcItem).join("")}</ul></div>`).join("")}
${groups.planned.length ? `<div class="srcgroup quietgroup"><h3>Coming next</h3><ul class="srclist compact">${groups.planned.map((x) => `<li><div class="srchead">${x.url ? `<a href="${esc(x.url)}">${esc(x.name)}</a>` : esc(x.name)}</div>${x.about ? `<p>${esc(x.about)}</p>` : ""}${x.note ? `<p class="terms notyet">${esc(x.note)}</p>` : ""}</li>`).join("")}</ul></div>` : ""}
${groups.excluded.length ? `<div class="srcgroup quietgroup"><h3>Left out on purpose</h3><ul class="srclist compact">${groups.excluded.map((x) => `<li><div class="srchead">${x.url ? `<a href="${esc(x.url)}">${esc(x.name)}</a>` : esc(x.name)}</div>${x.license ? `<p>${esc(x.license)}</p>` : ""}</li>`).join("")}</ul></div>` : ""}
<h2>Who it speaks for, and who speaks for them</h2>
<ul class="srclist">${state.repo.constituents.map((c) => `<li><div class="srchead">${esc(c.name)}</div><p>Advocates: ${c.advocates.map((a) => { const m = a.match(/^(.*?),\s*(https?:\/\/\S+)$/); return m ? `<a href="${esc(m[2])}">${esc(m[1])}</a>` : esc(a); }).join(" · ") || "none listed yet"}</p></li>`).join("")}</ul>
<p class="note">How Knowy treats every source: it follows each site's rules for automated visitors, checks in on a schedule rather than every time someone asks, keeps a copy of what it saw so stewards can check its work, and lets neighbors' corrections win over what a source says.</p>`;
  return shell(state, "/sources", "Sources", body);
}

type Pending = { title: string; created_at: string };
const pendingList = (items: Pending[], prefix: RegExp) => `<ul>${items.map((p) => `<li>${esc(p.title.replace(prefix, ""))} <small>sent ${esc(p.created_at.slice(0, 10))}</small></li>`).join("")}</ul>`;

export function proposalsPage(state: AppState, pending: Pending[]): string {
  const added = state.repo.proposals.map((p) => `<div class="card"><b class="k">${esc(String(p.data.status ?? "open"))} · started ${esc(String(p.data.opened ?? ""))} by ${esc(String(p.data.proposer ?? "a neighbor"))}</b><h3 style="margin-top:0">${esc(String(p.data.title ?? p.file))}</h3>${md(p.body)}</div>`).join("");
  const body = `
<p class="stamp">Proposals</p>
<h1>What neighbors have asked for</h1>
<p class="sub">A proposal is a public note that someone wants this, so the next person who asks can find them. It isn't a commitment. To start one, tell Knowy what you wish the neighborhood had.</p>
${pending.length ? `<h2>On its way</h2><p>Sent by neighbors, waiting for a steward to look over:</p>${pendingList(pending, /^Proposal:\s*/)}` : ""}
<h2>Open proposals</h2>
${added || "<p>None yet. Yours could be the first.</p>"}`;
  return shell(state, "/proposals", "Proposals", body);
}

export function correctPage(state: AppState, pending: Pending[]): string {
  const body = `
<p class="stamp">Corrections</p>
<h1>When Knowy gets it wrong</h1>
<p class="sub">It will, sometimes. Hours change, places close, a feed lags. Tell it, and once a steward has looked it over, your correction wins over anything Knowy read elsewhere. It'll say "a neighbor corrected this" when it uses one.</p>
<div class="card"><b class="k">How</b><p>In the chat, say "that's wrong" or "they close at 6 now". Knowy shows what it had and where it came from, asks what's right and how you know, and shows you what it'll send. Tap "Yes, send it" and a steward takes it from there. Or <a href="/contact">write to the stewards</a>.</p></div>
${pending.length ? `<h2>On their way</h2>${pendingList(pending, /^Correction:\s*/)}` : ""}
<h2>Corrections so far</h2>
${state.repo.corrections.length ? `<table class="stack"><tr><th>Date</th><th>What</th><th>Now</th><th>How known</th></tr>${state.repo.corrections.map((c) => `<tr><td>${esc(c.date)}</td><td>${esc(c.target)} (${esc(c.field)})</td><td>${esc(c.now)}</td><td>${esc(c.how_known ?? "")}</td></tr>`).join("")}</table>` : "<p>None yet.</p>"}`;
  return shell(state, "/correct", "Correct", body);
}

export function contactPage(state: AppState, mode: "email" | "public" | "none", result?: { ok?: string; error?: string }): string {
  const stewardEmails = [...state.repo.stewardsMd.matchAll(/[\w.+-]+@[\w-]+\.[\w.-]+/g)].map((m) => m[0]);
  const where = mode === "email" ? "It goes straight to the stewards' inbox. Only they see it." : mode === "public" ? "It's posted as a public note the stewards see, so don't put anything here you wouldn't pin to a pole." : "";
  const body = `
<p class="stamp">Contact</p>
<h1>Write to the stewards</h1>
<p class="sub">A note for the neighbors who look after Knowy: an idea, a problem, a wish, or to help out. No account needed. ${where}</p>
${result?.ok ? `<p class="ok">Sent. ${esc(result.ok)}</p>` : ""}${result?.error ? `<p class="err">${esc(result.error)}</p>` : ""}
${mode === "none" ? `<p>${stewardEmails.length ? `Email ${stewardEmails.map((e) => `<a href="mailto:${esc(e)}">${esc(e)}</a>`).join(", ")}.` : "The stewards haven't set up a way to write in yet."}</p>` : `<form method="post" action="/contact">
  <label for="subject">Subject</label><input type="text" id="subject" name="subject" required maxlength="140">
  <label for="message">Message</label><textarea class="full" id="message" name="message" rows="6" required maxlength="4000"></textarea>
  <label for="reach">How to reach you (optional${mode === "email" ? ", only the stewards see it" : ", will be public"})</label><input type="text" id="reach" name="reach" maxlength="140">
  <label for="hp" style="display:none">Leave empty</label><input type="text" id="hp" name="website" style="display:none" tabindex="-1" autocomplete="off">
  <p style="margin-top:14px"><button type="submit">Send to the stewards</button></p>
</form>`}`;
  return shell(state, "/contact", "Contact", body);
}

export interface QueueItem { number: number; title: string; url: string; labels: string[]; created_at: string; body: string }
export interface StewardStatus { github: boolean; githubDetail?: string; email: boolean; emailTo: string[]; model?: string; spent: number; limit: number; sha?: string; built?: string; loadErrors: string[]; log: Record<string, { asked: number; referral: number; dont_know: number }>; week: string }

/** The stewards' desk: what's waiting, whether the plumbing works, what people asked this week. */
export function stewardsPage(state: AppState, queue: QueueItem[], queueError: string | undefined, st: StewardStatus): string {
  const ok = (b: boolean) => (b ? '<span class="tag">on</span>' : '<span class="tag" style="background:#f6d9d4;color:#8a2c1f">off</span>');
  const askOf = (body: string) => (body.match(/\n> ([\s\S]*?)\n\n/)?.[1] ?? "").replace(/\n> /g, " ").slice(0, 220);
  const repo = state.github.repoUrl;
  const rows = Object.entries(st.log).sort((a, b) => b[1].asked - a[1].asked);
  const body = `
<p class="stamp">For stewards</p>
<h1>The stewards' desk</h1>
<p class="sub">What neighbors have sent, and whether Knowy's plumbing is working. Neighbors never see pull requests; this is where they land.</p>
${st.loadErrors.length ? `<p class="note err">The data repo's latest commit didn't parse, so Knowy is still serving the version before it. Fix: ${esc(st.loadErrors.join("; "))}</p>` : ""}
<h2>Waiting for you</h2>
${queueError ? `<p class="err">Couldn't read the queue: ${esc(queueError)}. <a href="${esc(repo)}/pulls">Open pull requests on GitHub</a>.</p>` : queue.length ? `<ul>${queue.map((q) => `<li><b>${esc(q.title)}</b> <small>${esc(q.created_at.slice(0, 10))}${q.labels.length ? ` · ${esc(q.labels.join(", "))}` : ""}</small>${askOf(q.body) ? `<br><small>“${esc(askOf(q.body))}”</small>` : ""}<br><a href="${esc(q.url)}">Review on GitHub</a></li>`).join("")}</ul>` : `<p>Nothing waiting.${st.github ? "" : " Until the GitHub App is connected, submissions arrive by email instead of here."}</p>`}
${state.statuses.some((x) => x.error || x.skipped) ? `<h2>Sources needing attention</h2><ul>${state.statuses.filter((x) => x.error || x.skipped).map((x) => `<li><b>${esc(x.name)}</b> (${esc(x.id)}): ${esc(x.skipped ? `skipped, ${x.skipped}` : `${x.error}${x.stale ? " (serving the last good copy)" : ""}`)}</li>`).join("")}</ul>` : ""}
<h2>Plumbing</h2>
<table class="stack">
<tr><td>GitHub App (turns submissions into pull requests)${st.githubDetail ? `<br><small>${esc(st.githubDetail)}</small>` : ""}</td><td>${ok(st.github)}</td></tr>
<tr><td>Email to stewards${st.emailTo.length ? ` (${esc(st.emailTo.join(", "))})` : ""}</td><td>${ok(st.email)}</td></tr>
<tr><td>Model</td><td>${esc(st.model ?? "not configured")}</td></tr>
<tr><td>Today's budget</td><td>$${st.spent.toFixed(2)} of $${st.limit.toFixed(2)}</td></tr>
<tr><td>Data repo</td><td><a href="${esc(repo)}">${esc((st.sha ?? "").slice(0, 7) || "local")}</a>, refreshed ${esc(st.built?.slice(0, 16).replace("T", " ") ?? "never")} UTC</td></tr>
</table>
${!st.github || !st.email ? `<p class="note">${!st.email ? "Turn on email: set RESEND_API_KEY in Vercel. Mail goes from knowy@relationaltechproject.org (change with EMAIL_FROM) to the addresses in STEWARDS.md (or STEWARD_EMAILS). " : ""}${!st.github ? "Connect GitHub: create a GitHub App with Contents, Pull requests, and Issues read/write, install it on the data repo, and set GITHUB_APP_ID and GITHUB_APP_PRIVATE_KEY." : ""}</p>` : ""}
<h2>What people asked this week</h2>
${rows.length ? `<table class="stack"><tr><th>Topic</th><th>Asked</th><th>Pointed to a person or group</th><th>Didn't know</th></tr>${rows.map(([t, r]) => `<tr><td>${esc(t)}</td><td>${r.asked}</td><td>${r.referral}</td><td>${r.dont_know}</td></tr>`).join("")}</table><p><small>${esc(st.week)}, counted by this server since it last started. Weekly totals go to log/questions.md.</small></p>` : "<p>No questions counted yet this week on this server.</p>"}
<h2>Bringing in a suggested source</h2>
<p>Each suggestion arrives with a note on its kind and the right way in: a doc becomes a recs/ file or an archive note, a live spreadsheet a csv source, a calendar an ics source, a blog an rss source, a site a resources.yml entry. When it's in, or decided against, set <code>status: added</code> or <code>declined</code> (with <code>decision:</code> a line on why) in its suggestions/ file; neighbors see that on the sources page. Uploaded files only ever arrive by email.</p>
<h2>How stewarding works</h2>
<p><a href="${esc(repo)}/blob/main/STEWARDS.md">STEWARDS.md</a> has the review checklist and how decisions get made. Everything Knowy knows is plain files in <a href="${esc(repo)}">the data repo</a>; edit them on GitHub and Knowy picks up the change within a few minutes.</p>`;
  return shell(state, "/stewards", "Stewards", body, '<meta name="robots" content="noindex">');
}
