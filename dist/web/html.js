/**
 * Server-rendered pages. The look: a typed notice on a corkboard, neighborhood-scale, no AI
 * iconography. Mobile first; most neighbors open this from a chat link.
 */
export const esc = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/"/g, "&quot;");
const NAV = [["/", "Ask"], ["/about", "About"], ["/sources", "Sources"], ["/proposals", "Proposals"], ["/correct", "Correct"], ["/contact", "Contact"]];
export function layout(s) {
    return `<!doctype html>
<html lang="en">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width, initial-scale=1">
<title>${esc(s.title)}</title>
<meta name="description" content="A neighborhood agent for the ${esc(s.siteName)}: answers with sources, points to people, and turns asks into public proposals.">
<link rel="icon" href="data:image/svg+xml,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 32 32'><rect width='32' height='32' rx='4' fill='%23f4efe4'/><circle cx='16' cy='16' r='7' fill='%23d9622b'/></svg>">
<link rel="preconnect" href="https://fonts.googleapis.com">
<link href="https://fonts.googleapis.com/css2?family=Caveat:wght@600&family=IBM+Plex+Sans:ital,wght@0,400;0,600;1,400&family=Special+Elite&display=swap" rel="stylesheet">
<style>
:root{--paper:#f4efe4;--ink:#2a2622;--quiet:#6b645b;--rule:#d9d0bf;--orange:#d9622b;--sea:#2f6f8f;--sand:#e8dcc2;--card:#fbf8f1;--white:#fff}
*{box-sizing:border-box}
html{-webkit-text-size-adjust:100%}
body{margin:0;background:var(--paper);color:var(--ink);font-family:"IBM Plex Sans",system-ui,sans-serif;line-height:1.55;font-size:16px;background-image:radial-gradient(rgba(42,38,34,.045) 1px,transparent 1px);background-size:14px 14px}
a{color:var(--sea)}
main{max-width:720px;margin:0 auto;padding:20px 16px 72px}
header.top{max-width:720px;margin:0 auto;padding:18px 16px 0;display:flex;flex-wrap:wrap;align-items:baseline;gap:8px 18px}
header.top .name{font-family:"Caveat",cursive;font-size:30px;font-weight:600;text-decoration:none;color:var(--ink);line-height:1}
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
footer{max-width:720px;margin:0 auto;padding:0 16px 40px;font-family:"Special Elite",monospace;font-size:12px;color:var(--quiet);letter-spacing:.04em}
footer a{color:var(--quiet)}
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
.txt a{word-break:break-all}
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
</style>
${s.head ?? ""}
</head>
<body>
<header class="top">
  <a class="name" href="/">${esc(s.siteName)}</a>
  <nav>${NAV.map(([href, label]) => `<a href="${href}"${href === s.path ? ' class="on"' : ""}>${label}</a>`).join("")}</nav>
</header>
<main>
${s.body}
</main>
<footer>
  <a href="${esc(s.repoUrl)}">the neighborhood repo</a> · data CC BY 4.0 · <a href="https://github.com/The-Relational-Technology-Project/neighborhood-agent">code, MIT</a> · <a href="https://relationaltechproject.org">Relational Tech Project</a>
</footer>
</body>
</html>`;
}
/** Tiny markdown: paragraphs, headings, bullets, links, code, bold. Enough for repo files. */
export function md(text) {
    const lines = text.replace(/\r\n/g, "\n").split("\n");
    const out = [];
    let para = [];
    let list = [];
    let code = null;
    const inline = (s) => esc(s)
        .replace(/`([^`]+)`/g, "<code>$1</code>")
        .replace(/\*\*(.+?)\*\*/g, "<b>$1</b>")
        .replace(/\[([^\]]+)\]\((https?:\/\/[^)\s]+|\/[^)\s]*|mailto:[^)\s]+)\)/g, '<a href="$2">$1</a>')
        .replace(/(^|[\s(])(https?:\/\/[^\s<)]+)/g, '$1<a href="$2">$2</a>');
    const flush = () => {
        if (para.length) {
            out.push(`<p>${inline(para.join(" "))}</p>`);
            para = [];
        }
        if (list.length) {
            out.push(`<ul>${list.map((l) => `<li>${inline(l)}</li>`).join("")}</ul>`);
            list = [];
        }
    };
    for (const raw of lines) {
        if (code) {
            if (raw.startsWith("```")) {
                out.push(`<pre>${esc(code.join("\n"))}</pre>`);
                code = null;
            }
            else
                code.push(raw);
            continue;
        }
        const line = raw.trimEnd();
        if (line.startsWith("```")) {
            flush();
            code = [];
            continue;
        }
        const h = line.match(/^(#{1,3})\s+(.+)$/);
        if (h) {
            flush();
            const lvl = Math.min(3, h[1].length + 1);
            out.push(`<h${lvl}>${inline(h[2])}</h${lvl}>`);
            continue;
        }
        if (/^\s*[-*]\s+/.test(line)) {
            if (para.length)
                flush();
            list.push(line.replace(/^\s*[-*]\s+/, ""));
            continue;
        }
        if (line.startsWith("|")) {
            flush();
            out.push(tableRow(line));
            continue;
        }
        if (!line.trim()) {
            flush();
            continue;
        }
        if (list.length)
            flush();
        para.push(line);
    }
    flush();
    return out.join("\n").replace(/(<tr>.*?<\/tr>\n?)+/gs, (m) => `<table>${m}</table>`);
}
function tableRow(line) {
    const cells = line.replace(/^\|/, "").replace(/\|$/, "").split("|").map((c) => c.trim());
    if (cells.every((c) => /^:?-+:?$/.test(c)))
        return "";
    return `<tr>${cells.map((c) => `<td>${esc(c).replace(/`([^`]+)`/g, "<code>$1</code>")}</td>`).join("")}</tr>\n`;
}
//# sourceMappingURL=html.js.map