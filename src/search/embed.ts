/**
 * Embedders turn text into vectors so search can match by meaning, not only by shared words.
 *
 * Three providers:
 *   voyage  Voyage AI (Anthropic's recommended embedding partner). Default when VOYAGE_API_KEY is set.
 *   openai  Any OpenAI-compatible /v1/embeddings endpoint (set EMBED_URL to point elsewhere).
 *   hash    A deterministic local embedder (hashed words and character trigrams). No network, no key.
 *           It gives spelling tolerance, not meaning, and on the real corpus it adds noise (shared
 *           letters are not shared sense). For the tests and for trying the pipeline, not for a
 *           deployment: there, set a key or leave search words only.
 *
 * Every vector is L2-normalized, so cosine similarity is a dot product.
 */

export type EmbedKind = "document" | "query";

export interface Embedder {
  /** Stable id; the vector store is keyed by it so a model change never mixes vectors. */
  id: string;
  /** Cosine below this is treated as "no semantic match". Depends on the model. */
  minSimilarity: number;
  embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]>;
}

export interface EmbedConfig {
  provider: "voyage" | "openai" | "hash" | "none";
  model?: string;
  url?: string;
  apiKey?: string;
  minSimilarity?: number;
}

export function normalize(v: Float32Array): Float32Array {
  let n = 0;
  for (let i = 0; i < v.length; i++) n += v[i] * v[i];
  n = Math.sqrt(n);
  if (n > 0) for (let i = 0; i < v.length; i++) v[i] /= n;
  return v;
}

export function dot(a: Float32Array, b: Float32Array): number {
  let s = 0;
  const n = Math.min(a.length, b.length);
  for (let i = 0; i < n; i++) s += a[i] * b[i];
  return s;
}

/** FNV-1a, 32-bit. Stable across runs and platforms. */
function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return h >>> 0;
}

export function words(text: string): string[] {
  return text.toLowerCase().normalize("NFKD").replace(/[̀-ͯ]/g, "").match(/[\p{L}\p{N}]+/gu) ?? [];
}

/**
 * Hashed bag of words and character trigrams. Related spellings land near each other; unrelated
 * text sits near zero. Deterministic, so tests can assert on it.
 */
export class HashEmbedder implements Embedder {
  readonly id: string;
  readonly minSimilarity = 0.3;
  constructor(readonly dims = 512) { this.id = `hash-${dims}`; }

  async embed(texts: string[]): Promise<Float32Array[]> {
    return texts.map((t) => this.one(t));
  }

  one(text: string): Float32Array {
    const v = new Float32Array(this.dims);
    for (const w of words(text)) {
      this.add(v, `w:${w}`, 2);
      const padded = `_${w}_`;
      for (let i = 0; i + 3 <= padded.length; i++) this.add(v, `t:${padded.slice(i, i + 3)}`, 1);
    }
    return normalize(v);
  }

  private add(v: Float32Array, feature: string, weight: number) {
    const h = fnv1a(feature);
    const idx = h % this.dims;
    const sign = (h >>> 31) & 1 ? -1 : 1;
    v[idx] += sign * weight;
  }
}

interface HttpOptions {
  id: string;
  url: string;
  model: string;
  apiKey: string;
  /** Send Voyage's input_type (query/document) with each call. */
  inputType: boolean;
  minSimilarity: number;
  batch?: number;
  /** How many tries a rate-limited or failing call gets before the build gives up on it. */
  maxAttempts?: number;
  fetchFn?: typeof fetch;
}

/** OpenAI-shaped embeddings endpoint (Voyage, OpenAI, and most self-hosted servers speak it). */
export class HttpEmbedder implements Embedder {
  readonly id: string;
  readonly minSimilarity: number;
  private readonly batch: number;
  private readonly maxAttempts: number;
  private readonly fetchFn: typeof fetch;
  constructor(private readonly o: HttpOptions) {
    this.id = o.id;
    this.minSimilarity = o.minSimilarity;
    this.batch = o.batch ?? 48;
    this.maxAttempts = o.maxAttempts ?? 6;
    this.fetchFn = o.fetchFn ?? fetch;
  }

  async embed(texts: string[], kind: EmbedKind): Promise<Float32Array[]> {
    const out: Float32Array[] = [];
    for (let i = 0; i < texts.length; i += this.batch) {
      const slice = texts.slice(i, i + this.batch).map((t) => t.slice(0, 8000));
      out.push(...(await this.call(slice, kind)));
    }
    return out;
  }

  private async call(input: string[], kind: EmbedKind, attempt = 0): Promise<Float32Array[]> {
    const body: Record<string, unknown> = { input, model: this.o.model };
    if (this.o.inputType) body.input_type = kind;
    let res: Response;
    try {
      res = await this.fetchFn(this.o.url, {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${this.o.apiKey}` },
        body: JSON.stringify(body),
        signal: AbortSignal.timeout(30_000),
      });
    } catch (err) {
      if (attempt < 2) { await sleep(500 * 2 ** attempt); return this.call(input, kind, attempt + 1); }
      throw new Error(`embeddings: ${(err as Error).message}`);
    }
    if (res.status === 429 || res.status >= 500) {
      // Rate limited or down: wait what the server asks for, else back off up to a minute, and keep
      // trying for a while. A fresh account with no payment method gets 3 requests a minute.
      if (attempt < this.maxAttempts) {
        const after = Number(res.headers.get("retry-after"));
        const wait = Number.isFinite(after) && after > 0 ? Math.min(90_000, after * 1000) : Math.min(60_000, 5_000 * 2 ** attempt);
        await sleep(wait);
        return this.call(input, kind, attempt + 1);
      }
    }
    if (!res.ok) throw new Error(`embeddings: ${this.o.url} answered ${res.status} ${(await res.text()).slice(0, 200)}`);
    const json = (await res.json()) as { data?: Array<{ index?: number; embedding: number[] }> };
    const data = [...(json.data ?? [])].sort((a, b) => (a.index ?? 0) - (b.index ?? 0));
    if (data.length !== input.length) throw new Error(`embeddings: asked for ${input.length} vectors, got ${data.length}`);
    return data.map((d) => normalize(Float32Array.from(d.embedding)));
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Build the embedder the config asks for, or undefined when semantic search is off. */
export function makeEmbedder(cfg: EmbedConfig, fetchFn?: typeof fetch): Embedder | undefined {
  switch (cfg.provider) {
    case "none":
      return undefined;
    case "hash":
      return new HashEmbedder();
    case "voyage": {
      if (!cfg.apiKey) return undefined;
      const model = cfg.model ?? "voyage-3.5";
      return new HttpEmbedder({ id: `voyage-${model}`, url: cfg.url ?? "https://api.voyageai.com/v1/embeddings", model, apiKey: cfg.apiKey, inputType: true, minSimilarity: cfg.minSimilarity ?? 0.4, fetchFn });
    }
    case "openai": {
      if (!cfg.apiKey) return undefined;
      const model = cfg.model ?? "text-embedding-3-small";
      return new HttpEmbedder({ id: `openai-${model}`, url: cfg.url ?? "https://api.openai.com/v1/embeddings", model, apiKey: cfg.apiKey, inputType: false, minSimilarity: cfg.minSimilarity ?? 0.25, fetchFn });
    }
  }
}
