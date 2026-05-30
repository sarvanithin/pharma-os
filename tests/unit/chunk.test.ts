import { describe, it, expect } from "vitest";
import { chunkPages } from "@/server/rag/chunk";

describe("chunkPages", () => {
  it("produces chunks with page ranges and heading paths", () => {
    const pages = [
      { page: 1, text: "INTRODUCTION\n\n" + "The study evaluated efficacy. ".repeat(60) },
      { page: 2, text: "METHODS\n\n" + "Subjects were randomized. ".repeat(60) },
    ];
    const chunks = chunkPages(pages);
    expect(chunks.length).toBeGreaterThan(0);
    for (const c of chunks) {
      expect(c.content.length).toBeGreaterThan(20);
      expect(c.pageStart).toBeGreaterThanOrEqual(1);
      expect(c.pageEnd).toBeGreaterThanOrEqual(c.pageStart);
      expect(c.chunkIndex).toBeGreaterThanOrEqual(0);
    }
  });

  it("captures headings into the heading path", () => {
    const pages = [{ page: 1, text: "PRIMARY ENDPOINT RESULTS\n\n" + "Data follows. ".repeat(80) }];
    const chunks = chunkPages(pages);
    expect(chunks.some((c) => c.headingPath.length > 0)).toBe(true);
  });

  it("returns nothing for empty input", () => {
    expect(chunkPages([{ page: 1, text: "" }])).toEqual([]);
  });
});
