/**
 * One small door to the model for the background jobs: a system prompt, a user message, a short
 * answer. Jobs take an `Ask` so tests can hand them a canned one. Usage goes on the daily budget.
 */
import type { Anthropic } from "@anthropic-ai/sdk/client";
import type { Budget } from "../agent/budget.js";

export type Ask = (system: string, user: string, maxTokens?: number) => Promise<string>;

export function makeAsk(client: Anthropic | undefined, model: string, budget?: Budget): Ask | undefined {
  if (!client) return undefined;
  return async (system, user, maxTokens = 800) => {
    if (budget && !budget.canSpend()) throw new Error("daily budget spent");
    const res = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
    await budget?.record(res.usage);
    return res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
  };
}

/** The first JSON object or array in a model reply, or undefined. */
export function parseJson<T>(text: string): T | undefined {
  const m = text.match(/[[{][\s\S]*[\]}]/);
  if (!m) return undefined;
  try { return JSON.parse(m[0]) as T; } catch { /* try a repair below */ }
  // A reply cut off mid-array: keep the complete objects and close it.
  const start = text.indexOf("[");
  if (start < 0) return undefined;
  const lastClose = text.lastIndexOf("}");
  if (lastClose < start) return undefined;
  try { return JSON.parse(text.slice(start, lastClose + 1) + "]") as T; } catch { return undefined; }
}
