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
