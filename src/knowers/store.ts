/**
 * Where a neighbor's name and email live once they've offered to be asked. Never in the data repo
 * (it's public), never in the search index, never in front of the model. The public note about
 * them carries only an opaque ref; this store turns a ref back into an address at send time.
 *
 * Two stores:
 *  - resend: the contact is kept by the same mail service that delivers the question, so the
 *    address exists in one place only. Needs a RESEND_API_KEY with full access.
 *  - file: a JSON file in the cache directory, for a server with a disk (and for tests).
 */
import { randomUUID } from "node:crypto";
import fs from "node:fs/promises";
import path from "node:path";

export interface Contact { ref: string; name: string; email: string }

export interface ContactStore {
  readonly kind: "resend" | "file";
  put(c: { name: string; email: string }): Promise<string>;
  get(ref: string): Promise<Contact | undefined>;
  remove(ref: string): Promise<void>;
  /** Can the store be reached with the credentials it has? Never writes. */
  check(): Promise<{ ok: boolean; detail: string }>;
}

export class FileContactStore implements ContactStore {
  readonly kind = "file" as const;
  private file: string;
  constructor(cacheDir: string) { this.file = path.join(cacheDir, "neighbor-contacts.json"); }
  private async read(): Promise<Record<string, { name: string; email: string }>> {
    try { return JSON.parse(await fs.readFile(this.file, "utf8")); } catch { return {}; }
  }
  private async write(all: Record<string, { name: string; email: string }>): Promise<void> {
    await fs.mkdir(path.dirname(this.file), { recursive: true });
    await fs.writeFile(this.file, JSON.stringify(all, null, 2), { mode: 0o600 });
  }
  async put(c: { name: string; email: string }): Promise<string> {
    const all = await this.read();
    const ref = `f_${randomUUID()}`;
    all[ref] = { name: c.name, email: c.email };
    await this.write(all);
    return ref;
  }
  async get(ref: string): Promise<Contact | undefined> {
    const hit = (await this.read())[ref];
    return hit ? { ref, ...hit } : undefined;
  }
  async remove(ref: string): Promise<void> {
    const all = await this.read();
    if (ref in all) { delete all[ref]; await this.write(all); }
  }
  async check() { return { ok: true, detail: "kept in a file on this server's disk" }; }
}

/**
 * Resend contacts (https://resend.com/docs/api-reference/contacts). A ref is `r1_<contact id>` when
 * Knowy created the contact and `r0_<contact id>` when the address was already in the account
 * (say, on a newsletter list): those are never changed or deleted from here.
 * New contacts are created unsubscribed, which keeps them out of every broadcast; a relayed
 * question is a transactional email, and those are still delivered.
 */
export class ResendContactStore implements ContactStore {
  readonly kind = "resend" as const;
  constructor(private apiKey: string, private http: typeof fetch = fetch) {}

  private call(method: string, p: string, body?: unknown): Promise<Response> {
    return this.http(`https://api.resend.com${p}`, {
      method,
      headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json", "User-Agent": "neighborhood-agent" },
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(15_000),
    });
  }

  async put(c: { name: string; email: string }): Promise<string> {
    const existing = await this.call("GET", `/contacts/${encodeURIComponent(c.email)}`);
    if (existing.ok) {
      const hit = (await existing.json()) as { id?: string };
      if (hit.id) return `r0_${hit.id}`;
    } else if (existing.status === 401 || existing.status === 403) {
      throw new Error(`contact store ${existing.status}: ${(await existing.text()).slice(0, 160)}`);
    }
    const res = await this.call("POST", "/contacts", { email: c.email, first_name: c.name, unsubscribed: true });
    if (!res.ok) throw new Error(`contact store ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const made = (await res.json()) as { id?: string };
    if (!made.id) throw new Error("contact store returned no id");
    return `r1_${made.id}`;
  }

  async get(ref: string): Promise<Contact | undefined> {
    const id = ref.match(/^r[01]_([\w-]+)$/)?.[1];
    if (!id) return undefined;
    const res = await this.call("GET", `/contacts/${id}`);
    if (res.status === 404) return undefined;
    if (!res.ok) throw new Error(`contact store ${res.status}: ${(await res.text()).slice(0, 160)}`);
    const c = (await res.json()) as { email?: string; first_name?: string };
    return c.email ? { ref, email: c.email, name: c.first_name ?? "" } : undefined;
  }

  async remove(ref: string): Promise<void> {
    const id = ref.match(/^r1_([\w-]+)$/)?.[1];
    if (!id) return; // not ours to delete
    const res = await this.call("DELETE", `/contacts/${id}`);
    if (!res.ok && res.status !== 404) throw new Error(`contact store ${res.status}: ${(await res.text()).slice(0, 160)}`);
  }

  private checked?: { at: number; ok: boolean; detail: string };
  async check(): Promise<{ ok: boolean; detail: string }> {
    if (this.checked && Date.now() - this.checked.at < 10 * 60_000) return this.checked;
    let result: { ok: boolean; detail: string };
    try {
      const res = await this.call("GET", "/contacts?limit=1");
      result = res.ok
        ? { ok: true, detail: "kept as contacts in Resend, outside every broadcast" }
        : { ok: false, detail: /restricted_api_key/.test(await res.text()) ? "RESEND_API_KEY can only send. Neighbors' contacts need a key with full access" : `Resend answered ${res.status}` };
    } catch (err) { result = { ok: false, detail: (err as Error).message }; }
    this.checked = { at: Date.now(), ...result };
    return result;
  }
}

export function makeContactStore(opts: { store?: string; resendKey?: string; cacheDir: string }): ContactStore {
  const want = opts.store ?? (opts.resendKey ? "resend" : "file");
  return want === "resend" && opts.resendKey ? new ResendContactStore(opts.resendKey) : new FileContactStore(opts.cacheDir);
}
