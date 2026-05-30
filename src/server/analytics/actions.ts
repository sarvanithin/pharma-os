"use server";

import Papa from "papaparse";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, canWrite } from "@/lib/auth/session";
import { generateStructured } from "@/lib/anthropic/client";
import { hasAnthropic } from "@/lib/env";
import { writeAudit } from "@/server/audit";
import { querySpecSchema, inferColumns, type QuerySpec, type Row } from "@/lib/analytics/query";

export async function importCsv(formData: FormData) {
  const slug = String(formData.get("slug"));
  const file = formData.get("file");
  const name = String(formData.get("name") ?? "").trim();
  const ctx = await requireOrg(slug);
  if (!canWrite(ctx.role)) throw new Error("Insufficient permissions");
  if (!(file instanceof File) || file.size === 0) return;

  const text = await file.text();
  const parsed = Papa.parse<Row>(text, { header: true, skipEmptyLines: true });
  const rows = parsed.data.filter((r) => Object.keys(r).length > 0);
  const schema = inferColumns(rows);

  const supabase = await createClient();
  const { data: dataset, error } = await supabase
    .from("datasets")
    .insert({
      org_id: ctx.org.id,
      name: name || file.name.replace(/\.[^.]+$/, ""),
      source: "csv",
      schema: schema as unknown as object,
      row_count: rows.length,
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error || !dataset) throw new Error(error?.message ?? "Failed to create dataset");

  // Batch insert rows.
  for (let i = 0; i < rows.length; i += 500) {
    const batch = rows.slice(i, i + 500).map((row) => ({
      org_id: ctx.org.id,
      dataset_id: dataset.id,
      row: row as unknown as object,
    }));
    await supabase.from("dataset_rows").insert(batch);
  }

  await writeAudit(supabase, {
    orgId: ctx.org.id,
    actorType: "user",
    actorId: ctx.userId,
    action: "dataset.imported",
    targetType: "dataset",
    targetId: dataset.id,
    summary: `Imported "${name || file.name}" (${rows.length} rows)`,
  });

  revalidatePath(`/app/${slug}/analytics`);
}

export async function generateQuerySpec(
  slug: string,
  datasetId: string,
  question: string,
): Promise<{ spec?: QuerySpec; error?: string }> {
  const ctx = await requireOrg(slug);
  if (!hasAnthropic()) return { error: "Set ANTHROPIC_API_KEY to use natural-language analytics." };

  const supabase = await createClient();
  const { data: dataset } = await supabase
    .from("datasets")
    .select("schema")
    .eq("id", datasetId)
    .eq("org_id", ctx.org.id)
    .maybeSingle();
  if (!dataset) return { error: "Dataset not found" };

  const cols = (dataset.schema as { name: string; numeric: boolean }[]) ?? [];
  try {
    const { data } = await generateStructured({
      model: "haiku",
      schema: querySpecSchema,
      system:
        "You translate a natural-language analytics question into a constrained query spec over a tabular dataset. " +
        "Choose groupBy from the available columns (or null for a single metric), an appropriate aggregation, and a sensible chart type. " +
        "Only reference columns that exist.",
      prompt: `Available columns: ${cols
        .map((c) => `${c.name}${c.numeric ? " (number)" : ""}`)
        .join(", ")}\n\nQuestion: ${question}`,
      toolName: "build_query",
      maxTokens: 800,
    });
    await writeAudit(supabase, {
      orgId: ctx.org.id,
      actorType: "user",
      actorId: ctx.userId,
      action: "analytics.nl_query",
      summary: question.slice(0, 160),
      model: "claude-haiku-4-5",
    });
    return { spec: data };
  } catch (e) {
    return { error: e instanceof Error ? e.message : "Failed to generate query" };
  }
}

export async function saveWidget(formData: FormData) {
  const slug = String(formData.get("slug"));
  const datasetId = String(formData.get("datasetId"));
  const specJson = String(formData.get("spec"));
  const ctx = await requireOrg(slug);
  if (!canWrite(ctx.role)) throw new Error("Insufficient permissions");

  const spec = querySpecSchema.parse(JSON.parse(specJson));
  const supabase = await createClient();

  let { data: dashboard } = await supabase
    .from("dashboards")
    .select("id")
    .eq("org_id", ctx.org.id)
    .order("created_at")
    .limit(1)
    .maybeSingle();
  if (!dashboard) {
    const { data } = await supabase
      .from("dashboards")
      .insert({ org_id: ctx.org.id, name: "Overview", created_by: ctx.userId })
      .select("id")
      .single();
    dashboard = data;
  }

  await supabase.from("dashboard_widgets").insert({
    org_id: ctx.org.id,
    dashboard_id: dashboard!.id,
    type: spec.chartType,
    title: spec.title,
    query_spec: { ...spec, datasetId } as unknown as object,
  });

  await writeAudit(supabase, {
    orgId: ctx.org.id,
    actorType: "user",
    actorId: ctx.userId,
    action: "dashboard.widget_added",
    targetType: "dashboard",
    targetId: dashboard!.id,
    summary: `Added widget "${spec.title}"`,
  });

  revalidatePath(`/app/${slug}/analytics`);
}
