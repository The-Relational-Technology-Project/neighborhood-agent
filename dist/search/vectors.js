/**
 * The vector store: one vector per chunk of record text, keyed by a hash of that text, saved as
 * JSON in the cache dir. On every rebuild, only chunks whose hash isn't stored yet get embedded,
 * so a newly merged record costs one small call and everything else is free. That is how new data
 * becomes searchable by meaning by default: nothing to configure per source.
 */
import { createHash } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";
import { dot } from "./embed.js";
export const CHUNK_CHARS = 1200;
export const CHUNK_OVERLAP = 150;
export const MAX_CHUNKS = 8;
export function hashText(text) {
    return createHash("sha1").update(text).digest("hex").slice(0, 24);
}
/** What the embedder sees for a record: a header that names the kind, title, tags, and place, then the text. */
export function chunksFor(r) {
    const header = [`${r.kind}: ${r.title}`, r.tags?.length ? `tags: ${r.tags.join(", ")}` : "", r.location ? `where: ${r.location}` : "", r.date ? `date: ${r.date}` : ""].filter(Boolean).join("\n");
    const body = (r.text ?? "").trim();
    if (header.length + body.length <= CHUNK_CHARS + 300) {
        const text = body ? `${header}\n${body}` : header;
        return [{ hash: hashText(text), text }];
    }
    const chunks = [];
    let i = 0;
    while (i < body.length && chunks.length < MAX_CHUNKS) {
        let end = Math.min(body.length, i + CHUNK_CHARS);
        if (end < body.length) {
            // Prefer to break at a sentence or line end in the last fifth of the window.
            const window = body.slice(i + Math.floor(CHUNK_CHARS * 0.8), end);
            const brk = Math.max(window.lastIndexOf("\n"), window.lastIndexOf(". "));
            if (brk > 0)
                end = i + Math.floor(CHUNK_CHARS * 0.8) + brk + 1;
        }
        const text = `${header}\n${body.slice(i, end).trim()}`;
        chunks.push({ hash: hashText(text), text });
        if (end >= body.length)
            break;
        i = Math.max(end - CHUNK_OVERLAP, i + 1);
    }
    return chunks;
}
export class VectorStore {
    embedder;
    vectors = new Map();
    file;
    constructor(cacheDir, embedder) {
        this.embedder = embedder;
        this.file = path.join(cacheDir, "embeddings", `${embedder.id.replace(/[^a-z0-9._-]/gi, "_")}.json`);
    }
    get size() { return this.vectors.size; }
    get(hash) { return this.vectors.get(hash); }
    async load() {
        try {
            const data = JSON.parse(await fs.readFile(this.file, "utf8"));
            if (data.embedder !== this.embedder.id)
                return;
            for (const [hash, b64] of Object.entries(data.vectors)) {
                const buf = Buffer.from(b64, "base64");
                this.vectors.set(hash, new Float32Array(buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength)));
            }
        }
        catch { /* fresh store */ }
    }
    async save() {
        const vectors = {};
        for (const [hash, v] of this.vectors)
            vectors[hash] = Buffer.from(v.buffer, v.byteOffset, v.byteLength).toString("base64");
        await fs.mkdir(path.dirname(this.file), { recursive: true });
        const tmp = `${this.file}.${process.pid}.tmp`;
        await fs.writeFile(tmp, JSON.stringify({ embedder: this.embedder.id, vectors }));
        await fs.rename(tmp, this.file);
    }
    /**
     * Make sure every chunk has a vector. Embeds only the missing ones, then drops vectors no current
     * record uses (after a successful run, so a failed call never loses what was there).
     */
    async ensure(chunks, opts = {}) {
        const wanted = new Map(chunks.map((c) => [c.hash, c.text]));
        const missing = [...wanted].filter(([h]) => !this.vectors.has(h));
        let embedded = 0;
        let error;
        if (missing.length) {
            try {
                const vecs = await this.embedder.embed(missing.map(([, t]) => t), "document");
                missing.forEach(([h], i) => { if (vecs[i]) {
                    this.vectors.set(h, vecs[i]);
                    embedded++;
                } });
            }
            catch (err) {
                error = err.message;
            }
        }
        if (!error && opts.prune !== false)
            for (const h of [...this.vectors.keys()])
                if (!wanted.has(h))
                    this.vectors.delete(h);
        if (embedded || (!error && opts.prune !== false)) {
            try {
                await this.save();
            }
            catch (err) {
                error ??= `save: ${err.message}`;
            }
        }
        const total = [...wanted.keys()].filter((h) => this.vectors.has(h)).length;
        return { embedded, total, error };
    }
}
/** Per-record vectors, ready for brute-force cosine search. Small corpus; no index structure needed. */
export class DenseIndex {
    entries = [];
    constructor(records, store) {
        for (const r of records) {
            const vecs = chunksFor(r).map((c) => store.get(c.hash)).filter((v) => Boolean(v));
            if (vecs.length)
                this.entries.push({ id: r.id, vecs });
        }
    }
    get size() { return this.entries.length; }
    /** A record's first chunk vector (the header and the start of its text), or undefined. */
    vectorOf(id) {
        return this.entries.find((e) => e.id === id)?.vecs[0];
    }
    /** Records by best chunk similarity, highest first, above the floor. */
    search(query, opts) {
        const out = [];
        for (const e of this.entries) {
            if (opts.allow && !opts.allow(e.id))
                continue;
            let best = -1;
            for (const v of e.vecs) {
                const s = dot(query, v);
                if (s > best)
                    best = s;
            }
            if (best >= opts.minSimilarity)
                out.push({ id: e.id, similarity: best });
        }
        out.sort((a, b) => b.similarity - a.similarity);
        return out.slice(0, opts.limit);
    }
}
//# sourceMappingURL=vectors.js.map