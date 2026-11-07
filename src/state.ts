/**
 * Process-wide state: the loaded data repo, the search index, source statuses, and the services.
 * Rebuilds the index on a schedule and whenever the data repo's main moves (poll or webhook).
 */
import fs from "node:fs/promises";
import path from "node:path";
import { Anthropic } from "@anthropic-ai/sdk/client";
import { Agent } from "./agent/agent.js";
import { Budget, RateLimiter } from "./agent/budget.js";
import { QuestionLog } from "./agent/questionlog.js";
import { GapLog } from "./jobs/gaps.js";
import { config, type Config } from "./config.js";
import { SearchIndex } from "./data/index.js";
import { embedAll, loadSources, type EmbeddingStatus, type SourceStatus } from "./data/loader.js";
import { makeEmbedder, type Embedder } from "./search/embed.js";
import { ensureRepo, loadRepo } from "./data/repo.js";
import type { DataRepo } from "./data/types.js";
import { GitHub } from "./github/app.js";

export class AppState {
  repo!: DataRepo;
  index: SearchIndex = new SearchIndex([]);
  statuses: SourceStatus[] = [];
  embedding: EmbeddingStatus = { embedder: "none", records: 0, embedded: 0 };
  readonly embedder?: Embedder;
  /** Files present in the data repo's brand/ folder (logo.webp, mark.webp, favicon.png, ...). */
  brand = new Set<string>();
  /** Parse errors from the latest data repo load; when set, the previous good load stays in service. */
  loadErrors: string[] = [];
  lastBuild?: string;
  readonly budget: Budget;
  readonly log: QuestionLog;
  /** The agent's own search queries from exchanges that ended in "I don't know". */
  readonly gaps: GapLog;
  readonly limiter: RateLimiter;
  readonly github: GitHub;
  agent?: Agent;
  classifier?: Anthropic;
  private building?: Promise<void>;

  constructor(readonly cfg: Config = config) {
    this.budget = new Budget(cfg.cacheDir, cfg.dailyBudgetUsd, cfg.inputUsdPerMillion, cfg.outputUsdPerMillion);
    this.log = new QuestionLog(cfg.cacheDir);
    this.gaps = new GapLog(cfg.cacheDir);
    this.limiter = new RateLimiter(cfg.rateLimitPerTenMinutes);
    this.github = new GitHub(cfg);
    this.embedder = makeEmbedder(cfg.embed);
  }

  async init(opts: { force?: boolean } = {}): Promise<void> {
    await this.budget.load();
    await this.log.load();
    await this.gaps.load();
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
      const next = await loadRepo(root);
      this.loadErrors = next.loadErrors;
      if (next.loadErrors.length && this.repo) {
        console.warn("[state] data repo has errors; keeping the last good load:", next.loadErrors.join("; "));
        return;
      }
      this.repo = next;
      try { this.brand = new Set((await fs.readdir(path.join(root, "brand"))).filter((f) => /^[\w.-]+\.(webp|png|jpg|svg)$/.test(f))); } catch { this.brand = new Set(); }
      const { index, statuses } = await loadSources(this.repo, this.cfg.cacheDir, opts);
      this.index = index;
      this.statuses = statuses;
      this.lastBuild = new Date().toISOString();
      // Vectors attach to the live index as they arrive; words-only search works meanwhile. On a
      // serverless host the first page must not wait on an embedding call, so it runs in the
      // background there (and may be cut short; the next build picks up where the cache left off).
      const embedding = embedAll(index, this.cfg.cacheDir, this.embedder).then((st) => { if (this.index === index) this.embedding = st; return st; });
      if (process.env.VERCEL) embedding.catch((err) => console.warn("[search] embedding failed:", (err as Error).message));
      else await embedding;
    })().finally(() => { this.building = undefined; });
    return this.building;
  }

  private initPromise?: Promise<void>;

  /** Initialize once per process (serverless hosts call this on every request). */
  ready(): Promise<void> {
    if (!this.initPromise) this.initPromise = this.init().catch((err) => { this.initPromise = undefined; throw err; });
    return this.initPromise;
  }

  /** For hosts with no timers: kick off a rebuild in the background when the last one is old. */
  refreshIfStale(): void {
    const every = Math.max(1, this.cfg.repoPollMinutes) * 60_000;
    if (this.lastBuild && Date.now() - Date.parse(this.lastBuild) > every) {
      this.rebuild().catch((err) => console.warn("[state] rebuild failed:", (err as Error).message));
    }
  }

  /** Poll the data repo; rebuild when main moves. Also refreshes expired source caches. */
  startPolling(): void {
    const every = Math.max(1, this.cfg.repoPollMinutes) * 60_000;
    setInterval(() => {
      this.rebuild().catch((err) => console.warn("[state] rebuild failed:", (err as Error).message));
    }, every).unref();
  }
}
