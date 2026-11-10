/**
 * Process-wide state: the loaded data repo, the search index, source statuses, and the services.
 * Rebuilds the index on a schedule and whenever the data repo's main moves (poll or webhook).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Agent } from "./agent/agent.js";
import { Budget, RateLimiter } from "./agent/budget.js";
import { QuestionLog } from "./agent/questionlog.js";
import { config } from "./config.js";
import { SearchIndex } from "./data/index.js";
import { loadSources } from "./data/loader.js";
import { ensureRepo, loadRepo } from "./data/repo.js";
import { GitHub } from "./github/app.js";
import { makeContactStore } from "./knowers/store.js";
import { sendEmail } from "./notify/email.js";
export class AppState {
    cfg;
    repo;
    index = new SearchIndex([]);
    statuses = [];
    /** Files present in the data repo's brand/ folder (logo.webp, mark.webp, favicon.png, ...). */
    brand = new Set();
    /** Parse errors from the latest data repo load; when set, the previous good load stays in service. */
    loadErrors = [];
    lastBuild;
    budget;
    log;
    limiter;
    github;
    /** Private names and addresses of neighbors who offered to be asked. Never indexed. */
    contacts;
    /** Sends one email. Swappable, so tests can read the mail instead of sending it. */
    mail;
    agent;
    classifier;
    building;
    constructor(cfg = config) {
        this.cfg = cfg;
        this.budget = new Budget(cfg.cacheDir, cfg.dailyBudgetUsd, cfg.inputUsdPerMillion, cfg.outputUsdPerMillion);
        this.log = new QuestionLog(cfg.cacheDir);
        this.limiter = new RateLimiter(cfg.rateLimitPerTenMinutes);
        this.github = new GitHub(cfg);
        this.contacts = makeContactStore({ store: cfg.contactStore, resendKey: cfg.email.apiKey, cacheDir: cfg.cacheDir });
        this.mail = (msg) => sendEmail(cfg, msg);
    }
    async init(opts = {}) {
        await this.budget.load();
        await this.log.load();
        if (this.cfg.anthropicConfigured) {
            this.agent = new Agent(this.cfg, this.budget);
            this.classifier = this.agent.client;
        }
        await this.rebuild(opts);
    }
    /** Re-read the repo and every source. Safe to call often; concurrent calls share one build. */
    rebuild(opts = {}) {
        if (this.building)
            return this.building;
        this.building = (async () => {
            const root = await ensureRepo(this.cfg.dataRepo, this.cfg.cacheDir, this.cfg.dataRepoBranch);
            const next = await loadRepo(root);
            this.loadErrors = next.loadErrors;
            if (next.loadErrors.length && this.repo) {
                console.warn("[state] data repo has errors; keeping the last good load:", next.loadErrors.join("; "));
                return;
            }
            this.repo = next;
            try {
                this.brand = new Set((await fs.readdir(path.join(root, "brand"))).filter((f) => /^[\w.-]+\.(webp|png|jpg|svg)$/.test(f)));
            }
            catch {
                this.brand = new Set();
            }
            const { index, statuses } = await loadSources(this.repo, this.cfg.cacheDir, opts);
            this.index = index;
            this.statuses = statuses;
            this.lastBuild = new Date().toISOString();
        })().finally(() => { this.building = undefined; });
        return this.building;
    }
    initPromise;
    /** Initialize once per process (serverless hosts call this on every request). */
    ready() {
        if (!this.initPromise)
            this.initPromise = this.init().catch((err) => { this.initPromise = undefined; throw err; });
        return this.initPromise;
    }
    /** For hosts with no timers: kick off a rebuild in the background when the last one is old. */
    refreshIfStale() {
        const every = Math.max(1, this.cfg.repoPollMinutes) * 60_000;
        if (this.lastBuild && Date.now() - Date.parse(this.lastBuild) > every) {
            this.rebuild().catch((err) => console.warn("[state] rebuild failed:", err.message));
        }
    }
    /** Poll the data repo; rebuild when main moves. Also refreshes expired source caches. */
    startPolling() {
        const every = Math.max(1, this.cfg.repoPollMinutes) * 60_000;
        setInterval(() => {
            this.rebuild().catch((err) => console.warn("[state] rebuild failed:", err.message));
        }, every).unref();
    }
}
//# sourceMappingURL=state.js.map