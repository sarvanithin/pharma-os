import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { SubmitButton } from "@/components/app/submit-button";
import { AnalyticsExplorer } from "@/components/app/analytics-explorer";
import { Chart } from "@/components/app/chart";
import { importCsv } from "@/server/analytics/actions";
import { executeQuery, querySpecSchema, type Row } from "@/lib/analytics/query";

export default async function AnalyticsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();

  const [{ data: datasets }, { data: widgets }] = await Promise.all([
    supabase.from("datasets").select("id, name, row_count").eq("org_id", ctx.org.id).order("created_at", { ascending: false }),
    supabase.from("dashboard_widgets").select("id, title, type, query_spec").eq("org_id", ctx.org.id).order("created_at", { ascending: false }),
  ]);

  // Pre-compute each saved widget from its dataset rows.
  const computed = await Promise.all(
    (widgets ?? []).map(async (w) => {
      const spec = querySpecSchema.parse(w.query_spec);
      const datasetId = (w.query_spec as { datasetId?: string }).datasetId;
      let rows: Row[] = [];
      if (datasetId) {
        const { data } = await supabase
          .from("dataset_rows")
          .select("row")
          .eq("dataset_id", datasetId)
          .limit(5000);
        rows = (data ?? []).map((d: { row: Row }) => d.row);
      }
      return { id: w.id, title: w.title, type: w.type, ...executeQuery(rows, spec) };
    }),
  );

  return (
    <div>
      <PageHeader
        title="Analytics"
        description="On-demand dashboards across your CMC, regulatory, and clinical data."
      />
      <div className="space-y-8 p-6">
        {computed.length > 0 && (
          <div className="grid gap-4 lg:grid-cols-2">
            {computed.map((w) => (
              <Card key={w.id}>
                <CardHeader>
                  <CardTitle className="text-sm">{w.title}</CardTitle>
                </CardHeader>
                <CardContent>
                  <Chart type={w.type} points={w.points} metricValue={w.metricValue} />
                </CardContent>
              </Card>
            ))}
          </div>
        )}

        <AnalyticsExplorer slug={slug} datasets={datasets ?? []} />

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Import a dataset</CardTitle>
          </CardHeader>
          <CardContent>
            <form action={importCsv} className="flex flex-wrap items-end gap-3">
              <input type="hidden" name="slug" value={slug} />
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">Name</label>
                <Input name="name" placeholder="Trial enrollment" />
              </div>
              <div className="space-y-1.5">
                <label className="text-xs text-muted-foreground">CSV file</label>
                <Input name="file" type="file" accept=".csv" required className="file:mr-2" />
              </div>
              <SubmitButton variant="outline" pendingText="Importing…">
                Import CSV
              </SubmitButton>
            </form>
            {datasets && datasets.length > 0 && (
              <p className="mt-3 text-xs text-muted-foreground">
                {datasets.length} dataset{datasets.length === 1 ? "" : "s"} ·{" "}
                {datasets.reduce((n, d) => n + (d.row_count ?? 0), 0).toLocaleString()} rows
              </p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
