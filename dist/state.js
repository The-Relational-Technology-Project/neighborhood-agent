import { Agent } from "./agent/agent.js";
import { Budget, RateLimiter } from "./agent/budget.js";
import { QuestionLog } from "./agent/questionlog.js";
import { config } from "./config.js";
import { SearchIndex } from "./data/index.js";
import { loadSources } from "./data/loader.js";
import { ensureRepo, loadRepo } from "./data/repo.js";
import { GitHub } from "./github/app.js";
export class AppState {
    cfg;
    repo;
    index = new SearchIndex([]);
    statuses = [];
    lastBuild;
    budget;
    log;
    limiter;
    github;
    agent;
    classifier;
    building;
    constructor(cfg = config) {
        this.cfg = cfg;
        this.budget = new Budget(cfg.cacheDir, cfg.dailyBudgetUsd, cfg.inputUsdPerMillion, cfg.outputUsdPerMillion);
        this.log = new QuestionLog(cfg.cacheDir);
        this.limiter = new RateLimiter(cfg.rateLimitPerTenMinutes);
        this.github = new GitHub(cfg);
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
            this.repo = await loadRepo(root);
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