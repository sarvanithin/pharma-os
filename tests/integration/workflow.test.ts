import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { executeRunFrom, resumeRun } from "@/server/agents/runner";

/**
 * Exercises the agent workflow engine end to end against local Supabase.
 * No API keys needed — llm_tool/compose steps run in simulated mode, but the
 * step state machine, human-approval pause, and resume-to-completion are real.
 */
const db = createAdminClient();
let orgId: string;
let docId: string;
let templateId: string;
let runId: string;

describe("workflow engine", () => {
  beforeAll(async () => {
    const { data: org } = await db
      .from("organizations")
      .insert({ name: "WF Test", slug: `wf-${Date.now()}` })
      .select("id")
      .single();
    orgId = org!.id;

    const { data: doc } = await db
      .from("documents")
      .insert({ org_id: orgId, title: "Compound dossier", doc_type: "patent", status: "ready" })
      .select("id")
      .single();
    docId = doc!.id;
    await db.from("chunks").insert({
      org_id: orgId,
      document_id: docId,
      chunk_index: 0,
      content: "Compound ABC-123 composition of matter claims and prior art references.",
      page_start: 1,
      page_end: 1,
    });

    const { data: tmpl } = await db
      .from("workflow_templates")
      .select("id")
      .eq("key", "patent_prior_art")
      .is("org_id", null)
      .single();
    templateId = tmpl!.id;

    const { data: run } = await db
      .from("agent_runs")
      .insert({
        org_id: orgId,
        template_id: templateId,
        template_key: "patent_prior_art",
        template_version: 1,
        status: "running",
        inputs: { query: "prior art for ABC-123" },
        started_at: new Date().toISOString(),
      })
      .select("id")
      .single();
    runId = run!.id;
  });

  afterAll(async () => {
    if (orgId) await db.from("organizations").delete().eq("id", orgId);
  });

  it("runs steps and pauses at human approval", async () => {
    const result = await executeRunFrom(runId, 0);
    expect(result.paused).toBe(true);

    const { data: run } = await db.from("agent_runs").select("status").eq("id", runId).single();
    expect(run!.status).toBe("waiting_approval");

    const { data: approvals } = await db
      .from("approvals")
      .select("id, status, step_id")
      .eq("run_id", runId)
      .eq("status", "pending");
    expect(approvals?.length).toBe(1);

    // Retrieval + analysis steps should have produced output rows.
    const { data: steps } = await db
      .from("agent_run_steps")
      .select("step_id, status")
      .eq("run_id", runId);
    expect(steps!.some((s) => s.step_id === "s1" && s.status === "completed")).toBe(true);
  });

  it("resumes to completion after approval", async () => {
    const { data: approval } = await db
      .from("approvals")
      .select("id")
      .eq("run_id", runId)
      .eq("status", "pending")
      .single();
    await db
      .from("approvals")
      .update({ status: "approved", decided_at: new Date().toISOString() })
      .eq("id", approval!.id);

    await resumeRun(runId, approval!.id);

    const { data: run } = await db
      .from("agent_runs")
      .select("status, outputs")
      .eq("id", runId)
      .single();
    expect(run!.status).toBe("completed");
    expect(run!.outputs).toBeTruthy();
  });

  it("recorded an immutable audit trail for the run", async () => {
    const { data } = await db
      .from("audit_log")
      .select("action")
      .eq("org_id", orgId)
      .in("action", ["workflow.step_completed", "workflow.escalated", "workflow.completed"]);
    expect((data?.length ?? 0)).toBeGreaterThanOrEqual(3);
  });
});
