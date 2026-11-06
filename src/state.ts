/**
 * Process-wide state: the loaded data repo, the search index, source statuses, and the services.
 * Rebuilds the index on a schedule and whenever the data repo's main moves (poll or webhook).
 */
import Anthropic from "@anthropic-ai/sdk";
import { Agent } from "./agent/agent.js";
import { Budget, RateLimiter } from "./agent/budget.js";
import { QuestionLog } from "./agent/questionlog.js";
import { config, type Config } from "./config.js";
import { SearchIndex } from "./data/index.js";
import { loadSources, type SourceStatus } from "./data/loader.js";
import { ensureRepo, loadRepo } from "./data/repo.js";
import type { DataRepo } from "./data/types.js";
import { GitHub } from "./github/app.js";

export class AppState {
  repo!: DataRepo;
  index: SearchIndex = new SearchIndex([]);
  statuses: SourceStatus[] = [];
  lastBuild?: string;
  readonly budget: Budget;
  readonly log: QuestionLog;
  readonly limiter: RateLimiter;
  readonly github: GitHub;
  agent?: Agent;
  classifier?: Anthropic;
  private building?: Promise<void>;

  constructor(readonly cfg: Config = config) {
    this.budget = new Budget(cfg.cacheDir, cfg.dailyBudgetUsd, cfg.inputUsdPerMillion, cfg.outputUsdPerMillion);
    this.log = new QuestionLog(cfg.cacheDir);
    this.limiter = new RateLimiter(cfg.rateLimitPerTenMinutes);
    this.github = new GitHub(cfg);
  }

  async init(opts: { force?: boolean } = {}): Promise<void> {
    await this.budget.load();
    await this.log.load();
    if (this.cfg.anthropicConfigured) {
      this.agent = new Agent(this.cfg, this.budget);
      this.classifier = this.agent.client;
    }
    await this.rebuild(opts);
  }

  /** Re-read the repo and every source. Safe to call often; concurrent calls share one build. */
  rebuild(opts: { force?: boolean } = {}): Promise<void> {
    if (this.building) return this.building;
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

  /** Poll the data repo; rebuild when main moves. Also refreshes expired source caches. */
  startPolling(): void {
    const every = Math.max(1, this.cfg.repoPollMinutes) * 60_000;
    setInterval(() => {
      this.rebuild().catch((err) => console.warn("[state] rebuild failed:", (err as Error).message));
    }, every).unref();
  }
}
