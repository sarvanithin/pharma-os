import { z } from "zod";

export const aggSchema = z.enum(["count", "sum", "avg", "min", "max"]);
export const chartTypeSchema = z.enum(["bar", "line", "pie", "metric", "table"]);

export const filterSchema = z.object({
  column: z.string(),
  op: z.enum(["eq", "neq", "gt", "lt", "contains"]),
  value: z.string(),
});

/** Constrained, safe query DSL. The LLM only ever emits this — never raw SQL. */
export const querySpecSchema = z.object({
  title: z.string(),
  chartType: chartTypeSchema,
  groupBy: z.string().nullable(),
  metric: z.string().nullable(),
  agg: aggSchema,
  filters: z.array(filterSchema).default([]),
  limit: z.number().int().positive().max(50).default(20),
});

export type QuerySpec = z.infer<typeof querySpecSchema>;
export type Row = Record<string, unknown>;
export interface DataPoint {
  label: string;
  value: number;
}
export interface QueryResult {
  points: DataPoint[];
  metricValue: number;
}

function num(v: unknown): number {
  const n = typeof v === "number" ? v : parseFloat(String(v ?? "").replace(/[^0-9.\-]/g, ""));
  return Number.isFinite(n) ? n : 0;
}

function matches(row: Row, f: { column: string; op: string; value: string }): boolean {
  const cell = row[f.column];
  const s = String(cell ?? "").toLowerCase();
  const v = f.value.toLowerCase();
  switch (f.op) {
    case "eq":
      return s === v;
    case "neq":
      return s !== v;
    case "gt":
      return num(cell) > num(f.value);
    case "lt":
      return num(cell) < num(f.value);
    case "contains":
      return s.includes(v);
    default:
      return true;
  }
}

function aggregate(values: number[], agg: QuerySpec["agg"]): number {
  if (agg === "count") return values.length;
  if (values.length === 0) return 0;
  const sum = values.reduce((a, b) => a + b, 0);
  switch (agg) {
    case "sum":
      return sum;
    case "avg":
      return sum / values.length;
    case "min":
      return Math.min(...values);
    case "max":
      return Math.max(...values);
    default:
      return sum;
  }
}

/** Execute a query spec over in-memory rows. Pure + deterministic. */
export function executeQuery(rows: Row[], spec: QuerySpec): QueryResult {
  const filtered = rows.filter((r) => (spec.filters ?? []).every((f) => matches(r, f)));

  if (!spec.groupBy) {
    const values =
      spec.agg === "count"
        ? filtered.map(() => 1)
        : filtered.map((r) => num(r[spec.metric ?? ""]));
    return { points: [], metricValue: aggregate(values, spec.agg) };
  }

  const groups = new Map<string, number[]>();
  for (const r of filtered) {
    const key = String(r[spec.groupBy] ?? "—");
    const v = spec.agg === "count" ? 1 : num(r[spec.metric ?? ""]);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key)!.push(v);
  }

  const points = [...groups.entries()]
    .map(([label, vals]) => ({ label, value: aggregate(vals, spec.agg) }))
    .sort((a, b) => b.value - a.value)
    .slice(0, spec.limit ?? 20);

  return { points, metricValue: points.reduce((a, p) => a + p.value, 0) };
}

export function inferColumns(rows: Row[]): { name: string; numeric: boolean }[] {
  if (rows.length === 0) return [];
  const keys = Object.keys(rows[0]);
  return keys.map((name) => {
    const numeric = rows.slice(0, 20).every((r) => {
      const v = r[name];
      return v === null || v === "" || !Number.isNaN(parseFloat(String(v)));
    });
    return { name, numeric };
  });
}
