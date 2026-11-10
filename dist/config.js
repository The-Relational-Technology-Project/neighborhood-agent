/**
 * All configuration comes from the environment. Nothing secret lives in a repo.
 * The data repo is the one thing every deployment must set: a local path or a git URL.
 */
import { createPrivateKey } from "node:crypto";
import path from "node:path";
function env(name, fallback) {
    const v = process.env[name];
    return v === undefined || v === "" ? fallback : v;
}
function num(name, fallback) {
    const v = env(name);
    const n = v === undefined ? NaN : Number(v);
    return Number.isFinite(n) ? n : fallback;
}
/**
 * A PEM key as pasted into a hosting dashboard: line breaks may arrive as spaces or literal "\n",
 * the value may be wrapped in quotes. Rebuild it: header line, base64 body in 64-char lines, footer.
 */
export function normalizePem(raw) {
    if (!raw)
        return undefined;
    const v = raw.trim().replace(/^["']|["']$/g, "").replace(/\\n/g, "\n").replace(/\r/g, "");
    const m = v.match(/-----BEGIN ([A-Z ]+)-----([\s\S]*?)-----END \1-----/);
    if (!m) {
        // Just the key body, without its BEGIN and END lines: wrap it in whichever label it parses as.
        const body = v.replace(/\s+/g, "");
        if (!/^[A-Za-z0-9+/=]{500,}$/.test(body))
            return v;
        const lines = body.match(/.{1,64}/g)?.join("\n") ?? "";
        for (const label of ["RSA PRIVATE KEY", "PRIVATE KEY"]) {
            const pem = `-----BEGIN ${label}-----\n${lines}\n-----END ${label}-----\n`;
            try {
                createPrivateKey(pem);
                return pem;
            }
            catch { /* try the next label */ }
        }
        return v;
    }
    const body = m[2].replace(/\s+/g, "");
    return `-----BEGIN ${m[1]}-----\n${body.match(/.{1,64}/g)?.join("\n") ?? ""}\n-----END ${m[1]}-----\n`;
}
export function loadConfig() {
    const dataRepo = env("DATA_REPO", path.resolve(process.cwd(), "../outer-sunset"));
    let dataRepoGithub = env("DATA_REPO_GITHUB");
    if (!dataRepoGithub) {
        const m = dataRepo.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
        if (m)
            dataRepoGithub = `${m[1]}/${m[2]}`;
    }
    const privateKey = normalizePem(env("GITHUB_APP_PRIVATE_KEY"));
    return {
        dataRepo,
        dataRepoGithub,
        dataRepoBranch: env("DATA_REPO_BRANCH", "main"),
        cacheDir: env("CACHE_DIR", process.env.VERCEL ? "/tmp/neighborhood-agent-cache" : path.resolve(process.cwd(), ".cache")),
        port: num("PORT", 3000),
        model: env("MODEL", "claude-haiku-5-5"),
        classifyModel: env("CLASSIFY_MODEL", env("MODEL", "claude-haiku-5-5")),
        maxTokens: num("MAX_TOKENS", 1200),
        dailyBudgetUsd: num("DAILY_BUDGET_USD", 5),
        inputUsdPerMillion: num("INPUT_USD_PER_MILLION", 0.1),
        outputUsdPerMillion: num("OUTPUT_USD_PER_MILLION", 0.5),
        rateLimitPerTenMinutes: num("RATE_LIMIT_PER_TEN_MINUTES", 20),
        repoPollMinutes: num("REPO_POLL_MINUTES", 5),
        github: {
            appId: env("GITHUB_APP_ID"),
            privateKey,
            installationId: env("GITHUB_INSTALLATION_ID"),
            webhookSecret: env("GITHUB_WEBHOOK_SECRET"),
        },
        siteUrl: env("SITE_URL"),
        email: {
            apiKey: env("RESEND_API_KEY"),
            from: env("EMAIL_FROM", "Knowy Plover <knowy@relationaltechproject.org>"),
            to: (env("STEWARD_EMAILS") ?? "").split(",").map((s) => s.trim()).filter(Boolean),
        },
        contactStore: env("CONTACT_STORE"),
        anthropicConfigured: Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN")),
    };
}
export const config = loadConfig();
//# sourceMappingURL=config.js.map