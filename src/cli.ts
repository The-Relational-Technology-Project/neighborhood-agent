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
      for (const r of state.index.search(arg, { limit: 10 })) console.log(formatRecord(r) + "\n");
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
      await state.init();
      if (!state.agent) throw new Error("ANTHROPIC_API_KEY is not set.");
      const file = arg || path.resolve(process.cwd(), "golden.yml");
      const spec = YAML.parse(await fs.readFile(file, "utf8")) as { questions: Array<{ ask: string; expect: string; must?: string[]; must_not?: string[]; tools?: string[]; no_tools?: string[] }> };
      let pass = 0;
      for (const q of spec.questions) {
        const r = await state.agent.respond([{ role: "user", content: q.ask }], { repo: state.repo, index: state.index, log: state.log });
        const text = r.text.toLowerCase();
        const problems: string[] = [];
        for (const m of q.must ?? []) if (!text.includes(m.toLowerCase())) problems.push(`missing "${m}"`);
        for (const m of q.must_not ?? []) if (text.includes(m.toLowerCase())) problems.push(`contains "${m}"`);
        for (const t of q.tools ?? []) if (!r.tools_used.includes(t)) problems.push(`did not call ${t}`);
        for (const t of q.no_tools ?? []) if (r.tools_used.includes(t)) problems.push(`called ${t}`);
        const cites = /https?:\/\//.test(r.text) || /\(([^)]*\.(org|com|gov|us|today)[^)]*)\)/i.test(r.text);
        if (q.expect.includes("cite") && !cites) problems.push("no source link");
        const ok = problems.length === 0;
        if (ok) pass++;
        console.log(`${ok ? "PASS" : "FAIL"}  ${q.ask}\n      expect: ${q.expect}\n      tools: ${r.tools_used.join(", ") || "none"}${problems.length ? `\n      problems: ${problems.join("; ")}` : ""}\n      answer: ${r.text.replace(/\s+/g, " ").slice(0, 300)}\n`);
      }
      console.log(`${pass}/${spec.questions.length} passed. Today $${state.budget.spent.toFixed(4)} of $${state.budget.limit}.`);
      if (pass < spec.questions.length) process.exitCode = 1;
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
      console.log("nagent index | ask \"q\" | search \"words\" | vitals | sources | golden [file] | log-pr");
  }
}

main().catch((err) => { console.error(err instanceof Error ? err.message : err); process.exit(1); });
