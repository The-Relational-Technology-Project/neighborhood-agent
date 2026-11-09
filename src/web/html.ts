/**
 * Server-rendered pages. The look comes from Knowy's logo: cream paper, warm charcoal ink, amber
 * from the signal lines, sky from the wave, sand and plover browns; Fredoka for display, Nunito
 * for reading. Mobile first; most neighbors open this from a chat link.
 */
export const esc = (s: unknown): string =>
  String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");

export interface Shell { title: string; siteName: string; tagline?: string; placeName?: string; siteUrl?: string; brand?: Set<string>; repoUrl: string; path: string; body: string; head?: string }

const NAV: Array<[string, string]> = [["/", "Ask"], ["/about", "About"], ["/sources", "Sources"], ["/proposals", "Proposals"], ["/correct", "Correct"], ["/contact", "Contact"]];

export function layout(s: Shell): string {
  const place = (s.placeName ?? "this neighborhood").replace(/^The /, "the ");
  const site = (s.siteUrl ?? "https://knowy.org").replace(/\/$/, "");
  const has = (f: string) => Boolean(s.brand?.has(f));
  const description = `${s.siteName}${s.tagline ? `, ${s.tagline.toLowerCase()}` : ""} for ${place}. Answers with sources, points to people, and turns asks into public proposals.`;
  return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover, interactive-widget=resizes-content">
<meta name="theme-color" content="#fdf8ec">
<meta name="format-detection" content="telephone=no">
<title>${esc(s.title)}</title>
<meta name="description" content="${esc(description)}">
<meta property="og:title" content="${esc(s.siteName)}${s.tagline ? ` · ${esc(s.tagline)}` : ""}">
<meta property="og:description" content="${esc(description)}">
${has("og.jpg") ? `<meta property="og:image" content="${esc(site)}/og.jpg">
<meta property="og:image:width" content="1200"><meta property="og:image:height" content="630">` : ""}
<meta property="og:url" content="${esc(site)}${esc(s.path)}">
<meta name="twitter:card" content="summary_large_image">
${has("favicon.png") ? '<link rel="icon" href="/favicon.png" type="image/png">' : ""}
${has("apple-touch-icon.png") ? '<link rel="apple-touch-icon" href="/apple-touch-icon.png">' : ""}
<link rel="manifest" href="/manifest.webmanifest">
${s.path === "/" && has("logo.webp") ? '<link rel="preload" href="/brand/logo.webp" as="image" type="image/webp">' : ""}
<link rel="preconnect" href="https://fonts.googleapis.com">
<link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>
<link href="https://fonts.googleapis.com/css2?family=Fredoka:wght@500;600&family=Nunito:ital,wght@0,400;0,600;0,700;1,400&display=swap" rel="stylesheet">
<style>
:root{
  --paper:#fdf8ec;--card:#fffdf7;--ink:#322e2b;--quiet:#76624f;--rule:#eedfc7;
  --amber:#e79d1b;--amber-soft:#fcebc7;--amber-ink:#8a5400;--sun:#fec627;
  --sky:#8fb6c7;--sky-soft:#dcebf1;--sky-ink:#2f6a82;
  --sand:#f8e6c8;--brown:#cdad8d;--grass:#bfa87b;
  --display:"Fredoka","Nunito",ui-rounded,system-ui,sans-serif;
  --body:"Nunito",ui-rounded,system-ui,-apple-system,sans-serif;
}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:var(--body);line-height:1.6;font-size:16.5px}
a{color:var(--sky-ink);text-underline-offset:2px}
img{max-width:100%;height:auto}
main{max-width:720px;margin:0 auto;padding:20px 20px 72px;overflow-x:hidden}
header.top{max-width:720px;margin:0 auto;padding:16px 20px 0;display:flex;flex-wrap:wrap;align-items:center;gap:10px 18px}
header.top .brand{display:flex;align-items:center;gap:8px;text-decoration:none;color:var(--ink)}
header.top .brand img{width:46px;height:auto}
header.top .name{font-family:var(--display);font-weight:600;font-size:24px;line-height:1;white-space:nowrap}
header.top nav{display:flex;flex-wrap:wrap;gap:6px;font-family:var(--display);font-weight:500;font-size:15px}
header.top nav a{color:var(--quiet);text-decoration:none;padding:6px 12px;border-radius:999px}
header.top nav a:hover{background:var(--amber-soft);color:var(--ink)}
header.top nav a.on{background:var(--amber-soft);color:var(--ink)}
.stamp{font-family:var(--display);font-weight:600;font-size:13px;letter-spacing:.06em;text-transform:uppercase;color:var(--amber-ink);margin:0 0 6px}
h1{font-family:var(--display);font-weight:600;font-size:38px;line-height:1.1;margin:0 0 10px}
h2{font-family:var(--display);font-weight:600;font-size:26px;line-height:1.2;margin:36px 0 10px}
h3{font-family:var(--display);font-weight:600;font-size:19px;margin:22px 0 6px}
p{margin:0 0 12px}
.sub{font-size:18px;color:var(--quiet);margin:0 0 24px;max-width:600px}
.note{border-left:4px solid var(--amber);background:var(--card);border-radius:0 12px 12px 0;padding:12px 16px;color:var(--quiet);margin:16px 0}
.card{border:1.5px solid var(--rule);border-radius:16px;padding:16px 18px;background:var(--card);margin:0 0 12px}
.card b.k{display:block;font-family:var(--display);font-weight:600;font-size:13px;letter-spacing:.05em;text-transform:uppercase;color:var(--amber-ink);margin-bottom:6px}
.grid{display:grid;grid-template-columns:1fr 1fr;gap:12px;margin:12px 0}
td,li,p,small,.txt{overflow-wrap:anywhere}
table{border-collapse:collapse;width:100%;font-size:15px;margin:8px 0 16px}
th,td{text-align:left;vertical-align:top;padding:8px 8px;border-bottom:1.5px solid var(--rule)}
th{font-family:var(--display);font-weight:600;font-size:13px;letter-spacing:.04em;text-transform:uppercase;color:var(--quiet)}
code,pre{font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:13.5px}
pre{background:var(--card);border:1.5px solid var(--rule);border-radius:12px;padding:12px;overflow:auto;white-space:pre-wrap}
hr{border:0;border-top:2px dashed var(--rule);margin:30px 0}
ul{padding-left:20px}li{margin:0 0 6px}
.tag{font-family:var(--display);font-weight:500;font-size:12.5px;border-radius:999px;padding:2px 10px;background:var(--amber-soft);color:var(--amber-ink);white-space:nowrap}
.srcgroup{margin:28px 0 0}
.srcgroup h3{font-size:18px;margin:0 0 12px}
.srclist{list-style:none;padding:0;margin:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(min(100%,300px),1fr));gap:12px}
.srclist li{margin:0;background:var(--card);border:1.5px solid var(--rule);border-radius:16px;padding:14px 16px;display:flex;flex-direction:column;gap:6px;min-width:0}
.srclist li p{margin:0;font-size:14.5px;line-height:1.5;color:var(--quiet)}
.srchead{font-family:var(--display);font-weight:600;font-size:17px;line-height:1.3}
.srchead a{color:var(--ink);text-decoration-color:var(--brown)}
.srcstate{margin-top:auto;padding-top:6px;font-size:13.5px;font-weight:700;color:var(--ink);display:flex;gap:8px;align-items:baseline}
.srcstate .dot{flex:0 0 auto;width:8px;height:8px;border-radius:50%;background:#4f9a5c;transform:translateY(-1px)}
.srcstate.s-wait{color:var(--quiet)}
.srcstate.s-wait .dot{background:var(--brown)}
.srcstate.s-warn .dot{background:#c0563f}
.srclist li p.terms{font-size:13px;line-height:1.45;opacity:.85}
.srclist li p.terms::before{content:"Terms · ";font-weight:700}
.srclist li p.terms.notyet::before{content:"Not yet · "}
.quietgroup .srclist li{background:transparent;border-style:dashed}
.srclist.compact li{padding:12px 14px}
.ok{color:#2f6f3a}.err{color:#a3362a}
.vitals{display:flex;flex-wrap:wrap;gap:6px 14px;font-size:14px;color:var(--quiet);margin:0 0 18px;padding:12px 14px;background:var(--card);border:1.5px solid var(--rule);border-radius:16px}
.vitals span b{color:var(--ink);font-weight:700}
.vitals a{color:var(--quiet);text-decoration:none;border-bottom:1px dotted var(--brown)}
button,.btn{font-family:var(--display);font-weight:600;font-size:16px;background:var(--amber);color:var(--ink);border:0;border-radius:999px;padding:12px 20px;cursor:pointer;text-decoration:none;display:inline-block;transition:transform .08s ease,background .15s ease}
button:hover{background:#efab2c}
button:active{transform:scale(.97)}
button[disabled]{opacity:.5;cursor:default;transform:none}
button.ghost{background:var(--card);color:var(--quiet);border:1.5px solid var(--rule)}
label{display:block;font-family:var(--display);font-weight:600;font-size:14px;color:var(--quiet);margin:14px 0 6px}
select.full{width:100%;font:inherit;font-size:16px;padding:12px 14px;border:1.5px solid var(--rule);border-radius:14px;background:var(--card);color:var(--ink)}
input[type=file]{font:inherit;font-size:15px;max-width:100%}
form.card label:first-child{margin-top:0}
input[type=text],input[type=email],textarea.full{width:100%;font:inherit;font-size:16px;padding:12px 14px;border:1.5px solid var(--rule);border-radius:14px;background:var(--card);color:var(--ink)}
input:focus,textarea:focus{outline:none;border-color:var(--amber);box-shadow:0 0 0 3px var(--amber-soft)}
button,a,textarea{-webkit-tap-highlight-color:rgba(231,157,27,.18)}

/* ---- the chat ---- */
.chat{background:var(--card);border:1.5px solid var(--rule);border-radius:20px;padding:14px;margin:0 0 12px;min-height:120px}
.hero{text-align:center;padding:4px 0 10px}
.hero img{display:block;width:min(62vw,250px);height:auto;margin:0 auto}
.hero .tagline{font-family:var(--display);font-weight:500;font-size:18px;color:var(--quiet);margin:2px 0 10px}
.vline{display:flex;flex-wrap:wrap;justify-content:center;gap:4px 14px;font-size:13.5px;color:var(--quiet);margin:0 auto 4px;max-width:520px}
.vline b{color:var(--ink);font-weight:700}
.vline a{color:var(--quiet);text-decoration:none}
.promise{font-size:13.5px;line-height:1.5;color:var(--quiet);margin:10px auto 2px;max-width:620px;text-wrap:balance}
.promise a{color:var(--quiet);text-decoration-color:var(--brown);white-space:nowrap}
.msg{display:flex;margin:0 0 12px}
.msg .who{display:none}
.msg.a{justify-content:flex-start}
.msg.n{justify-content:flex-end}
.txt{display:block;padding:10px 14px;border-radius:20px;font-size:16px;line-height:1.55;white-space:pre-wrap;word-break:break-word;max-width:90%}
.msg.a .txt{background:var(--sand);border-bottom-left-radius:6px}
.msg.n .txt{background:var(--sky-soft);border-bottom-right-radius:6px;max-width:82%}
.txt b{font-weight:700}
.txt pre{white-space:pre-wrap;margin:8px 0;background:var(--card)}
.txt a{color:var(--sky-ink);word-break:normal;overflow-wrap:anywhere}
.tool{font-size:13px;font-style:italic;color:var(--quiet);margin:-4px 0 10px 6px}
.suggest{display:flex;flex-wrap:wrap;gap:8px;margin:0 0 10px;scrollbar-width:none}
.suggest::-webkit-scrollbar{display:none}
.suggest button{font-family:var(--body);font-weight:700;font-size:14.5px;background:var(--card);color:var(--ink);border:1.5px solid var(--rule);padding:8px 14px;min-height:42px;touch-action:manipulation}
.suggest button:hover{border-color:var(--amber);background:var(--amber-soft)}
form.ask{display:flex;gap:8px;align-items:flex-end}
form.ask textarea{flex:1;font:inherit;font-size:16px;line-height:1.4;padding:12px 16px;border:1.5px solid var(--rule);border-radius:24px;background:var(--card);color:var(--ink);resize:none;min-height:48px;max-height:132px;overflow-y:auto}
form.ask button{min-height:48px;min-width:72px;padding:0 20px}
.draft{border:2px dashed var(--amber);border-radius:18px;padding:12px 14px;margin:8px 0 12px;background:var(--card)}
.draft .actions{display:flex;gap:8px;flex-wrap:wrap;margin-top:10px}
.draft b.k{display:block;font-family:var(--display);font-weight:600;font-size:15px;margin:0 0 8px}
.draft dl.summary{display:grid;grid-template-columns:max-content 1fr;gap:4px 14px;margin:0 0 10px;font-size:15.5px}
.draft dl.summary dt{color:var(--quiet);font-weight:700}
.draft dl.summary dd{margin:0;overflow-wrap:anywhere}
.standing.ok{color:#2f6f3a;font-weight:700}
.draft .actions button{min-height:46px}
.standing{font-size:14px;color:var(--quiet);margin:10px 0 0}

/* ---- footer: room to breathe ---- */
footer{max-width:640px;margin:0 auto;padding:44px 24px 60px;text-align:center;color:var(--quiet);border-top:2px dashed var(--rule)}
footer .mark{width:64px;height:auto;margin:0 auto 18px;display:block}
footer .about{font-size:16px;line-height:1.75;margin:0 auto 30px;max-width:520px}
footer .links{display:flex;flex-wrap:wrap;justify-content:center;gap:10px 12px;margin:0 0 28px;padding:0;list-style:none}
footer .links a{font-family:var(--display);font-weight:500;font-size:16px;color:var(--ink);text-decoration:none;padding:10px 16px;border-radius:999px;background:var(--card);border:1.5px solid var(--rule);display:inline-block}
footer .links a:hover{background:var(--amber-soft);border-color:var(--amber)}
footer .fine{display:flex;flex-wrap:wrap;justify-content:center;gap:8px 22px;font-size:14px;line-height:1.6;margin:0}
footer .fine a{color:var(--quiet)}
footer .fine span{white-space:nowrap}

/* ---- home: an app-shaped chat. The log scrolls; the composer stays pinned. ---- */
body.home{overscroll-behavior-y:none}
body.home main{height:100dvh;min-height:0;display:flex;flex-direction:column;padding:10px 16px 0;overflow:hidden}
body.home .chat{position:relative;flex:1 1 auto;min-height:0;overflow-y:auto;-webkit-overflow-scrolling:touch;overscroll-behavior:contain;margin:0 0 8px;background:transparent;border:0;padding:6px 2px;scroll-padding-bottom:12px}
body.home .composer{flex:0 0 auto;padding-bottom:max(12px,env(safe-area-inset-bottom))}

@media (max-width:560px){
  .grid{grid-template-columns:1fr}
  h1{font-size:32px}
  table.stack,table.stack tbody,table.stack tr,table.stack td{display:block;width:100%}
  table.stack th{display:none}
  table.stack td{padding:2px 0;border:0}
  table.stack tr{border-bottom:1.5px solid var(--rule);padding:10px 0}
}
@media (max-width:640px){
  main{padding-left:16px;padding-right:16px}
  header.top{padding:12px 16px 0}
  header.top nav{gap:4px;font-size:14.5px}
  header.top nav a{padding:6px 10px}
  .suggest{flex-wrap:nowrap;overflow-x:auto;white-space:nowrap;margin:0 -16px 8px;padding:0 16px}
  .suggest button{flex:0 0 auto}
  .txt{max-width:94%}
  .msg.n .txt{max-width:85%}
  .tool{margin-left:4px}
  .draft{padding:10px 12px}
  .draft .actions{display:grid;grid-template-columns:1.4fr 1fr}
  .draft .actions button{font-size:15px;padding:0 10px;white-space:nowrap}
  footer{padding:40px 20px max(56px,env(safe-area-inset-bottom))}
}
</style>
${s.head ?? ""}
</head>
<body${s.path === "/" ? ' class="home"' : ""}>
${s.path === "/" ? "" : `<header class="top">
  <a class="brand" href="/" aria-label="${esc(s.siteName)}, home">${has("mark.webp") ? '<img src="/brand/mark.webp" alt="" width="46" height="44">' : ""}<span class="name">${esc(s.siteName)}</span></a>
  <nav>${NAV.map(([href, label]) => `<a href="${href}"${href === s.path ? ' class="on"' : ""}>${label}</a>`).join("")}</nav>
</header>`}
<main>
${s.body}
</main>
<footer>
  ${has("mark.webp") ? '<img class="mark" src="/brand/mark.webp" alt="" width="64" height="61" loading="lazy">' : ""}
  <p class="about">${esc(s.siteName)} works for ${esc(place)}, not any one person. It answers from public neighborhood data, cites every source, and says "I don't know" when it doesn't. If you ask it to add or fix something, it checks with you first, then sends it to the neighbors who look after it. Nothing you type is kept; the conversation lives only in your browser tab.</p>
  <ul class="links">${NAV.filter(([href]) => href !== "/").map(([href, label]) => `<li><a href="${href}">${label}</a></li>`).join("")}</ul>
  <p class="fine"><span>Data CC BY 4.0</span><span><a href="https://github.com/The-Relational-Technology-Project/neighborhood-agent">Open source</a></span><span><a href="https://relationaltechproject.org">Relational Tech Project</a></span><span><a href="/stewards">For stewards</a></span></p>
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
