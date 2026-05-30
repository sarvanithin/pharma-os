import { describe, it, expect } from "vitest";
import { executeQuery, inferColumns, type QuerySpec } from "@/lib/analytics/query";

const rows = [
  { site: "Boston", enrolled: "40", arm: "A" },
  { site: "Boston", enrolled: "20", arm: "B" },
  { site: "Austin", enrolled: "30", arm: "A" },
  { site: "Austin", enrolled: "10", arm: "B" },
];

const base: QuerySpec = {
  title: "t",
  chartType: "bar",
  groupBy: null,
  metric: null,
  agg: "count",
  filters: [],
  limit: 20,
};

describe("analytics executeQuery", () => {
  it("counts grouped rows", () => {
    const { points } = executeQuery(rows, { ...base, groupBy: "site", agg: "count" });
    const boston = points.find((p) => p.label === "Boston");
    expect(boston?.value).toBe(2);
  });

  it("sums a numeric metric by group", () => {
    const { points } = executeQuery(rows, { ...base, groupBy: "site", metric: "enrolled", agg: "sum" });
    expect(points.find((p) => p.label === "Boston")?.value).toBe(60);
    expect(points.find((p) => p.label === "Austin")?.value).toBe(40);
  });

  it("applies filters", () => {
    const { points } = executeQuery(rows, {
      ...base,
      groupBy: "site",
      metric: "enrolled",
      agg: "sum",
      filters: [{ column: "arm", op: "eq", value: "A" }],
    });
    expect(points.find((p) => p.label === "Boston")?.value).toBe(40);
  });

  it("computes a single metric without groupBy", () => {
    const { metricValue } = executeQuery(rows, { ...base, metric: "enrolled", agg: "avg" });
    expect(metricValue).toBe(25);
  });

  it("infers numeric columns", () => {
    const cols = inferColumns(rows);
    expect(cols.find((c) => c.name === "enrolled")?.numeric).toBe(true);
    expect(cols.find((c) => c.name === "site")?.numeric).toBe(false);
  });
});
