/**
 * After an answer is sent, one small call classifies the exchange for the question log:
 * a topic from a fixed list, whether the answer pointed to a person or group, whether it said
 * "I don't know". The result is three fields; the messages are not kept.
 */
import Anthropic from "@anthropic-ai/sdk";
import { TOPICS } from "./questionlog.js";

export interface Classification { topic: string; referral: boolean; dont_know: boolean }

export function heuristicClassify(question: string, answer: string): Classification {
  const q = question.toLowerCase();
  const pick = (): string => {
    if (/wrong|actually|correct|closes at|opens at|not true/.test(q)) return "correction";
    if (/can we|could we|start a|should we|propose|build day|co-?op/.test(q)) return "proposal";
    if (/where does|who is|lives|address of/.test(q)) return "about-a-person";
    if (/pizza|food|eat|lunch|dinner|coffee|bakery|menu/.test(q)) return "food";
    if (/open|hours|close/.test(q)) return "places-and-hours";
    if (/meet|friends|new here|moved|lonely|social/.test(q)) return "meeting-people";
    if (/group|club|run|yoga|choir|garden|volunteer/.test(q)) return "groups";
    if (/tool|borrow|lend|share|library/.test(q)) return "sharing-and-borrowing";
    if (/ocean|beach|tide|surf|water|bonfire|swim/.test(q)) return "beach-and-ocean";
    if (/plover|coyote|bird|wildlife|whale|seal/.test(q)) return "wildlife";
    if (/dog|leash|puppy/.test(q)) return "dogs";
    if (/kid|child|family|school|baby|parent/.test(q)) return "kids-and-family";
    if (/rent|housing|apartment|landlord/.test(q)) return "housing";
    if (/safe|crime|police|emergency/.test(q)) return "safety";
    if (/muni|bus|train|bike|parking|transit/.test(q)) return "transit";
    if (/history|used to|old photo|historic/.test(q)) return "history";
    if (/happening|event|today|tonight|weekend|this week|concert|show/.test(q)) return "events";
    if (/you|agent|steward|who built|what are you/.test(q)) return "the-agent";
    return "other";
  };
  const a = answer.toLowerCase();
  return { topic: pick(), referral: /\b(talk to|reach|contact|ask |email|the folks at|start with)\b/.test(a) || /https?:\/\//.test(a), dont_know: /i don't know|i do not know|i don’t know/.test(a) };
}

export async function classify(client: Anthropic | undefined, model: string, question: string, answer: string): Promise<Classification> {
  const fallback = heuristicClassify(question, answer);
  if (!client) return fallback;
  try {
    const res = await client.messages.create({
      model,
      max_tokens: 120,
      output_config: { effort: "low" },
      system: `Classify one exchange between a neighbor and a neighborhood agent for an aggregated log. Reply with JSON only: {"topic": one of ${JSON.stringify(TOPICS)}, "referral": true if the answer pointed the neighbor to a specific person, org, or group to talk to, "dont_know": true if the answer said it did not know}. No other text.`,
      messages: [{ role: "user", content: `Neighbor: ${question.slice(0, 600)}\n\nAgent: ${answer.slice(0, 900)}` }],
    });
    const text = res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    const m = text.match(/\{[\s\S]*\}/);
    if (!m) return fallback;
    const parsed = JSON.parse(m[0]) as Partial<Classification>;
    return {
      topic: (TOPICS as readonly string[]).includes(String(parsed.topic)) ? String(parsed.topic) : fallback.topic,
      referral: Boolean(parsed.referral),
      dont_know: Boolean(parsed.dont_know),
    };
  } catch {
    return fallback;
  }
}
