/**
 * Loads the neighborhood data repo: a local directory or a git URL cloned into the cache.
 * The repo is the agent's entire memory. Everything here is plain files a steward can edit by hand.
 */
import fs from "node:fs/promises";
import path from "node:path";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
import YAML from "yaml";
import { parseFrontmatter } from "./frontmatter.js";
import type { Constituent, Correction, DataRepo, FrontmatterDoc, Person, Place, Resource, SourceDef } from "./types.js";

const exec = promisify(execFile);

export function isGitUrl(s: string): boolean {
  return /^(https?:\/\/|git@|ssh:\/\/)/.test(s);
}

async function readText(file: string): Promise<string> {
  try {
    return await fs.readFile(file, "utf8");
  } catch {
    return "";
  }
}

async function listMd(dir: string): Promise<string[]> {
  try {
    const names = await fs.readdir(dir);
    return names.filter((n) => n.endsWith(".md") && !n.startsWith("_") && n.toLowerCase() !== "readme.md").sort();
  } catch {
    return [];
  }
}

async function readDocs(dir: string): Promise<FrontmatterDoc[]> {
  const out: FrontmatterDoc[] = [];
  for (const name of await listMd(dir)) {
    const text = await readText(path.join(dir, name));
    const { data, body } = parseFrontmatter(text);
    out.push({ file: name, data, body: body.trim() });
  }
  return out;
}

function yamlList<T>(text: string, key: string): T[] {
  if (!text.trim()) return [];
  try {
    const doc = YAML.parse(text);
    const list = doc?.[key];
    return Array.isArray(list) ? (list as T[]) : [];
  } catch (err) {
    console.warn(`[repo] could not parse ${key}:`, (err as Error).message);
    return [];
  }
}

/** `key: value` lines in place.md become settings (e.g. `daily_note: off`). */
function parseSettings(placeMd: string): Record<string, string> {
  const settings: Record<string, string> = {};
  for (const line of placeMd.split("\n")) {
    const m = line.match(/^([a-z_]+):\s*(.+?)\s*$/);
    if (m) settings[m[1]] = m[2];
  }
  return settings;
}

/**
 * Ensure the repo is on disk. Returns its root path.
 * A git URL is cloned with git when it is available; otherwise (serverless hosts like Vercel) a
 * public GitHub repo is fetched file by file through the GitHub API into the cache.
 */
export async function ensureRepo(dataRepo: string, cacheDir: string, branch = "main"): Promise<string> {
  if (!isGitUrl(dataRepo)) return path.resolve(dataRepo);
  const root = path.join(cacheDir, "data-repo");
  const gh = dataRepo.match(/github\.com[/:]([^/]+)\/([^/.]+)(?:\.git)?\/?$/);
  const useApi = process.env.DATA_REPO_FETCH === "api" || (gh && !(await hasGit()));
  if (useApi && gh) {
    await fetchRepoViaGithubApi(`${gh[1]}/${gh[2]}`, branch, root);
    return root;
  }
  try {
    await fs.access(path.join(root, ".git"));
    await exec("git", ["-C", root, "fetch", "--depth", "1", "origin", branch], { timeout: 60_000 });
    await exec("git", ["-C", root, "reset", "--hard", `origin/${branch}`], { timeout: 30_000 });
  } catch {
    await fs.rm(root, { recursive: true, force: true });
    await fs.mkdir(cacheDir, { recursive: true });
    await exec("git", ["clone", "--depth", "1", "--branch", branch, dataRepo, root], { timeout: 120_000 });
  }
  return root;
}

async function hasGit(): Promise<boolean> {
  try { await exec("git", ["--version"], { timeout: 5_000 }); return true; } catch { return false; }
}

const GH_HEADERS: Record<string, string> = { Accept: "application/vnd.github+json", "User-Agent": "neighborhood-agent" };

/** GitHub API GET: with GITHUB_TOKEN when set (higher rate limit), falling back to anonymous if that token is rejected. */
async function ghGet(url: string): Promise<Response> {
  const token = process.env.GITHUB_TOKEN;
  if (token) {
    const res = await fetch(url, { headers: { ...GH_HEADERS, Authorization: `Bearer ${token}` }, signal: AbortSignal.timeout(20_000) });
    if (res.status !== 401 && res.status !== 403) return res;
  }
  return fetch(url, { headers: GH_HEADERS, signal: AbortSignal.timeout(20_000) });
}

/**
 * Fetch a public repo's tree at a branch through the GitHub API: one API call for the tree (the
 * tree sha is the version), then raw files, which are not API-rate-limited. Skips when unchanged.
 * Anonymous API calls are limited to 60 an hour per IP; set GITHUB_TOKEN on shared hosts.
 */
export async function fetchRepoViaGithubApi(ownerRepo: string, branch: string, root: string): Promise<string> {
  const treeRes = await ghGet(`https://api.github.com/repos/${ownerRepo}/git/trees/${encodeURIComponent(branch)}?recursive=1`);
  if (!treeRes.ok) throw new Error(`GitHub tree ${ownerRepo}@${branch}: ${treeRes.status}${treeRes.status === 403 ? " (rate limited; set GITHUB_TOKEN)" : ""}`);
  const body = (await treeRes.json()) as { sha: string; tree: Array<{ path: string; type: string; size?: number }> };
  const sha = body.sha;
  const shaFile = path.join(root, ".sha");
  try { if ((await fs.readFile(shaFile, "utf8")).trim() === sha) return sha; } catch { /* first fetch */ }
  const files = body.tree.filter((t) => t.type === "blob" && (t.size ?? 0) < 2_000_000 && !t.path.startsWith(".git"));
  const fresh = `${root}.next`;
  await fs.rm(fresh, { recursive: true, force: true });
  await fs.mkdir(fresh, { recursive: true });
  const queue = [...files];
  const worker = async () => {
    for (let f = queue.shift(); f; f = queue.shift()) {
      const res = await fetch(`https://raw.githubusercontent.com/${ownerRepo}/${encodeURIComponent(branch)}/${f.path}`, { headers: { "User-Agent": "neighborhood-agent" }, signal: AbortSignal.timeout(20_000) });
      if (!res.ok) throw new Error(`raw ${f.path}: ${res.status}`);
      const dest = path.join(fresh, f.path);
      await fs.mkdir(path.dirname(dest), { recursive: true });
      await fs.writeFile(dest, Buffer.from(await res.arrayBuffer()));
    }
  };
  await Promise.all(Array.from({ length: 6 }, worker));
  await fs.writeFile(path.join(fresh, ".sha"), sha);
  await fs.rm(root, { recursive: true, force: true });
  await fs.rename(fresh, root);
  return sha;
}

export async function repoSha(root: string): Promise<string | undefined> {
  try {
    const { stdout } = await exec("git", ["-C", root, "rev-parse", "HEAD"], { timeout: 10_000 });
    return stdout.trim();
  } catch {
    try { return (await fs.readFile(path.join(root, ".sha"), "utf8")).trim(); } catch { return undefined; }
  }
}

export async function loadRepo(root: string): Promise<DataRepo> {
  const placeMd = await readText(path.join(root, "place.md"));
  const sources = yamlList<SourceDef>(await readText(path.join(root, "sources.yml")), "sources");
  const peopleText = await readText(path.join(root, "people.yml"));

  const constituents: Constituent[] = [];
  for (const name of await listMd(path.join(root, "constituents"))) {
    const text = await readText(path.join(root, "constituents", name));
    const { data, body } = parseFrontmatter(text);
    constituents.push({
      slug: name.replace(/\.md$/, ""),
      name: String(data.name ?? name.replace(/\.md$/, "")),
      kind: String(data.kind ?? ""),
      feeds: Array.isArray(data.feeds) ? data.feeds.map(String) : [],
      advocates: Array.isArray(data.advocates) ? data.advocates.map(String) : [],
      body: body.trim(),
      frontmatter: data,
    });
  }

  const corrections: Correction[] = (await readDocs(path.join(root, "corrections"))).map((d) => ({
    target: String(d.data.target ?? ""),
    field: String(d.data.field ?? "other"),
    was: d.data.was === undefined ? undefined : String(d.data.was),
    now: String(d.data.now ?? ""),
    how_known: d.data.how_known === undefined ? undefined : String(d.data.how_known),
    by: d.data.by === undefined ? undefined : String(d.data.by),
    date: String(d.data.date ?? ""),
    note: d.body || undefined,
    file: d.file,
  }));

  return {
    root,
    sha: await repoSha(root),
    placeMd,
    stewardsMd: await readText(path.join(root, "STEWARDS.md")),
    readmeMd: await readText(path.join(root, "README.md")),
    sources,
    constituents,
    people: yamlList<Person>(peopleText, "people"),
    orgs: yamlList<Person>(peopleText, "orgs"),
    places: yamlList<Place>(await readText(path.join(root, "places.yml")), "places"),
    resources: yamlList<Resource>(await readText(path.join(root, "resources.yml")), "resources"),
    events: await readDocs(path.join(root, "events")),
    proposals: await readDocs(path.join(root, "proposals")),
    corrections,
    archive: await readDocs(path.join(root, "archive")),
    questionLogMd: await readText(path.join(root, "log", "questions.md")),
    settings: parseSettings(placeMd),
  };
}
