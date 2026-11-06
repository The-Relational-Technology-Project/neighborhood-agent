import { describe, expect, it } from "vitest";
import { generateKeyPairSync, createVerify } from "node:crypto";
import { signAppJwt, verifyWebhook } from "../src/github/app.js";

describe("github app auth", () => {
  it("signs an RS256 JWT the app endpoint would accept", () => {
    const { privateKey, publicKey } = generateKeyPairSync("rsa", { modulusLength: 2048 });
    const pem = privateKey.export({ type: "pkcs1", format: "pem" }) as string;
    const jwt = signAppJwt("12345", pem, 1_700_000_000);
    const [h, p, s] = jwt.split(".");
    expect(JSON.parse(Buffer.from(h, "base64url").toString())).toEqual({ alg: "RS256", typ: "JWT" });
    expect(JSON.parse(Buffer.from(p, "base64url").toString())).toEqual({ iat: 1_700_000_000 - 60, exp: 1_700_000_000 + 540, iss: "12345" });
    const v = createVerify("RSA-SHA256");
    v.update(`${h}.${p}`);
    expect(v.verify(publicKey, Buffer.from(s, "base64url"))).toBe(true);
  });

  it("verifies webhook signatures", () => {
    const body = '{"ref":"refs/heads/main"}';
    const { createHmac } = require("node:crypto") as typeof import("node:crypto");
    const sig = "sha256=" + createHmac("sha256", "s3cret").update(body).digest("hex");
    expect(verifyWebhook("s3cret", body, sig)).toBe(true);
    expect(verifyWebhook("s3cret", body + " ", sig)).toBe(false);
    expect(verifyWebhook("s3cret", body, undefined)).toBe(false);
  });
});
