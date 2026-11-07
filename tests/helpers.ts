import path from "node:path";
import { loadRepo } from "../src/data/repo.js";
import { loadSources } from "../src/data/loader.js";
import os from "node:os";
import fs from "node:fs/promises";
import { HashEmbedder } from "../src/search/embed.js";

export const FIXTURE = path.resolve(process.cwd(), "fixtures/elsewhere");
export const OUTER_SUNSET = process.env.OUTER_SUNSET_REPO ?? path.resolve(process.cwd(), "../outer-sunset");

export async function tmpCache(): Promise<string> {
  return await fs.mkdtemp(path.join(os.tmpdir(), "nagent-test-"));
}

export async function loadFixture() {
  const repo = await loadRepo(FIXTURE);
  const cacheDir = await tmpCache();
  const { index, statuses, embedding } = await loadSources(repo, cacheDir, { embedder: new HashEmbedder() });
  return { repo, index, statuses, embedding, cacheDir };
}
