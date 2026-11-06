/**
 * Email to the stewards, through Resend's HTTP API (https://resend.com/docs/api-reference).
 * RESEND_API_KEY turns it on. Recipients: STEWARD_EMAILS (comma-separated), else every address in
 * the data repo's STEWARDS.md. Sender: EMAIL_FROM, on a domain verified in Resend.
 */
import type { Config } from "../config.js";
import type { DataRepo } from "../data/types.js";

export function stewardAddresses(cfg: Config, repo: DataRepo): string[] {
  if (cfg.email.to.length) return cfg.email.to;
  return [...new Set([...repo.stewardsMd.matchAll(/[\w.+-]+@[\w-]+(?:\.[\w-]+)+/g)].map((m) => m[0]))];
}

export function emailConfigured(cfg: Config, repo: DataRepo): boolean {
  return Boolean(cfg.email.apiKey && stewardAddresses(cfg, repo).length);
}

export async function emailStewards(cfg: Config, repo: DataRepo, msg: { subject: string; text: string; replyTo?: string }): Promise<void> {
  const to = stewardAddresses(cfg, repo);
  if (!cfg.email.apiKey || !to.length) throw new Error("email is not configured");
  const res = await fetch("https://api.resend.com/emails", {
    method: "POST",
    headers: { Authorization: `Bearer ${cfg.email.apiKey}`, "Content-Type": "application/json" },
    body: JSON.stringify({ from: cfg.email.from, to, subject: msg.subject, text: msg.text, ...(msg.replyTo ? { reply_to: msg.replyTo } : {}) }),
    signal: AbortSignal.timeout(15_000),
  });
  if (!res.ok) throw new Error(`email ${res.status}: ${(await res.text()).slice(0, 200)}`);
}
