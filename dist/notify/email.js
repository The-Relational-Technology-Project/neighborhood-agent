export function stewardAddresses(cfg, repo) {
    if (cfg.email.to.length)
        return cfg.email.to;
    return [...new Set([...repo.stewardsMd.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]))];
}
export function emailConfigured(cfg, repo) {
    return Boolean(cfg.email.apiKey && stewardAddresses(cfg, repo).length);
}
export async function emailStewards(cfg, repo, msg) {
    const to = stewardAddresses(cfg, repo);
    if (!cfg.email.apiKey || !to.length)
        throw new Error("email is not configured");
    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.email.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({ from: cfg.email.from, to, subject: msg.subject, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}) }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok)
        throw new Error(`email ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
//# sourceMappingURL=email.js.map