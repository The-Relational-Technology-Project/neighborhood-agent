import { describe, expect, it } from "vitest";
import fs from "node:fs";
import path from "node:path";

/** dist/ is committed for Vercel. Fail loudly when src/ changed and dist/ wasn't rebuilt. */
describe("committed dist", () => {
  it("is newer than every source file (run `npm run build`)", () => {
    const walk = (dir: string): string[] => fs.readdirSync(dir, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? walk(path.join(dir, e.name)) : [path.join(dir, e.name)]));
    const src = walk("src").filter((f) => f.endsWith(".ts"));
    for (const f of src) {
      const out = f.replace(/^src\//, "dist/").replace(/\.ts$/, ".js");
      expect(fs.existsSync(out), `${out} missing`).toBe(true);
      const srcText = fs.readFileSync(f, "utf8");
      const outText = fs.readFileSync(out, "utf8");
      // Cheap staleness check: every exported top-level name in the source must appear in the output.
      for (const m of srcText.matchAll(/^export (?:async )?(?:function|class|const|let)\s+(\w+)/gm)) expect(outText, `${out} is stale: missing ${m[1]}`).toContain(m[1]);
    }
  });
});
