/**
 * Server-rendered pages. The look: a typed notice on a corkboard, neighborhood-scale, no AI
 * iconography. Mobile first; most neighbors open this from a chat link.
 */
export const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Shell { title: string; siteName: string; tagline?: string; placeName?: string; repoUrl: string; path: string; body: string; head?: string }

const NAV: Array<[string, string]> = [["/", "Ask"], ["/about", "About"], ["/sources", "Sources"], ["/proposals", "Proposals"], ["/correct", "Correct"], ["/contact", "Contact"]];

export function layout(s: Shell): string {
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#f4efe4">
<meta name="format-detection" content="telephone=no">
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(s.siteName)}${s.tagline ? `, ${esc(s.tagline.toLowerCase())}` : ""} for ${esc((s.placeName ?? "this neighborhood").replace(/^The /, "the "))}. Answers with sources, points to people, and turns asks into public proposals.">
<meta property="og:title" content="${esc(s.siteName)}${s.tagline ? ` · ${esc(s.tagline)}` : ""}">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='4' fill='%23f4efe4'/><circle cx='16' cy='16' r='7' fill='%23d9622b'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&family=Special+Elite&display=swap" rel="stylesheet">
<style>
:root{--paper:#f4efe4;--ink:#2a2622;--quiet:#6b645b;--rule:#d9d0bf;--orange:#d9622b;--sea:#2f6f8f;--sand:#e8dcc2;--card:#fbf8f1;--white:#fff}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;line-height:1.55;font-size:16px;background-image:radial-gradient(rgba(42,38,34,.045) 1px,transparent 1px);background-size:14px 14px}
a{color:var(--sea)}
main{max-width:720px;margin:0 auto;padding:20px 16px 72px}
header.top{max-width:720px;margin:0 auto;padding:18px 16px 0;display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 18px}
header.top .tagline{white-space:nowrap;font-family:"Special Elite",monospace;font-size:11.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--orange)}
header.top .name{white-space:nowrap;font-family:"Caveat",cursive;font-size:30px;font-weight:600;text-decoration:none;color:var(--ink);line-height:1}
header.top nav{display:flex;flex-wrap:wrap;gap:4px 14px;font-family:"Special Elite",monospace;font-size:12px;letter-spacing:.06em;text-transform:uppercase}
header.top nav a{color:var(--quiet);text-decoration:none;padding:2px 0;border-bottom:2px solid transparent}
header.top nav a.on{color:var(--orange);border-color:var(--orange)}
.stamp{font-family:"Special Elite",monospace;font-size:12px;letter-spacing:.08em;text-transform:uppercase;color:var(--orange);margin:0 0 6px}
h1{font-family:"Caveat",cursive;font-size:44px;line-height:1;margin:0 0 8px;font-weight:600}
h2{font-family:"Caveat",cursive;font-size:30px;margin:34px 0 8px;font-weight:600}
h3{font-size:17px;margin:22px 0 6px}
p{margin:0 0 12px}
.sub{font-size:17px;color:var(--quiet);margin:0 0 24px;max-width:600px}
.note{border-left:3px solid var(--orange);padding:4px 0 4px 14px;color:var(--quiet);font-style:italic;margin:14px 0}
.card{border:1px solid var(--rule);border-radius:10px;padding:14px 16px;background:var(--card);margin:0 0 12px}
.card b.k{display:block;font-family:"Special Elite",monospace;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--quiet);margin-bottom:6px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
@media (max-width:560px){.grid{grid-template-columns:1fr}h1{font-size:38px}table{display:block;overflow-x:auto;max-width:100%}}
td,li,p,small,.vitals span,.txt{overflow-wrap:anywhere}
main{overflow-x:hidden}
@media (max-width:560px){table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}table.stack th{display:none}table.stack td{padding:2px 0;border:0}table.stack tr{border-bottom:1px solid var(--rule);padding:8px 0}}
table{border-collapse:collapse;width:100%;font-size:14.5px;margin:8px 0 16px}
th,td{text-align:left;vertical-align:top;padding:7px 8px;border-bottom:1px solid var(--rule)}
th{font-family:"Special Elite",monospace;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--quiet);font-weight:normal}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px}
pre{background:var(--white);border:1px solid var(--rule);border-radius:8px;padding:12px;overflow:auto;white-space:pre-wrap}
footer{max-width:720px;margin:0 auto;padding:18px 16px 40px;border-top:1px dashed var(--rule);font-size:13.5px;color:var(--quiet);line-height:1.5}
footer p{margin:0 0 10px}
footer a{color:var(--quiet)}
footer .links{font-family:"Special Elite",monospace;font-size:12px;letter-spacing:.05em;text-transform:uppercase}
footer .fine{font-family:"Special Elite",monospace;font-size:11.5px;letter-spacing:.04em}
body.home main{display:flex;flex-direction:column;min-height:calc(100dvh - 70px);padding-top:12px;padding-bottom:20px}
body.home .chat{flex:1;overflow-y:auto;min-height:240px;max-height:none;margin-bottom:10px}
body.home footer{margin-top:24px}
.vline{display:flex;gap:6px 16px;flex-wrap:wrap;font-size:13px;color:var(--quiet);margin:0 0 10px}
.vline b{color:var(--ink);font-weight:600}
.vline a{color:var(--quiet);text-decoration:none}
.suggest{display:flex;flex-wrap:wrap;gap:6px;margin:0 0 10px}
.suggest button{font-family:"IBM Plex Sans",system-ui,sans-serif;font-size:14px;letter-spacing:0;text-transform:none;background:var(--card);color:var(--ink);border:1px solid var(--rule);border-radius:999px;padding:6px 12px}
.suggest button:hover{border-color:var(--orange)}
hr{border:0;border-top:1px dashed var(--rule);margin:30px 0}
.vitals{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:13.5px;color:var(--quiet);margin:0 0 18px;padding:10px 12px;background:var(--white);border:1px solid var(--rule);border-radius:10px}
.vitals span b{color:var(--ink);font-weight:600}
.vitals a{color:var(--quiet);text-decoration:none;border-bottom:1px dotted var(--rule)}
.chat{background:var(--white);border:1px solid var(--rule);border-radius:10px;padding:12px 14px;margin:0 0 12px;min-height:120px}
.msg{display:flex;gap:10px;margin:0 0 10px;align-items:flex-start}
.who{font-family:"Special Elite",monospace;font-size:11px;letter-spacing:.06em;text-transform:uppercase;min-width:64px;padding-top:5px}
.who.n{color:var(--sea)}.who.a{color:var(--orange)}
.txt{background:var(--paper);padding:8px 12px;border-radius:8px;font-size:15.5px;white-space:pre-wrap;word-break:break-word;flex:1}
.msg.a .txt{background:var(--sand)}
.txt pre{white-space:pre-wrap;margin:8px 0}
.txt a{word-break:normal;overflow-wrap:anywhere}
.tool{font-family:"Special Elite",monospace;font-size:11px;color:var(--quiet);margin:-4px 0 8px 74px}
form.ask{display:flex;gap:8px;align-items:flex-end}
form.ask textarea{flex:1;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--white);resize:vertical;min-height:46px;max-height:200px}
button,.btn{font-family:"Special Elite",monospace;font-size:13px;letter-spacing:.06em;text-transform:uppercase;background:var(--orange);color:#fff;border:0;border-radius:8px;padding:12px 16px;cursor:pointer;text-decoration:none;display:inline-block}
button[disabled]{opacity:.5;cursor:default}
button.ghost{background:transparent;color:var(--quiet);border:1px solid var(--rule)}
.draft{border:2px dashed var(--orange);border-radius:10px;padding:12px 14px;margin:8px 0 12px;background:var(--card)}
.draft .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:8px}
.standing{font-size:13.5px;color:var(--quiet);margin:10px 0 0}
label{display:block;font-family:"Special Elite",monospace;font-size:11.5px;letter-spacing:.06em;text-transform:uppercase;color:var(--quiet);margin:12px 0 4px}
input[type=text],input[type=email],textarea.full{width:100%;font:inherit;font-size:16px;padding:10px 12px;border:1px solid var(--rule);border-radius:8px;background:var(--white)}
.ok{color:#2f6f3a}.err{color:#a33}
ul{padding-left:20px}li{margin:0 0 6px}
.tag{font-family:"Special Elite",monospace;font-size:11px;letter-spacing:.05em;text-transform:uppercase;border:1px solid var(--rule);border-radius:999px;padding:1px 8px;color:var(--quiet)}
/* ---- home: an app-shaped chat. Header, scrolling log, composer pinned at the bottom. ---- */
body.home{overscroll-behavior-y:none}
body.home header.top{height:52px;padding-top:12px;padding-bottom:0;align-items:center;flex-wrap:nowrap;gap:12px}
body.home header.top .name{font-size:28px}
body.home main{height:calc(100dvh - 52px);min-height:0;display:flex;flex-direction:column;padding:6px 16px 0;overflow:hidden}
body.home .vline,body.home .suggest,body.home header.top{flex:0 0 auto}
body.home .chat{position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;margin:0 0 8px;scroll-padding-bottom:12px}
body.home .composer{flex:0 0 auto;padding-bottom:max(12px,env(safe-area-inset-bottom))}
body.home footer{margin-top:0}
.vline,.suggest{scrollbar-width:none}
.vline::-webkit-scrollbar,.suggest::-webkit-scrollbar{display:none}
form.ask textarea{line-height:1.4;max-height:132px;overflow-y:auto;resize:none}
form.ask button,.draft .actions button{min-height:46px;min-width:64px}
.suggest button{min-height:40px;touch-action:manipulation}
button,a,textarea{-webkit-tap-highlight-color:rgba(217,98,43,.15)}
@media (max-width:360px){header.top .tagline{display:none}}
@media (max-width:640px){
  body{font-size:16px}
  .vline{flex-wrap:nowrap;overflow-x:auto;white-space:nowrap;margin:0 -16px 8px;padding:0 16px;mask-image:linear-gradient(90deg,#000 88%,transparent)}
  .suggest{flex-wrap:nowrap;overflow-x:auto;white-space:nowrap;margin:0 -16px 8px;padding:0 16px}
  .suggest button{flex:0 0 auto}
  .chat{padding:10px}
  .msg{display:block;margin:0 0 10px}
  .msg .who{display:none}
  .msg .txt{display:block;max-width:100%}
  .msg.n{display:flex;justify-content:flex-end}
  .msg.n .txt{max-width:85%;background:var(--sea);color:#fff}
  .msg.n .txt a{color:#fff}
  .tool{margin:-4px 0 8px 2px}
  .draft{padding:10px 12px}
  .draft .actions{display:grid;grid-template-columns:1.4fr 1fr}
  .draft .actions button{font-size:12px;letter-spacing:.03em;padding:0 10px;white-space:nowrap}
  form.ask{gap:6px}
  form.ask textarea{padding:11px 12px;border-radius:22px;min-height:46px}
  form.ask button{border-radius:22px;padding:0 16px}
  footer{padding-bottom:max(40px,env(safe-area-inset-bottom))}
}
</style>
${s.head ?? ""}
</head>
<body${s.path === "/" ? ' class="home"' : ""}>
<header class="top">
  <a class="name" href="/">${esc(s.siteName)}</a>${s.tagline ? `<span class="tagline">${esc(s.tagline)}</span>` : ""}
  ${s.path === "/" ? "" : `<nav>${NAV.map(([href, label]) => `<a href="${href}"${href === s.path ? ' class="on"' : ""}>${label}</a>`).join("")}</nav>`}
</header>
<main>
${s.body}
</main>
<footer>
  <p>${esc(s.siteName)} works for ${esc((s.placeName ?? "this neighborhood").replace(/^The /, "the "))}, not any one person. It answers from public neighborhood data, cites every source, and says "I don't know" when it doesn't. If you ask it to add or fix something, it drafts a public pull request and the neighborhood's stewards review it. Nothing you type is kept; the conversation lives only in your browser tab.</p>
  <p class="links">${NAV.filter(([href]) => href !== "/").map(([href, label]) => `<a href="${href}">${label}</a>`).join(" · ")} · <a href="${esc(s.repoUrl)}">The repo</a></p>
  <p class="fine">Data CC BY 4.0 · <a href="https://github.com/The-Relational-Technology-Project/neighborhood-agent">code, MIT</a> · <a href="https://relationaltechproject.org">Relational Tech Project</a></p>
</footer>
</body>
</html>`;
}

/** Tiny markdown: paragraphs, headings, bullets, links, code, bold. Enough for repo files. */
export function md(text: string): string {
  const lines = text.replace(/\r\n/g, "\n").split("\n");
  const out: string[] = [];
  let para: string[] = [];
  let list: string[] = [];
  let code: string[] | null = null;
  const inline = (s: string) =>
    esc(s)
      .replace(/`([^`]+)`/g, "<code>$1</code>")
      .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
      .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>')
      .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
  const flush = () => {
    if (para.length) { out.push(`<p>${inline(para.join(" "))}</p>`); para = []; }
    if (list.length) { out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`); list = []; }
  };
  for (const raw of lines) {
    if (code) { if (raw.startsWith("```")) { out.push(`<pre>${esc(code.join("\n"))}</pre>`); code = null; } else code.push(raw); continue; }
    const line = raw.trimEnd();
    if (line.startsWith("```")) { flush(); code = []; continue; }
    const h = line.match(/^(#{1,3})\s+(.+)$/);
    if (h) { flush(); const lvl = Math.min(3, h[1].length + 1); out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`); continue; }
    if (/^\s*[-*]\s+/.test(line)) { if (para.length) flush(); list.push(line.replace(/^\s*[-*]\s+/, "")); continue; }
    if (line.startsWith("|")) { flush(); out.push(tableRow(line)); continue; }
    if (!line.trim()) { flush(); continue; }
    if (list.length) flush();
    para.push(line);
  }
  flush();
  return out.join("\n").replace(/(<tr>.*?<\/tr>\n?)+/gs, (m) => `<table>${m}</table>`);
}

function tableRow(line: string): string {
  const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
  if (cells.every((c) => /^:?-+:?$/.test(c))) return "";
  return `<tr>${cells.map((c) => `<td>${esc(c).replace(/`([^`]+)`/g, "<code>$1</code>")}</td>`).join("")}</tr>\n`;
}
