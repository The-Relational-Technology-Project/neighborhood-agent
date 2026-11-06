/**
 * All configuration comes from the environment. Nothing secret lives in a repo.
 * The data repo is the one thing every deployment must set: a local path or a git URL.
 */
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
export function loadConfig() {
    const dataRepo = env("DATA_REPO", path.resolve(process.cwd(), "../outer-sunset"));
    let dataRepoGithub = env("DATA_REPO_GITHUB");
    if (!dataRepoGithub) {
        const m = dataRepo.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
        if (m)
            dataRepoGithub = `${m[1]}/${m[2]}`;
    }
    const privateKey = env("GITHUB_APP_PRIVATE_KEY")?.replace(/\\n/g, "\n");
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
        anthropicConfigured: Boolean(env("ANTHROPIC_API_KEY") || env("ANTHROPIC_AUTH_TOKEN")),
    };
}
export const config = loadConfig();
//# sourceMappingURL=config.js.map