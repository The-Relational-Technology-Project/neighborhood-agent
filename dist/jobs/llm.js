export function makeAsk(client, model, budget) {
    if (!client)
        return undefined;
    return async (system, user, maxTokens = 800) => {
        if (budget && !budget.canSpend())
            throw new Error("daily budget spent");
        const res = await client.messages.create({ model, max_tokens: maxTokens, system, messages: [{ role: "user", content: user }] });
        await budget?.record(res.usage);
        return res.content.filter((b) => b.type === "text").map((b) => b.text).join("");
    };
}
/** The first JSON object or array in a model reply, or undefined. */
export function parseJson(text) {
    const m = text.match(/[[{][\s\S]*[\]}]/);
    if (!m)
        return undefined;
    try {
        return JSON.parse(m[0]);
    }
    catch { /* try a repair below */ }
    // A reply cut off mid-array: keep the complete objects and close it.
    const start = text.indexOf("[");
    if (start < 0)
        return undefined;
    const lastClose = text.lastIndexOf("}");
    if (lastClose < start)
        return undefined;
    try {
        return JSON.parse(text.slice(start, lastClose + 1) + "]");
    }
    catch {
        return undefined;
    }
}
//# sourceMappingURL=llm.js.map