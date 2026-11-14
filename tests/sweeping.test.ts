import { describe, expect, it } from "vitest";
import type { Block } from "../src/data/types.js";

const block: Block = { id: "46-moraga", name: "46th Ave, Moraga to Noriega", streets: ["46th Ave", "Moraga", "Noriega"], lat: 37.75, lng: -122.5 };
const row = (corridor: string, limits: string, side: string, weekday: string, weeks: string, extra: Record<string, string> = {}) => ({
  corridor, limits, blockside: side, weekday, fullname: `${weekday} ${weeks}`, fromhour: "12", tohour: "14",
  week1: weeks.includes("1") ? "1" : "0", week2: weeks.includes("2") ? "1" : "0", week3: weeks.includes("3") ? "1" : "0", week4: weeks.includes("4") ? "1" : "0", week5: weeks.includes("5") ? "1" : "0", holidays: "0", ...extra,
});
const rows = [
  row("46th Ave", "Moraga St  -  Noriega St", "East", "Mon", "13"),
  row("46th Ave", "Moraga St  -  Noriega St", "West", "Thu", "135"),
  row("46th Ave", "Lawton St  -  Moraga St", "East", "Mon", "13"),
  row("6th Ave", "Moraga St  -  Noriega St", "East", "Tue", "24"),
  row("46th Ave", "Noriega St  -  Moraga St", "West", "Thu", "135"),
];

describe("street cleaning for a block", () => {
  it("keeps only the rows for this block, whichever way the city lists the cross streets", async () => {
    const { rowsForBlock, toSides } = await import("../src/blocks/sweeping.js");
    const mine = rowsForBlock(rows, block);
    expect(mine).toHaveLength(3);
    expect(mine.every((r) => r.corridor === "46th Ave")).toBe(true);
    const sides = toSides(mine, "2026-11-14");
    expect(sides.map((s) => `${s.side} ${s.weekday} ${s.weeks.join("")}`)).toEqual(["East Mon 13", "West Thu 135"]);
    expect(sides[0]).toMatchObject({ from: 12, to: 14, holidays: false });
  });

  it("works out the next day it is due", async () => {
    const { nextSweep } = await import("../src/blocks/sweeping.js");
    // Saturday 14 November 2026. The third Monday is the 16th; the third Thursday is the 19th.
    expect(nextSweep("Mon", [1, 3], "2026-11-14")).toBe("2026-11-16");
    expect(nextSweep("Thu", [1, 3, 5], "2026-11-14")).toBe("2026-11-19");
    // Due today counts as next.
    expect(nextSweep("Mon", [1, 3], "2026-11-16")).toBe("2026-11-16");
    // The second and fourth Tuesday: the 24th, then into December.
    expect(nextSweep("Tue", [2, 4], "2026-11-25")).toBe("2026-12-08");
    expect(nextSweep("Someday", [1])).toBeNull();
    expect(nextSweep("Mon", [])).toBeNull();
  });

  it("says nothing for a place with no street cleaning source, and says whose word is last when it has one", async () => {
    const { sweepingForBlocks, formatSweeping, toSides, rowsForBlock } = await import("../src/blocks/sweeping.js");
    expect(await sweepingForBlocks({ sources: [] }, [block])).toEqual([]);
    const text = formatSweeping({ block_id: block.id, block: block.name, sides: toSides(rowsForBlock(rows, block), "2026-11-14"), source: { name: "City street sweeping schedule", url: "https://example.org", license: null }, fetched_at: "2026-11-14T00:00:00Z", note: "The signs on the block are the last word." });
    expect(text).toContain("East side: Mon 13, noon to 2pm (next: 2026-11-16); not on city holidays");
    expect(text).toContain("The signs on the block are the last word.");
  });
});
