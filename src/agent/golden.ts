/**
 * The acceptance questions, scored. Each question in a golden file carries loose checks: words the
 * answer must or must not contain, tools it must or must not call, and whether it must cite. A run
 * records, for one model, whether each question passed, how long it took, and what it cost in
 * tokens, so models can be compared on the same questions against the same notes.
 *
 * The checks are behavioral floors, not a grade of the prose. Read the answers too.
 */
import fs from "node:fs/promises";
import YAML from "yaml";
import type { AppState } from "../state.js";
import { OpenAgent } from "./open-agent.js";

export interface GoldenQuestion { ask: string; expect: string; must?: string[]; must_any?: string[]; must_not?: string[]; tools?: string[]; no_tools?: string[]; near?: string }
export interface GoldenResult { file: string; ask: string; expect: string; pass: boolean; problems: string[]; tools_used: string[]; ms: number; input_tokens: number; output_tokens: number; answer: string; error?: string }
export interface GoldenRun {
  model: string; endpoint: string; look_first?: boolean; at: string; data_commit: string | null; search_by_meaning: boolean;
  passed: number; results: GoldenResult[]; median_ms: number; input_tokens: number; output_tokens: number;
  slips?: { bad_arguments: number; unknown_tool: number; empty_answer: number };
}

export function score(q: GoldenQuestion, text: string, toolsUsed: string[]): string[] {
  const t = text.toLowerCase();
  const problems: string[] = [];
  for (const m of q.must ?? []) if (!t.includes(m.toLowerCase())) problems.push(`missing "${m}"`);
  if (q.must_any?.length && !q.must_any.some((m) => t.includes(m.toLowerCase()))) problems.push(`none of ${q.must_any.map((m) => `"${m}"`).join(", ")}`);
  for (const m of q.must_not ?? []) if (t.includes(m.toLowerCase())) problems.push(`contains "${m}"`);
  for (const tool of q.tools ?? []) if (!toolsUsed.includes(tool)) problems.push(`did not call ${tool}`);
  for (const tool of q.no_tools ?? []) if (toolsUsed.includes(tool)) problems.push(`called ${tool}`);
  const cites = /https?:\/\//.test(text) || /\(([^)]*\.(org|com|gov|us|today)[^)]*)\)/i.test(text);
  if (q.expect.includes("cite") && !cites) problems.push("no source link");
  return problems;
}

export async function runGolden(state: AppState, files: string[]): Promise<GoldenRun> {
  const results: GoldenResult[] = [];
  for (const file of files) {
    const spec = YAML.parse(await fs.readFile(file, "utf8")) as { questions: GoldenQuestion[] };
    for (const q of spec.questions) {
      const started = Date.now();
      const near = q.near ? state.repo.blocks.find((b) => b.id === q.near) : undefined;
      try {
        const r = await state.agent!.respond([{ role: "user", content: q.ask }], { repo: state.repo, index: state.index, log: state.log, near });
        const problems = score(q, r.text, r.tools_used);
        results.push({ file: file.split("/").pop()!, ask: q.ask, expect: q.expect, pass: problems.length === 0, problems, tools_used: r.tools_used, ms: Date.now() - started, input_tokens: r.usage.input_tokens, output_tokens: r.usage.output_tokens, answer: r.text });
      } catch (err) {
        const error = (err as Error).message.slice(0, 300);
        results.push({ file: file.split("/").pop()!, ask: q.ask, expect: q.expect, pass: false, problems: [`error: ${error}`], tools_used: [], ms: Date.now() - started, input_tokens: 0, output_tokens: 0, answer: "", error });
      }
    }
  }
  const times = results.map((r) => r.ms).sort((a, b) => a - b);
  return {
    model: state.cfg.model, endpoint: state.cfg.modelBaseUrl ?? "anthropic", ...(state.cfg.lookFirst ? { look_first: true } : {}), at: new Date().toISOString(),
    data_commit: state.repo.sha ?? null, search_by_meaning: Boolean(state.index.semantic?.size),
    passed: results.filter((r) => r.pass).length, results,
    median_ms: times[Math.floor(times.length / 2)] ?? 0,
    input_tokens: results.reduce((a, r) => a + r.input_tokens, 0), output_tokens: results.reduce((a, r) => a + r.output_tokens, 0),
    ...(state.agent instanceof OpenAgent ? { slips: { ...state.agent.slips } } : {}),
  };
}

/** One table across runs: a row per model, then a row per question showing which models passed it. */
export function goldenReport(runs: GoldenRun[]): string {
  if (!runs.length) return "No runs yet.";
  const short = (m: string) => m.split("/").pop()!;
  const head = ["| Model | Passed | Median time | Tokens in / out | Tool slips |", "| --- | ---: | ---: | ---: | --- |"];
  const rows = runs.map((r) => `| ${r.model}${r.look_first ? " (look first)" : ""} | ${r.passed}/${r.results.length} | ${(r.median_ms / 1000).toFixed(1)}s | ${r.input_tokens.toLocaleString("en-US")} / ${r.output_tokens.toLocaleString("en-US")} | ${r.slips ? `${r.slips.bad_arguments} bad arguments, ${r.slips.unknown_tool} unknown tool, ${r.slips.empty_answer} empty` : "n/a"} |`);
  const asks = runs[0].results.map((r) => r.ask);
  const qHead = [`| Question | ${runs.map((r) => `${short(r.model)}${r.look_first ? " +look" : ""}`).join(" | ")} |`, `| --- | ${runs.map(() => ":---:").join(" | ")} |`];
  const qRows = asks.map((ask) => `| ${ask.replace(/\|/g, "/").slice(0, 70)} | ${runs.map((r) => { const x = r.results.find((y) => y.ask === ask); return !x ? "" : x.pass ? "pass" : "FAIL"; }).join(" | ")} |`);
  const when = runs.map((r) => r.at.slice(0, 10)).sort().pop();
  return [`Runs through ${when}. Notes at commit ${runs[0].data_commit?.slice(0, 8) ?? "unknown"}. Search by meaning ${runs.every((r) => r.search_by_meaning) ? "on" : "not on for every run"}.`, "", ...head, ...rows, "", ...qHead, ...qRows].join("\n");
}
