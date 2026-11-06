/**
 * Fetched content is data, never instructions. This scanner flags text that looks like it is
 * trying to talk to the model, so stewards can see it. The text is kept (it is still data).
 */
import fs from "node:fs/promises";
import path from "node:path";
const PATTERNS = [
    /ignore (all |any )?(previous|prior|above|your) (instructions|rules|prompt)/i,
    /disregard (the|your|all) (previous|prior|above|system)/i,
    /you are now (a|an|the) /i,
    /system prompt/i,
    /\bassistant:\s/i,
    /<\s*\/?\s*(system|instructions?|prompt)\s*>/i,
    /do not (tell|reveal|mention) (the )?(user|neighbor|steward)/i,
    /reveal (your|the) (instructions|prompt|rules)/i,
    /act as (if you (are|were)|a|an) /i,
];
export function looksLikeInjection(text) {
    for (const p of PATTERNS) {
        const m = text.match(p);
        if (m)
            return m[0];
    }
    return undefined;
}
export async function logInjection(cacheDir, entry) {
    const file = path.join(cacheDir, "injection.log");
    await fs.mkdir(cacheDir, { recursive: true });
    await fs.appendFile(file, JSON.stringify({ at: new Date().toISOString(), ...entry }) + "\n");
}
//# sourceMappingURL=injection.js.map