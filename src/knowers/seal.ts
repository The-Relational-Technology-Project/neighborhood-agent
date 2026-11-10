/**
 * Sealed links. A confirm, answer, or stop link carries its own state, encrypted and dated, so the
 * server keeps nothing between the email and the click. AES-256-GCM with a key derived from the
 * same secret that signs drafts; the purpose is bound in, so one kind of link can't pass as another.
 */
import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import { secret } from "../agent/drafts.js";

export type SealPurpose = "offer" | "ask" | "answer" | "stop";

/** Without a real secret the key would be guessable, so everything sealed stays off. */
export function sealReady(): boolean {
  return Boolean(process.env.DRAFT_SECRET || process.env.ANTHROPIC_API_KEY);
}

const key = () => createHash("sha256").update(`knowers:${secret()}`).digest();

export function seal(purpose: SealPurpose, data: unknown, ttlMs: number, now = Date.now()): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  cipher.setAAD(Buffer.from(purpose));
  const body = Buffer.concat([cipher.update(JSON.stringify({ d: data, x: now + ttlMs }), "utf8"), cipher.final()]);
  return Buffer.concat([iv, cipher.getAuthTag(), body]).toString("base64url");
}

export function open<T>(purpose: SealPurpose, token: string | undefined, now = Date.now()): T | undefined {
  if (!token || !sealReady()) return undefined;
  try {
    const raw = Buffer.from(token, "base64url");
    if (raw.length < 29) return undefined;
    const decipher = createDecipheriv("aes-256-gcm", key(), raw.subarray(0, 12));
    decipher.setAAD(Buffer.from(purpose));
    decipher.setAuthTag(raw.subarray(12, 28));
    const { d, x } = JSON.parse(Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()]).toString("utf8")) as { d: T; x: number };
    return typeof x === "number" && x > now ? d : undefined;
  } catch {
    return undefined;
  }
}
