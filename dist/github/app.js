/**
 * GitHub App auth and the few REST calls the agent needs: open a PR, list PRs by label, open an
 * issue, read the default branch sha. No Octokit; a JWT signed with node:crypto and fetch.
 * Public reads (PR list, branch sha) work without the app, at GitHub's anonymous rate limit.
 */
import { createSign, createHmac, timingSafeEqual } from "node:crypto";
const API = "https://api.github.com";
export function signAppJwt(appId, privateKeyPem, now = Math.floor(Date.now() / 1000)) {
    const b64 = (o) => Buffer.from(JSON.stringify(o)).toString("base64url");
    const head = b64({ alg: "RS256", typ: "JWT" });
    const payload = b64({ iat: now - 60, exp: now + 9 * 60, iss: appId });
    const signer = createSign("RSA-SHA256");
    signer.update(`${head}.${payload}`);
    const sig = signer.sign(privateKeyPem).toString("base64url");
    return `${head}.${payload}.${sig}`;
}
export function verifyWebhook(secret, body, signatureHeader) {
    if (!signatureHeader)
        return false;
    const expected = "sha256=" + createHmac("sha256", secret).update(body).digest("hex");
    const a = Buffer.from(expected), b = Buffer.from(signatureHeader);
    return a.length === b.length && timingSafeEqual(a, b);
}
export class GitHub {
    cfg;
    tokenCache;
    repo;
    constructor(cfg) {
        this.cfg = cfg;
        this.repo = cfg.dataRepoGithub ?? "";
    }
    get configured() {
        return Boolean(this.repo && this.cfg.github.appId && this.cfg.github.privateKey);
    }
    get repoUrl() {
        return this.repo ? `https://github.com/${this.repo}` : this.cfg.dataRepo;
    }
    async installationToken() {
        if (this.tokenCache && this.tokenCache.exp > Date.now() + 60_000)
            return this.tokenCache.token;
        const jwt = signAppJwt(this.cfg.github.appId, this.cfg.github.privateKey);
        let installationId = this.cfg.github.installationId;
        if (!installationId) {
            const [owner, name] = this.repo.split("/");
            const res = await fetch(`${API}/repos/${owner}/${name}/installation`, { headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" } });
            if (!res.ok)
                throw new Error(`GitHub App is not installed on ${this.repo} (${res.status})`);
            installationId = String((await res.json()).id);
        }
        const res = await fetch(`${API}/app/installations/${installationId}/access_tokens`, { method: "POST", headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json" } });
        if (!res.ok)
            throw new Error(`installation token failed (${res.status})`);
        const body = (await res.json());
        this.tokenCache = { token: body.token, exp: Date.parse(body.expires_at) };
        return body.token;
    }
    async api(path, init = {}) {
        const headers = new Headers(init.headers);
        headers.set("Accept", "application/vnd.github+json");
        headers.set("User-Agent", "neighborhood-agent");
        // The App's token whenever the App is connected (reads too: anonymous reads share a small rate
        // limit per server IP); otherwise a read-only GITHUB_TOKEN if one is set.
        if (this.configured)
            headers.set("Authorization", `Bearer ${await this.installationToken()}`);
        else if (process.env.GITHUB_TOKEN)
            headers.set("Authorization", `Bearer ${process.env.GITHUB_TOKEN}`);
        let res = await fetch(`${API}${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) });
        if ((res.status === 401 || res.status === 403) && headers.has("Authorization") && init.auth === false && !this.configured) {
            headers.delete("Authorization"); // a bad read token shouldn't break public reads
            res = await fetch(`${API}${path}`, { ...init, headers, signal: AbortSignal.timeout(20_000) });
        }
        if (res.status === 403 && /rate limit/i.test(await res.clone().text()))
            throw new Error("GitHub is rate-limiting anonymous reads from this server; set GITHUB_TOKEN (any read-only token) in Vercel");
        if (!res.ok)
            throw new Error(`GitHub ${init.method ?? "GET"} ${path}: ${res.status} ${(await res.text()).slice(0, 200)}`);
        return (await res.json());
    }
    checked;
    /** Can the App actually reach the data repo? Cached for ten minutes. Never writes. */
    async check() {
        if (!this.configured)
            return { ok: false, detail: "GITHUB_APP_ID or GITHUB_APP_PRIVATE_KEY isn't set" };
        if (this.checked && Date.now() - this.checked.at < 10 * 60_000)
            return this.checked;
        let result;
        try {
            await this.installationToken();
            const jwt = signAppJwt(this.cfg.github.appId, this.cfg.github.privateKey);
            const res = await fetch(`${API}/repos/${this.repo}/installation`, { headers: { Authorization: `Bearer ${jwt}`, Accept: "application/vnd.github+json", "User-Agent": "neighborhood-agent" }, signal: AbortSignal.timeout(20_000) });
            if (!res.ok)
                throw new Error(`GitHub App is not installed on ${this.repo} (${res.status})`);
            const perms = (await res.json()).permissions ?? {};
            const missing = ["contents", "pull_requests"].filter((k) => perms[k] !== "write");
            result = missing.length
                ? { ok: false, detail: `the App is installed on ${this.repo} but needs read and write on ${missing.map((k) => k.replace("_", " ")).join(" and ")}; change it on the App's Permissions page, then accept the new permissions on the installation` }
                : { ok: true, detail: `connected to ${this.repo} (contents and pull requests: write${perms.issues === "write" ? ", issues: write" : ""})` };
        }
        catch (err) {
            const m = err.message;
            const pk = this.cfg.github.privateKey ?? "";
            const shape = `key has ${pk.includes("-----BEGIN") ? "a BEGIN line" : "no BEGIN line"}, ${pk.includes("-----END") ? "an END line" : "no END line"}, ${pk.replace(/-----[^-]+-----/g, "").replace(/\s+/g, "").length} key characters`;
            result = { ok: false, detail: /PEM|key|asn1|DECODER|unsupported/i.test(m) ? `the private key didn't load (${m.split("\n")[0].slice(0, 80)}; ${shape}). Paste the whole .pem file again, BEGIN to END lines included` : /not installed/i.test(m) ? `the App isn't installed on ${this.repo}; install it from the App's page` : m.slice(0, 200) };
        }
        this.checked = { at: Date.now(), ...result };
        return result;
    }
    async branchSha(branch) {
        const r = await this.api(`/repos/${this.repo}/git/ref/heads/${branch}`, { auth: false });
        return r.object.sha;
    }
    async openPr(input) {
        if (!this.configured)
            throw new Error("GitHub App not configured");
        const baseSha = await this.branchSha(input.base);
        const branch = `agent/${input.labels[0] ?? "change"}/${Date.now().toString(36)}`;
        await this.api(`/repos/${this.repo}/git/refs`, { method: "POST", body: JSON.stringify({ ref: `refs/heads/${branch}`, sha: baseSha }) });
        let sha;
        try {
            const existing = await this.api(`/repos/${this.repo}/contents/${input.path}?ref=${encodeURIComponent(branch)}`);
            sha = existing.sha;
        }
        catch { /* new file */ }
        await this.api(`/repos/${this.repo}/contents/${input.path}`, {
            method: "PUT",
            body: JSON.stringify({ message: input.title, content: Buffer.from(input.content).toString("base64"), branch, ...(sha ? { sha } : {}) }),
        });
        const pr = await this.api(`/repos/${this.repo}/pulls`, {
            method: "POST",
            body: JSON.stringify({ title: input.title, head: branch, base: input.base, body: input.body }),
        });
        try {
            await this.api(`/repos/${this.repo}/issues/${pr.number}/labels`, { method: "POST", body: JSON.stringify({ labels: input.labels }) });
        }
        catch { /* labels are nice to have */ }
        return { url: pr.html_url, number: pr.number };
    }
    async listPrs(state = "open", label) {
        if (!this.repo)
            return [];
        const list = await this.api(`/repos/${this.repo}/pulls?state=${state}&per_page=50`, { auth: false });
        return list
            .map((p) => ({ number: p.number, title: p.title, url: p.html_url, labels: p.labels.map((l) => l.name), state: p.state, merged: Boolean(p.merged_at), created_at: p.created_at, body: p.body ?? "" }))
            .filter((p) => !label || p.labels.includes(label));
    }
    async openIssue(input) {
        if (!this.configured)
            throw new Error("GitHub App not configured");
        const r = await this.api(`/repos/${this.repo}/issues`, { method: "POST", body: JSON.stringify(input) });
        return { url: r.html_url };
    }
}
//# sourceMappingURL=app.js.map