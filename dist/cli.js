#!/usr/bin/env node
/**
 * nagent: the terminal door.
 *   nagent index            rebuild the index from the data repo and every live source
 *   nagent ask "question"   answer from the terminal with citations
 *   nagent search "words"   raw search over the index, with how each hit matched
 *   nagent retrieval [file] score retrieval.yml: does each query find the record it should?
 *   nagent vitals           the vital signs line
 *   nagent sources          source statuses
 *   nagent golden [file]    run the golden questions (needs a model)
 *   nagent log-pr           open a PR adding new question-log rows to log/questions.md
 *   nagent weekly           gaps research, freshness check, cross-links, archives; email + PRs
 *                           (--dry: no email, no PRs; --only gaps,freshness,links,archive)
 */
import fs from "node:fs/promises";
import path from "node:path";
import YAML from "yaml";
import { AppState } from "./state.js";
import { formatVitals, getVitalSigns } from "./vitals/index.js";
import { formatRecord } from "./agent/tools.js";
const [, , cmd = "help", ...rest] = process.argv;
const arg = rest.join(" ").trim();
async function main() {
    const state = new AppState();
    switch (cmd) {
        case "index": {
            await state.init({ force: rest.includes("--force") });
            for (const s of state.statuses)
                console.log(`${s.id.padEnd(22)} ${s.status.padEnd(9)} ${String(s.records).padStart(4)} ${s.fetched_at ?? ""} ${s.stale ? "(stale)" : ""} ${s.error ? "ERROR " + s.error : ""}${s.skipped ? "skipped: " + s.skipped : ""}`);
            console.log(`\n${state.index.size} records. Repo at ${state.repo.sha ?? "(no git)"}.`);
            const e = state.embedding;
            console.log(e.embedder === "none" ? "Search: words only (set VOYAGE_API_KEY for search by meaning)." : `Search: words + meaning via ${e.embedder}; ${e.records} records have vectors, ${e.embedded} chunk(s) embedded on this build.${e.error ? ` ERROR ${e.error}` : ""}`);
            return;
        }
        case "search": {
            await state.init();
            const hits = await state.index.searchDetailed(arg, { limit: 10 });
            hits.forEach((h, i) => console.log(`#${i + 1}  score ${h.score.toFixed(4)}  words ${h.lexicalRank ?? "-"}  meaning ${h.semanticRank ?? "-"}${h.similarity !== undefined ? ` (${h.similarity.toFixed(2)})` : ""}  ${h.why.join(", ")}\n${formatRecord(h.record)}\n`));
            if (!hits.length)
                console.log("No hits.");
            return;
        }
        case "retrieval": {
            await state.init();
            const file = arg || path.resolve(process.cwd(), "retrieval.yml");
            const spec = YAML.parse(await fs.readFile(file, "utf8"));
            const found = (title, id, want) => title.toLowerCase().includes(want.toLowerCase()) || id.toLowerCase().includes(want.toLowerCase());
            let at1 = 0, at3 = 0, at10 = 0, mrr = 0;
            for (const q of spec.queries) {
                const hits = await state.index.searchDetailed(q.q, { limit: 10, kinds: q.kinds, upcoming: q.upcoming });
                const rank = hits.findIndex((h) => q.expect.some((w) => found(h.record.title, h.record.id, w))) + 1;
                if (rank === 1)
                    at1++;
                if (rank >= 1 && rank <= 3)
                    at3++;
                if (rank >= 1) {
                    at10++;
                    mrr += 1 / rank;
                }
                const top = hits[0];
                console.log(`${rank === 1 ? "  1 " : rank ? `  ${rank} ` : "MISS"} ${q.q}\n      want: ${q.expect.join(" | ")}\n      top: ${top ? `${top.record.title} [${top.why.join(", ")}]` : "nothing"}${rank > 1 ? `\n      found at #${rank}: ${hits[rank - 1].record.title} [${hits[rank - 1].why.join(", ")}]` : ""}`);
            }
            const n = spec.queries.length;
            console.log(`\n${n} queries. hit@1 ${at1}/${n}, hit@3 ${at3}/${n}, hit@10 ${at10}/${n}, MRR ${(mrr / n).toFixed(3)}. Search: ${state.index.semantic ? `words + meaning (${state.embedding.embedder})` : "words only"}.`);
            return;
        }
        case "vitals": {
            await state.init();
            console.log(formatVitals(await getVitalSigns(state.repo)));
            return;
        }
        case "sources": {
            await state.init();
            console.log(YAML.stringify(state.statuses));
            return;
        }
        case "ask": {
            await state.init();
            if (!state.agent)
                throw new Error("ANTHROPIC_API_KEY is not set.");
            const r = await state.agent.respond([{ role: "user", content: arg }], { repo: state.repo, index: state.index, log: state.log }, {
                onText: (d) => process.stdout.write(d),
                onTool: (n, i) => process.stderr.write(`  [${n} ${JSON.stringify(i)}]\n`),
            });
            process.stdout.write("\n");
            process.stderr.write(`\n(tokens in ${r.usage.input_tokens}, out ${r.usage.output_tokens}; today $${state.budget.spent.toFixed(4)} of $${state.budget.limit})\n`);
            return;
        }
        case "golden": {
            await state.init();
            if (!state.agent)
                throw new Error("ANTHROPIC_API_KEY is not set.");
            const file = arg || path.resolve(process.cwd(), "golden.yml");
            const spec = YAML.parse(await fs.readFile(file, "utf8"));
            let pass = 0;
            for (const q of spec.questions) {
                const r = await state.agent.respond([{ role: "user", content: q.ask }], { repo: state.repo, index: state.index, log: state.log });
                const text = r.text.toLowerCase();
                const problems = [];
                for (const m of q.must ?? [])
                    if (!text.includes(m.toLowerCase()))
                        problems.push(`missing "${m}"`);
                for (const m of q.must_not ?? [])
                    if (text.includes(m.toLowerCase()))
                        problems.push(`contains "${m}"`);
                for (const t of q.tools ?? [])
                    if (!r.tools_used.includes(t))
                        problems.push(`did not call ${t}`);
                for (const t of q.no_tools ?? [])
                    if (r.tools_used.includes(t))
                        problems.push(`called ${t}`);
                const cites = /https?:\/\//.test(r.text) || /\(([^)]*\.(org|com|gov|us|today)[^)]*)\)/i.test(r.text);
                if (q.expect.includes("cite") && !cites)
                    problems.push("no source link");
                const ok = problems.length === 0;
                if (ok)
                    pass++;
                console.log(`${ok ? "PASS" : "FAIL"}  ${q.ask}\n      expect: ${q.expect}\n      tools: ${r.tools_used.join(", ") || "none"}${problems.length ? `\n      problems: ${problems.join("; ")}` : ""}\n      answer: ${r.text.replace(/\s+/g, " ").slice(0, 300)}\n`);
            }
            console.log(`${pass}/${spec.questions.length} passed. Today $${state.budget.spent.toFixed(4)} of $${state.budget.limit}.`);
            if (pass < spec.questions.length)
                process.exitCode = 1;
            return;
        }
        case "log-pr": {
            await state.init();
            const rows = state.log.rowsNotIn(state.repo.questionLogMd);
            if (!rows.length) {
                console.log("Nothing new to log.");
                return;
            }
            const content = state.repo.questionLogMd.trimEnd() + "\n" + rows.join("\n") + "\n";
            if (!state.github.configured) {
                console.log("GitHub App not configured. New rows:\n" + rows.join("\n"));
                return;
            }
            const pr = await state.github.openPr({ path: "log/questions.md", content, title: `Question log: ${rows.length} new row(s)`, body: "Aggregated counts by topic and week. No names, no message text. Opened by the neighborhood agent.", labels: ["log"], base: state.cfg.dataRepoBranch });
            console.log(`Opened ${pr.url}`);
            return;
        }
        case "weekly": {
            await state.init();
            const { runWeekly } = await import("./jobs/weekly.js");
            const dry = rest.includes("--dry");
            const onlyArg = rest[rest.indexOf("--only") + 1];
            const all = ["gaps", "freshness", "links", "archive"];
            const only = rest.includes("--only") && onlyArg ? onlyArg.split(",") : [...all];
            const r = await runWeekly(state, { email: !dry, openPrs: !dry, skip: all.filter((j) => !only.includes(j)) });
            console.log(r.text);
            console.log(r.emailed ? `Emailed ${r.emailed.join(", ")}.` : dry ? "Dry run: no email, no PRs." : "No email sent (RESEND_API_KEY or recipients missing).");
            if (r.errors.length)
                process.exitCode = 1;
            return;
        }
        default:
            console.log("nagent index | ask \"q\" | search \"words\" | retrieval [file] | vitals | sources | golden [file] | log-pr | weekly [--dry] [--only a,b]");
    }
}
main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
//# sourceMappingURL=cli.js.map