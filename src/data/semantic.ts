/**
 * Search by meaning, beside search by words. Optional: it is on only when the deployment sets an
 * embeddings key (VOYAGE_API_KEY). Without one, search is the full-text index alone, as before.
 *
 * Why: a neighbor or a builder rarely uses the notes' own words. "Somewhere to borrow a ladder"
 * should find the sharing library; "an app for a running club" should find the parkrun. Full-text
 * search misses those and fills the gap with records that share a common word.
 *
 * How: every record is embedded once (vectors are cached on disk by a hash of the text, so a
 * rebuild only embeds what changed). A query is embedded when it is asked. The vectors live in
 * memory; there is no vector database. What leaves the server: the public records' text, and the
 * words of each search. Nothing about who asked.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import type { NRecord } from "./types.js";

export interface EmbedConfig {
  apiKey?: string;
  /** An embeddings endpoint in Voyage's shape ({ model, input, input_type } -> { data: [{ embedding }] }). */
  url: string;
  model: string;
  dims: number;
}

/** Turns texts into vectors. "document" for records, "query" for a search. */
export type Embedder = (texts: string[], as: "document" | "query") => Promise<number[][]>;

export function voyageEmbedder(cfg: EmbedConfig): Embedder {
  return async (texts, as) => {
    const res = await fetch(cfg.url, {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${cfg.apiKey}` },
      body: JSON.stringify({ model: cfg.model, input: texts, input_type: as, output_dimension: cfg.dims }),
      signal: AbortSignal.timeout(as === "query" ? 2500 : 30_000),
    });
    if (!res.ok) throw new Error(`embeddings ${res.status}: ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data: { embedding: number[]; index: number }[] };
    return json.data.sort((a, b) => a.index - b.index).map((d) => d.embedding);
  };
}

/** What a record means, in a few lines: the text that gets embedded. */
export function embedText(r: NRecord): string {
  return [`${r.kind}: ${r.title}`, r.location ?? "", r.tags?.join(", ") ?? "", r.text.slice(0, 1800)].filter(Boolean).join("\n");
}

/** Old photographs are many and their captions are street names; they stay out, as in a general search. */
const embeddable = (r: NRecord) => !(r.kind === "block-note" && r.extra?.kind === "photo") && r.kind !== "correction";

function unit(v: number[]): Float32Array {
  const out = new Float32Array(v);
  let n = 0;
  for (const x of out) n += x * x;
  n = Math.sqrt(n) || 1;
  for (let i = 0; i < out.length; i++) out[i] /= n;
  return out;
}

const BATCH = 96;

export class Semantic {
  private queries = new Map<string, Float32Array>();
  private constructor(private vecs: Map<string, Float32Array>, private embed: Embedder) {}

  get size(): number { return this.vecs.size; }

  /** Embed the records, reusing every vector whose text hasn't changed since the last build. */
  static async build(records: NRecord[], embed: Embedder, opts: { cacheDir?: string; model?: string } = {}): Promise<Semantic> {
    const file = opts.cacheDir ? path.join(opts.cacheDir, `embeddings-${(opts.model ?? "default").replace(/[^\w.-]/g, "_")}.json`) : undefined;
    let cached: Record<string, string> = {};
    if (file) { try { cached = JSON.parse(await fs.readFile(file, "utf8")); } catch { /* first build */ } }
    const todo: { hash: string; text: string }[] = [];
    const wanted = new Map<string, string>();
    for (const r of records.filter(embeddable)) {
      const text = embedText(r);
      const hash = createHash("sha1").update(text).digest("hex");
      wanted.set(r.id, hash);
      if (!cached[hash] && !todo.some((t) => t.hash === hash)) todo.push({ hash, text });
    }
    for (let i = 0; i < todo.length; i += BATCH) {
      const part = todo.slice(i, i + BATCH);
      const out = await embed(part.map((t) => t.text), "document");
      part.forEach((t, j) => { cached[t.hash] = Buffer.from(unit(out[j]).buffer).toString("base64"); });
    }
    const vecs = new Map<string, Float32Array>();
    const kept: Record<string, string> = {};
    for (const [id, hash] of wanted) {
      const b64 = cached[hash];
      if (!b64) continue;
      kept[hash] = b64;
      const buf = Buffer.from(b64, "base64");
      vecs.set(id, new Float32Array(buf.buffer, buf.byteOffset, buf.byteLength / 4));
    }
    if (file && todo.length) {
      await fs.mkdir(path.dirname(file), { recursive: true });
      await fs.writeFile(file, JSON.stringify(kept));
    }
    return new Semantic(vecs, embed);
  }

  /**
   * How close each record is to the query, by id (cosine, -1 to 1). Undefined when the embeddings
   * service is slow or down: the caller falls back to words alone.
   */
  async scores(query: string): Promise<Map<string, number> | undefined> {
    const q = query.trim().toLowerCase().slice(0, 500);
    if (!q || !this.vecs.size) return undefined;
    let qv = this.queries.get(q);
    if (!qv) {
      try {
        qv = unit((await this.embed([q], "query"))[0]);
      } catch (err) {
        console.warn("[semantic] query not embedded; using words alone:", (err as Error).message);
        return undefined;
      }
      if (this.queries.size > 500) this.queries.delete(this.queries.keys().next().value!);
      this.queries.set(q, qv);
    }
    const out = new Map<string, number>();
    for (const [id, v] of this.vecs) {
      if (v.length !== qv.length) continue;
      let dot = 0;
      for (let i = 0; i < v.length; i++) dot += v[i] * qv[i];
      out.set(id, dot);
    }
    return out;
  }
}
