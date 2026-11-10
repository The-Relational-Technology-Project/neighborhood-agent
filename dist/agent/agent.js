/**
 * The agent loop: Messages API with tool use, streamed. Session state lives on the client;
 * the server receives the whole conversation each turn and keeps nothing after responding.
 */
import { Anthropic } from "@anthropic-ai/sdk/client";
import { buildSystem } from "./prompt.js";
import { runTool, toolDefinitions } from "./tools.js";
export const RESTING = "I'm resting, try again tomorrow. (The daily budget for this agent is spent; stewards can raise it.)";
export class Agent {
    cfg;
    budget;
    client;
    constructor(cfg, budget) {
        this.cfg = cfg;
        this.budget = budget;
        this.client = new Anthropic();
    }
    async respond(history, tools, ev = {}) {
        if (!this.budget.canSpend()) {
            ev.onText?.(RESTING);
            return { text: RESTING, tools_used: [], drafts: [], stop_reason: "budget", usage: { input_tokens: 0, output_tokens: 0 } };
        }
        const system = buildSystem(tools.repo);
        const messages = history.slice(-20).map((m) => ({ role: m.role, content: m.content }));
        if (!messages.length || messages[0].role !== "user")
            throw new Error("conversation must start with the neighbor");
        const toolsUsed = [];
        const draftsMade = [];
        const ctx = { ...tools, onDraft: (d) => { draftsMade.push(d); ev.onDraft?.(d); tools.onDraft?.(d); }, onAsk: (a) => { ev.onAsk?.(a); tools.onAsk?.(a); } };
        let fullText = "";
        let stop = null;
        const usage = { input_tokens: 0, output_tokens: 0 };
        for (let round = 0; round < 6; round++) {
            const stream = this.client.messages.stream({
                model: this.cfg.model,
                max_tokens: this.cfg.maxTokens,
                system,
                messages,
                tools: toolDefinitions,
                output_config: { effort: "low" },
            });
            stream.on("text", (delta) => { fullText += delta; ev.onText?.(delta); });
            const msg = await stream.finalMessage();
            usage.input_tokens += msg.usage.input_tokens;
            usage.output_tokens += msg.usage.output_tokens;
            await this.budget.record(msg.usage);
            stop = msg.stop_reason;
            if (msg.stop_reason === "refusal") {
                const note = "I can't help with that one. If it's about the neighborhood, try asking another way, or reach the stewards on the contact page.";
                fullText += note;
                ev.onText?.(note);
                break;
            }
            const toolUses = msg.content.filter((b) => b.type === "tool_use");
            if (msg.stop_reason !== "tool_use" || !toolUses.length)
                break;
            messages.push({ role: "assistant", content: msg.content });
            const results = [];
            for (const tu of toolUses) {
                toolsUsed.push(tu.name);
                ev.onTool?.(tu.name, tu.input);
                let out;
                try {
                    out = await runTool(tu.name, tu.input, ctx);
                }
                catch (err) {
                    out = `Tool error: ${err.message}`;
                }
                results.push({ type: "tool_result", tool_use_id: tu.id, content: out });
            }
            messages.push({ role: "user", content: results });
            if (!this.budget.canSpend()) {
                fullText += `\n\n${RESTING}`;
                ev.onText?.(`\n\n${RESTING}`);
                stop = "budget";
                break;
            }
        }
        return { text: fullText, tools_used: toolsUsed, drafts: draftsMade, stop_reason: stop, usage };
    }
}
//# sourceMappingURL=agent.js.map