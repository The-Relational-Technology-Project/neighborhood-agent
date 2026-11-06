/**
 * A daily token budget with a hard stop, and a per-IP rate limit. When the budget is spent the
 * agent says "I'm resting, try again tomorrow" instead of failing silently.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { localDate } from "../data/index.js";
export class Budget {
    limitUsd;
    inPerM;
    outPerM;
    day = { date: localDate(), input: 0, output: 0, cache_read: 0, cache_write: 0, usd: 0, messages: 0 };
    file;
    constructor(cacheDir, limitUsd, inPerM, outPerM) {
        this.limitUsd = limitUsd;
        this.inPerM = inPerM;
        this.outPerM = outPerM;
        this.file = path.join(cacheDir, "budget.json");
    }
    async load() {
        try {
            const d = JSON.parse(await fs.readFile(this.file, "utf8"));
            if (d.date === localDate())
                this.day = d;
        }
        catch { /* fresh day */ }
    }
    roll() {
        const today = localDate();
        if (this.day.date !== today)
            this.day = { date: today, input: 0, output: 0, cache_read: 0, cache_write: 0, usd: 0, messages: 0 };
    }
    get spent() { this.roll(); return this.day.usd; }
    get limit() { return this.limitUsd; }
    get today() { this.roll(); return { ...this.day }; }
    canSpend() { this.roll(); return this.day.usd < this.limitUsd; }
    async record(usage) {
        this.roll();
        const i = usage.input_tokens ?? 0, o = usage.output_tokens ?? 0, cr = usage.cache_read_input_tokens ?? 0, cw = usage.cache_creation_input_tokens ?? 0;
        this.day.input += i;
        this.day.output += o;
        this.day.cache_read += cr;
        this.day.cache_write += cw;
        this.day.usd += (i * this.inPerM + cr * this.inPerM * 0.1 + cw * this.inPerM * 1.25 + o * this.outPerM) / 1_000_000;
        this.day.messages += 1;
        try {
            await fs.mkdir(path.dirname(this.file), { recursive: true });
            await fs.writeFile(this.file, JSON.stringify(this.day));
        }
        catch { /* best effort */ }
    }
}
export class RateLimiter {
    max;
    windowMs;
    hits = new Map();
    constructor(max, windowMs = 10 * 60 * 1000) {
        this.max = max;
        this.windowMs = windowMs;
    }
    allow(key, now = Date.now()) {
        const list = (this.hits.get(key) ?? []).filter((t) => now - t < this.windowMs);
        if (list.length >= this.max) {
            this.hits.set(key, list);
            return false;
        }
        list.push(now);
        this.hits.set(key, list);
        if (this.hits.size > 5000)
            for (const [k, v] of this.hits)
                if (!v.some((t) => now - t < this.windowMs))
                    this.hits.delete(k);
        return true;
    }
}
//# sourceMappingURL=budget.js.map