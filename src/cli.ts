#!/usr/bin/env node
/**
 * nagent: the terminal door.
 *   nagent index            rebuild the index from the data repo and every live source
 *   nagent ask "question"   answer from the terminal with citations
 *   nagent search "words"   raw search over the index
 *   nagent vitals           the vital signs line
 *   nagent sources          source statuses
 *   nagent golden [file]    run the golden questions (needs a model)
 *   nagent log-pr           open a PR adding new question-log rows to log/questions.md
 */
import { goldenReport, runGolden, type GoldenRun } from "./agent/golden.js";
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
      for (const s of state.statuses) console.log(`${s.id.padEnd(22)} ${s.status.padEnd(9)} ${String(s.records).padStart(4)} ${s.fetched_at ?? ""} ${s.stale ? "(stale)" : ""} ${s.error ? "ERROR " + s.error : ""}${s.skipped ? "skipped: " + s.skipped : ""}`);
      console.log(`\n${state.index.size} records. Repo at ${state.repo.sha ?? "(no git)"}.`);
      return;
    }
    case "search": {
      await state.init();
      await state.semanticReady;
      for (const r of await state.index.find(arg, { limit: 10 })) console.log(formatRecord(r) + "\n");
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
      if (!state.agent) throw new Error("ANTHROPIC_API_KEY is not set.");
      const r = await state.agent.respond([{ role: "user", content: arg }], { repo: state.repo, index: state.index, log: state.log }, {
        onText: (d) => process.stdout.write(d),
        onTool: (n, i) => process.stderr.write(`  [${n} ${JSON.stringify(i)}]\n`),
      });
      process.stdout.write("\n");
      process.stderr.write(`\n(tokens in ${r.usage.input_tokens}, out ${r.usage.output_tokens}; today $${state.budget.spent.toFixed(4)} of $${state.budget.limit})\n`);
      return;
    }
    case "golden": {
      // nagent golden [file ...] [--json out.json]: run the acceptance questions against the configured
      // model and score each one. With --json the run is written out for the report.
      await state.init();
      if (!state.agent) throw new Error("No model is configured. Set ANTHROPIC_API_KEY, or MODEL_BASE_URL and MODEL for an open model.");
      await state.semanticReady;
      const rest = process.argv.slice(3);
      const jsonAt = rest.indexOf("--json");
      const outFile = jsonAt >= 0 ? rest[jsonAt + 1] : undefined;
      const files = rest.filter((a, i) => !a.startsWith("--") && (jsonAt < 0 || i !== jsonAt + 1));
      if (!files.length) files.push(path.resolve(process.cwd(), "golden.yml"));
      const run = await runGolden(state, files);
      for (const r of run.results) {
        console.log(`${r.pass ? "PASS" : "FAIL"}  ${r.ask}\n      expect: ${r.expect}\n      tools: ${r.tools_used.join(", ") || "none"}  (${(r.ms / 1000).toFixed(1)}s, ${r.input_tokens} in, ${r.output_tokens} out)${r.problems.length ? `\n      problems: ${r.problems.join("; ")}` : ""}\n      answer: ${r.answer.replace(/\s+/g, " ").slice(0, 400)}\n`);
      }
      console.log(`${run.passed}/${run.results.length} passed on ${run.model}. Median ${(run.median_ms / 1000).toFixed(1)}s. ${run.input_tokens} in, ${run.output_tokens} out.`);
      if (outFile) { await fs.mkdir(path.dirname(path.resolve(outFile)), { recursive: true }); await fs.writeFile(outFile, JSON.stringify(run, null, 2)); console.log(`Wrote ${outFile}`); }
      if (run.passed < run.results.length) process.exitCode = 1;
      return;
    }
    case "golden-report": {
      // nagent golden-report <dir>: one table from every run in a folder, as markdown on stdout.
      const dir = arg || path.resolve(process.cwd(), "bench/results");
      const runs = (await Promise.all((await fs.readdir(dir)).filter((f) => f.endsWith(".json")).sort().map(async (f) => JSON.parse(await fs.readFile(path.join(dir, f), "utf8")) as GoldenRun)));
      console.log(goldenReport(runs));
      return;
    }
    case "log-pr": {
      await state.init();
      const rows = state.log.rowsNotIn(state.repo.questionLogMd);
      if (!rows.length) { console.log("Nothing new to log."); return; }
      const content = state.repo.questionLogMd.trimEnd() + "\n" + rows.join("\n") + "\n";
      if (!state.github.configured) { console.log("GitHub App not configured. New rows:\n" + rows.join("\n")); return; }
      const pr = await state.github.openPr({ path: "log/questions.md", content, title: `Question log: ${rows.length} new row(s)`, body: "Aggregated counts by topic and week. No names, no message text. Opened by the neighborhood agent.", labels: ["log"], base: state.cfg.dataRepoBranch });
      console.log(`Opened ${pr.url}`);
      return;
    }
    default:
      console.log("nagent index | ask \"q\" | search \"words\" | vitals | sources | golden [file ...] [--json out] | golden-report [dir] | log-pr");
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
