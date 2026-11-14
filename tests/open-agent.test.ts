import { afterEach, describe, expect, it, vi } from "vitest";

async function setup(extra: Record<string, unknown> = {}) {
  const { AppState } = await import("../src/state.js");
  const { FIXTURE, tmpCache } = await import("./helpers.js");
  const cfg = { ...(await import("../src/config.js")).loadConfig(), dataRepo: FIXTURE, cacheDir: await tmpCache(), modelBaseUrl: "http://model.test/v1", model: "small-open-model", ...extra };
  const state = new AppState(cfg);
  await state.init();
  return state;
}
const reply = (message: Record<string, unknown>) => new Response(JSON.stringify({ choices: [{ finish_reason: "stop", message }], usage: { prompt_tokens: 100, completion_tokens: 20 } }), { status: 200, headers: { "content-type": "application/json" } });
const call = (name: string, args: string, id = "c1") => ({ content: null, tool_calls: [{ id, type: "function", function: { name, arguments: args } }] });

afterEach(() => vi.unstubAllGlobals());

describe("the agent on an open model", () => {
  it("uses the open loop when an endpoint is set, calls a tool, and answers from it", async () => {
    const state = await setup();
    const bodies: Array<Record<string, any>> = [];
    const replies = [reply(call("search_data", '{"query":"ladder"}')), reply({ content: "<think>hmm</think>The tool library lends ladders (https://example.org/tools)." })];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return replies.shift()!; }));
    const { OpenAgent } = await import("../src/agent/open-agent.js");
    expect(state.agent).toBeInstanceOf(OpenAgent);
    const r = await state.agent!.respond([{ role: "user", content: "Can I borrow a ladder?" }], { repo: state.repo, index: state.index, log: state.log });
    expect(r.tools_used).toEqual(["search_data"]);
    expect(r.text).toBe("The tool library lends ladders (https://example.org/tools).");
    expect(bodies[0].model).toBe("small-open-model");
    expect(bodies[0].tool_choice).toBe("auto");
    expect(bodies[1].messages.at(-1).role).toBe("tool");
    expect(bodies[1].messages.at(-1).content).toContain("Elsewhere Tool Library");
    expect(r.usage).toEqual({ input_tokens: 200, output_tokens: 40 });
  });

  it("absorbs a small model's slips: arguments that aren't JSON, a tool that doesn't exist, an empty answer", async () => {
    const state = await setup();
    const replies = [reply(call("search_data", "{query: ladder")), reply(call("make_coffee", "{}", "c2")), reply({ content: "" })];
    vi.stubGlobal("fetch", vi.fn(async () => replies.shift()!));
    const r = await state.agent!.respond([{ role: "user", content: "hello" }], { repo: state.repo, index: state.index, log: state.log });
    const { OpenAgent } = await import("../src/agent/open-agent.js");
    expect((state.agent as InstanceType<typeof OpenAgent>).slips).toEqual({ bad_arguments: 1, unknown_tool: 1, empty_answer: 1 });
    expect(r.tools_used).toEqual([]);
    expect(r.text).toMatch(/couldn't put an answer together/);
  });

  it("can be made to look first, and is then offered only tools that read", async () => {
    const state = await setup({ lookFirst: true });
    const bodies: Array<Record<string, any>> = [];
    const replies = [reply(call("search_data", '{"query":"sauna"}')), reply({ content: "Nothing in the notes yet." })];
    vi.stubGlobal("fetch", vi.fn(async (_url: string, init: RequestInit) => { bodies.push(JSON.parse(String(init.body))); return replies.shift()!; }));
    await state.agent!.respond([{ role: "user", content: "Is there a sauna co-op?" }], { repo: state.repo, index: state.index, log: state.log });
    expect(bodies[0].tool_choice).toBe("required");
    const offered = bodies[0].tools.map((t: { function: { name: string } }) => t.function.name);
    expect(offered).toContain("search_data");
    expect(offered).not.toContain("draft_pr");
    expect(offered).not.toContain("ask_a_neighbor");
    expect(bodies[1].tool_choice).toBe("auto");
    expect(bodies[1].tools.map((t: { function: { name: string } }) => t.function.name)).toContain("draft_pr");
  });

  it("scores an answer against a question's checks", async () => {
    const { score } = await import("../src/agent/golden.js");
    const q = { ask: "x", expect: "cites", must: ["mon"], must_any: ["plumb", "rooter"], must_not: ["1647"], tools: ["about_block"], no_tools: ["draft_pr"] };
    expect(score(q, "Monday, per Rooter Co (https://example.org)", ["about_block"])).toEqual([]);
    expect(score(q, "At 1647: Tuesday", ["draft_pr"])).toEqual(['missing "mon"', 'none of "plumb", "rooter"', 'contains "1647"', "did not call about_block", "called draft_pr", "no source link"]);
  });
});
