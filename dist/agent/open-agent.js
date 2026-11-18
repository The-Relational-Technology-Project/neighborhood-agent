import { buildSystem } from "./prompt.js";
import { runTool, toolDefinitions } from "./tools.js";
import { RESTING } from "./agent.js";
/** The agent's tools in the shape OpenAI-compatible endpoints take. */
export const openTools = toolDefinitions.map((t) => ({
    type: "function",
    function: { name: t.name, description: t.description ?? "", parameters: t.input_schema },
}));
/** The tools that only read. When a model is made to look before it speaks, these are all it is offered:
 *  being pushed to act must never mean drafting a change or writing to a neighbor. */
const READ_ONLY = new Set(["search_data", "get_vital_signs", "lookup_person_or_place", "about_block", "welcome_neighbor", "city_311"]);
export const lookTools = openTools.filter((t) => READ_ONLY.has(t.function.name));
/** Reasoning some open models leave in the visible answer. */
export function stripThinking(text) {
    return text.replace(/<think>[\s\S]*?<\/think>/gi, "").replace(/^[\s\S]*?<\/think>/i, "").trim();
}
export class OpenAgent {
    cfg;
    budget;
    /** No Anthropic client: the question log falls back to its word-based classifier. */
    client = undefined;
    /** What went wrong in tool calls since this agent was made, for test runs. */
    slips = { bad_arguments: 0, unknown_tool: 0, empty_answer: 0 };
    constructor(cfg, budget) {
        this.cfg = cfg;
        this.budget = budget;
    }
    async respond(history, tools, ev = {}) {
        if (!this.budget.canSpend()) {
            ev.onText?.(RESTING);
            return { text: RESTING, tools_used: [], drafts: [], stop_reason: "budget", usage: { input_tokens: 0, output_tokens: 0 } };
        }
        const system = buildSystem(tools.repo, tools.near).map((b) => b.text).join("\n\n");
        const turns = history.slice(-20);
        if (!turns.length || turns[0].role !== "user")
            throw new Error("conversation must start with the neighbor");
        const messages = [{ role: "system", content: system }, ...turns.map((m) => ({ role: m.role, content: m.content }))];
        const toolsUsed = [];
        const draftsMade = [];
        const ctx = { ...tools, onDraft: (d) => { draftsMade.push(d); ev.onDraft?.(d); tools.onDraft?.(d); }, onAsk: (a) => { ev.onAsk?.(a); tools.onAsk?.(a); } };
        const known = new Set(toolDefinitions.map((t) => t.name));
        let fullText = "";
        let stop = null;
        const usage = { input_tokens: 0, output_tokens: 0 };
        for (let round = 0; round < 6; round++) {
            const res = await fetch(`${this.cfg.modelBaseUrl.replace(/\/$/, "")}/chat/completions`, {
                method: "POST",
                headers: { "content-type": "application/json", ...(this.cfg.modelApiKey ? { authorization: `Bearer ${this.cfg.modelApiKey}` } : {}) },
                body: JSON.stringify({ model: this.cfg.model, max_tokens: this.cfg.maxTokens, messages, ...(round === 0 && this.cfg.lookFirst ? { tools: lookTools, tool_choice: "required" } : { tools: openTools, tool_choice: "auto" }), temperature: 0.2 }),
                signal: AbortSignal.timeout(120_000),
            });
            if (!res.ok)
                throw new Error(`model ${res.status}: ${(await res.text()).slice(0, 300)}`);
            const json = (await res.json());
            const choice = json.choices?.[0];
            const u = { input_tokens: json.usage?.prompt_tokens ?? 0, output_tokens: json.usage?.completion_tokens ?? 0 };
            usage.input_tokens += u.input_tokens;
            usage.output_tokens += u.output_tokens;
            await this.budget.record(u);
            stop = choice?.finish_reason ?? null;
            const text = stripThinking(choice?.message?.content ?? "");
            const calls = (choice?.message?.tool_calls ?? []).filter((c) => c?.function?.name);
            if (text) {
                const piece = fullText ? `\n\n${text}` : text;
                fullText += piece;
                ev.onText?.(piece);
            }
            if (!calls.length)
                break;
            messages.push({ role: "assistant", content: choice?.message?.content ?? null, tool_calls: calls });
            for (const call of calls) {
                const name = call.function.name;
                let out;
                if (!known.has(name)) {
                    this.slips.unknown_tool++;
                    out = `There is no tool called ${name}. The tools are: ${[...known].join(", ")}.`;
                }
                else {
                    let args;
                    try {
                        args = JSON.parse(call.function.arguments || "{}");
                    }
                    catch {
                        args = undefined;
                    }
                    if (args === undefined) {
                        this.slips.bad_arguments++;
                        out = "The arguments were not valid JSON. Call the tool again with a JSON object.";
                    }
                    else {
                        toolsUsed.push(name);
                        ev.onTool?.(name, args);
                        try {
                            out = await runTool(name, args, ctx);
                        }
                        catch (err) {
                            out = `Tool error: ${err.message}`;
                        }
                    }
                }
                messages.push({ role: "tool", tool_call_id: call.id, content: out });
            }
            if (!this.budget.canSpend()) {
                fullText += `\n\n${RESTING}`;
                ev.onText?.(`\n\n${RESTING}`);
                stop = "budget";
                break;
            }
        }
        if (!fullText.trim()) {
            this.slips.empty_answer++;
            const note = "I couldn't put an answer together for that one. Try asking another way, or reach the stewards on the contact page.";
            fullText = note;
            ev.onText?.(note);
        }
        return { text: fullText, tools_used: toolsUsed, drafts: draftsMade, stop_reason: stop, usage };
    }
}
//# sourceMappingURL=open-agent.js.map