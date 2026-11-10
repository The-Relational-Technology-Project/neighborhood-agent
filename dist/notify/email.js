export function stewardAddresses(cfg, repo) {
    if (cfg.email.to.length)
        return cfg.email.to;
    return [...new Set([...repo.stewardsMd.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]))];
}
export function emailConfigured(cfg, repo) {
    return Boolean(cfg.email.apiKey && stewardAddresses(cfg, repo).length);
}
/** One plain-text email through Resend. */
export async function sendEmail(cfg, msg) {
    if (!cfg.email.apiKey)
        throw new Error("email is not configured");
    const res = await fetch("https://api.resend.com/emails", {
        method: "POST",
        headers: { Authorization: `Bearer ${cfg.email.apiKey}`, "Content-Type": "application/json", "User-Agent": "neighborhood-agent" },
        body: JSON.stringify({ from: cfg.email.from, to: msg.to, subject: msg.subject, text: msg.text, ...(msg.replyTo?.length ? { reply_to: msg.replyTo } : {}), ...(msg.attachments?.length ? { attachments: msg.attachments.map((a) => ({ filename: a.filename, content: a.content.toString("base64") })) } : {}) }),
        signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok)
        throw new Error(`email ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
export async function emailStewards(cfg, repo, msg, mail = (m) => sendEmail(cfg, m)) {
    const to = stewardAddresses(cfg, repo);
    if (!cfg.email.apiKey || !to.length)
        throw new Error("email is not configured");
    await mail({ ...msg, to });
}
//# sourceMappingURL=email.js.map