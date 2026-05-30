"use server";

import { redirect } from "next/navigation";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, canWrite } from "@/lib/auth/session";
import { writeAudit } from "@/server/audit";
import { executeRunFrom, resumeRun } from "@/server/agents/runner";

export async function startWorkflow(formData: FormData) {
  const slug = String(formData.get("slug"));
  const templateKey = String(formData.get("templateKey"));
  const query = String(formData.get("query") ?? "").trim();
  const workspaceId = (formData.get("workspaceId") as string) || null;

  const ctx = await requireOrg(slug);
  if (!canWrite(ctx.role)) throw new Error("Insufficient permissions");

  const supabase = await createClient();
  const { data: template } = await supabase
    .from("workflow_templates")
    .select("id, key, version")
    .eq("key", templateKey)
    .or(`org_id.eq.${ctx.org.id},org_id.is.null`)
    .eq("is_active", true)
    .order("org_id", { nullsFirst: false })
    .limit(1)
    .maybeSingle();
  if (!template) throw new Error("Workflow template not found");

  const { data: run, error } = await supabase
    .from("agent_runs")
    .insert({
      org_id: ctx.org.id,
      workspace_id: workspaceId,
      template_id: template.id,
      template_key: template.key,
      template_version: template.version,
      triggered_by: ctx.userId,
      trigger: "manual",
      status: "running",
      inputs: { query },
      started_at: new Date().toISOString(),
    })
    .select("id")
    .single();
  if (error || !run) throw new Error(error?.message ?? "Failed to start run");

  await writeAudit(supabase, {
    orgId: ctx.org.id,
    actorType: "user",
    actorId: ctx.userId,
    action: "workflow.started",
    targetType: "agent_run",
    targetId: run.id,
    summary: `Started ${template.key}: ${query.slice(0, 120)}`,
  });

  // Run inline (durable Inngest path can be swapped in via INNGEST_EVENT_KEY later).
  try {
    await executeRunFrom(run.id, 0);
  } catch (err) {
    console.error("[workflow] run failed", err);
  }

  redirect(`/app/${slug}/workflows/${run.id}`);
}

export async function decideApproval(formData: FormData) {
  const slug = String(formData.get("slug"));
  const approvalId = String(formData.get("approvalId"));
  const runId = String(formData.get("runId"));
  const decision = String(formData.get("decision")) as "approved" | "rejected";
  const note = (formData.get("note") as string) || null;

  const ctx = await requireOrg(slug);
  if (!canWrite(ctx.role)) throw new Error("Insufficient permissions");

  const supabase = await createClient();
  const { error } = await supabase
    .from("approvals")
    .update({
      status: decision,
      decided_by: ctx.userId,
      decided_at: new Date().toISOString(),
      decision_payload: note ? { note } : null,
    })
    .eq("id", approvalId)
    .eq("org_id", ctx.org.id);
  if (error) throw new Error(error.message);

  await writeAudit(supabase, {
    orgId: ctx.org.id,
    actorType: "user",
    actorId: ctx.userId,
    action: `approval.${decision}`,
    targetType: "approval",
    targetId: approvalId,
    summary: `Approval ${decision}${note ? `: ${note}` : ""}`,
  });

  try {
    await resumeRun(runId, approvalId);
  } catch (err) {
    console.error("[workflow] resume failed", err);
  }

  revalidatePath(`/app/${slug}/workflows/${runId}`);
  revalidatePath(`/app/${slug}/approvals`);
}
