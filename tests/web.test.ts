import { describe, expect, it } from "vitest";
import { md, esc } from "../src/web/html.js";

describe("html helpers", () => {
  it("escapes and renders the markdown subset", () => {
    expect(esc("<b>&")).toBe("&lt;b&gt;&amp;");
    const html = md("# Title\n\nSome **bold** and `code` and [a link](https://x.org).\n\n- one\n- two\n\n| a | b |\n| --- | --- |\n| 1 | 2 |\n");
    expect(html).toContain("<h2>Title</h2>");
    expect(html).toContain("<b>bold</b>");
    expect(html).toContain('<a href="https://x.org">a link</a>');
    expect(html).toContain("<ul><li>one</li><li>two</li></ul>");
    expect(html).toContain("<table><tr><td>a</td><td>b</td></tr>");
    expect(md("<script>x</script>")).not.toContain("<script>");
  });
});

describe("neighbor-facing copy", () => {
  it("never mentions pull requests, GitHub, or the repo on neighbor pages", async () => {
    const { AppState } = await import("../src/state.js");
    const pages = await import("../src/web/pages.js");
    const { FIXTURE, tmpCache } = await import("./helpers.js");
    process.env.DATA_REPO = FIXTURE;
    const cfg = { ...(await import("../src/config.js")).loadConfig(), dataRepo: FIXTURE, cacheDir: await tmpCache() };
    const fs = await import("node:fs/promises");
    const { OUTER_SUNSET } = await import("./helpers.js");
    let root = FIXTURE;
    try { await fs.access(OUTER_SUNSET); root = OUTER_SUNSET; } catch { /* fixture only */ }
    const state = new AppState({ ...cfg, dataRepo: root });
    await state.rebuild();
    const neighborPages = [pages.homePage(state, []), pages.aboutPage(state), pages.sourcesPage(state, []), pages.proposalsPage(state, []), pages.correctPage(state, []), pages.contactPage(state, "email")];
    for (const html of neighborPages) {
      const visible = html.replace(/<script[\s\S]*?<\/script>|<style[\s\S]*?<\/style>|<[^>]+>/g, " ");
      expect(visible).not.toMatch(/pull request|\bPRs?\b|\brepo\b|GitHub|\.ya?ml\b|\.md\b/i);
    }
    const desk = pages.stewardsPage(state, [], undefined, { github: false, email: false, emailTo: [], spent: 0, limit: 5, loadErrors: [], log: {}, week: "2026-W45" });
    expect(desk).toContain("noindex");
    expect(desk).toContain("GitHub App");
  });
});
