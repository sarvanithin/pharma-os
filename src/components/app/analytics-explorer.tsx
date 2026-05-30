"use client";

import { useEffect, useMemo, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { Sparkles, Loader2, Save } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Chart } from "@/components/app/chart";
import {
  executeQuery,
  inferColumns,
  type QuerySpec,
  type Row,
} from "@/lib/analytics/query";
import { generateQuerySpec, saveWidget } from "@/server/analytics/actions";

interface Dataset {
  id: string;
  name: string;
}

const CHART_TYPES = ["bar", "line", "pie", "metric", "table"] as const;
const AGGS = ["count", "sum", "avg", "min", "max"] as const;

export function AnalyticsExplorer({ slug, datasets }: { slug: string; datasets: Dataset[] }) {
  const router = useRouter();
  const [datasetId, setDatasetId] = useState(datasets[0]?.id ?? "");
  const [rows, setRows] = useState<Row[]>([]);
  const [loadingRows, setLoadingRows] = useState(false);
  const [question, setQuestion] = useState("");
  const [nlPending, startNl] = useTransition();
  const [error, setError] = useState<string | null>(null);
  const [spec, setSpec] = useState<QuerySpec>({
    title: "Untitled chart",
    chartType: "bar",
    groupBy: null,
    metric: null,
    agg: "count",
    filters: [],
    limit: 20,
  });

  const columns = useMemo(() => inferColumns(rows), [rows]);

  useEffect(() => {
    if (!datasetId) return;
    setLoadingRows(true);
    const supabase = createClient();
    supabase
      .from("dataset_rows")
      .select("row")
      .eq("dataset_id", datasetId)
      .limit(5000)
      .then(({ data }) => {
        setRows((data ?? []).map((d: { row: Row }) => d.row));
        setLoadingRows(false);
      });
  }, [datasetId]);

  const result = useMemo(() => executeQuery(rows, spec), [rows, spec]);

  function askNl() {
    if (!question.trim()) return;
    setError(null);
    startNl(async () => {
      const res = await generateQuerySpec(slug, datasetId, question);
      if (res.error) setError(res.error);
      else if (res.spec) setSpec(res.spec);
    });
  }

  function saveCurrent() {
    const fd = new FormData();
    fd.append("slug", slug);
    fd.append("datasetId", datasetId);
    fd.append("spec", JSON.stringify(spec));
    saveWidget(fd).then(() => router.refresh());
  }

  if (datasets.length === 0) {
    return (
      <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
        Import a CSV dataset to start exploring analytics.
      </p>
    );
  }

  return (
    <Card>
      <CardHeader className="flex-row items-center justify-between">
        <CardTitle className="text-base">Explore</CardTitle>
        <select
          value={datasetId}
          onChange={(e) => setDatasetId(e.target.value)}
          className="h-8 rounded-md border bg-transparent px-2 text-sm"
        >
          {datasets.map((d) => (
            <option key={d.id} value={d.id}>
              {d.name}
            </option>
          ))}
        </select>
      </CardHeader>
      <CardContent className="space-y-4">
        <div className="flex items-end gap-2">
          <div className="flex-1">
            <Input
              value={question}
              onChange={(e) => setQuestion(e.target.value)}
              onKeyDown={(e) => e.key === "Enter" && askNl()}
              placeholder="Ask: e.g. average enrollment by site"
            />
          </div>
          <Button onClick={askNl} disabled={nlPending} variant="outline">
            {nlPending ? <Loader2 className="size-4 animate-spin" /> : <Sparkles className="size-4" />}
            Ask
          </Button>
        </div>
        {error && <p className="text-sm text-destructive">{error}</p>}

        <div className="grid grid-cols-2 gap-3 sm:grid-cols-4">
          <Field label="Chart">
            <select
              value={spec.chartType}
              onChange={(e) => setSpec({ ...spec, chartType: e.target.value as QuerySpec["chartType"] })}
              className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
            >
              {CHART_TYPES.map((t) => (
                <option key={t}>{t}</option>
              ))}
            </select>
          </Field>
          <Field label="Group by">
            <select
              value={spec.groupBy ?? ""}
              onChange={(e) => setSpec({ ...spec, groupBy: e.target.value || null })}
              className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
            >
              <option value="">(none)</option>
              {columns.map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
          <Field label="Aggregation">
            <select
              value={spec.agg}
              onChange={(e) => setSpec({ ...spec, agg: e.target.value as QuerySpec["agg"] })}
              className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
            >
              {AGGS.map((a) => (
                <option key={a}>{a}</option>
              ))}
            </select>
          </Field>
          <Field label="Metric">
            <select
              value={spec.metric ?? ""}
              onChange={(e) => setSpec({ ...spec, metric: e.target.value || null })}
              className="h-8 w-full rounded-md border bg-transparent px-2 text-sm"
              disabled={spec.agg === "count"}
            >
              <option value="">(count)</option>
              {columns.filter((c) => c.numeric).map((c) => (
                <option key={c.name} value={c.name}>
                  {c.name}
                </option>
              ))}
            </select>
          </Field>
        </div>

        <div className="rounded-lg border p-4">
          <div className="mb-2 flex items-center justify-between">
            <Input
              value={spec.title}
              onChange={(e) => setSpec({ ...spec, title: e.target.value })}
              className="h-7 w-auto border-none px-0 text-sm font-medium shadow-none focus-visible:ring-0"
            />
            <Button size="sm" variant="ghost" onClick={saveCurrent}>
              <Save className="size-4" /> Save to dashboard
            </Button>
          </div>
          {loadingRows ? (
            <div className="flex h-48 items-center justify-center">
              <Loader2 className="size-5 animate-spin text-muted-foreground" />
            </div>
          ) : (
            <Chart type={spec.chartType} points={result.points} metricValue={result.metricValue} />
          )}
        </div>
      </CardContent>
    </Card>
  );
}

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <label className="space-y-1 text-xs text-muted-foreground">
      <span>{label}</span>
      {children}
    </label>
  );
}
