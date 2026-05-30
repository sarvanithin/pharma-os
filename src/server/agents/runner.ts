import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { chat, MODELS, generateText, type ChatMessage, type OpenAITool } from "@/lib/anthropic/client";
import { hasAnthropic } from "@/lib/env";
import { retrieve, buildCitations } from "@/server/rag/retrieve";
import { writeAudit } from "@/server/audit";
import { toolsForNames, type ToolContext } from "@/server/agents/tools";
import type { Json, WorkflowStepDef } from "@/types/domain";

type Ctx = { input: Record<string, unknown>; steps: Record<string, Record<string, unknown>> };

function interpolate(tpl: string, ctx: Ctx): string {
  return tpl.replace(/\{\{input\.(\w+)\}\}/g, (_, k) => String(ctx.input[k] ?? ""));
}

function gatherEvidence(ctx: Ctx): string {
  const parts: string[] = [];
  for (const out of Object.values(ctx.steps)) {
    if (typeof out.text === "string") parts.push(out.text);
    if (typeof out.result === "string") parts.push(out.result);
    if (typeof out.document === "string") parts.push(out.document);
  }
  return parts.join("\n\n").slice(0, 16000);
}

function shouldEscalate(step: WorkflowStepDef, output: Record<string, unknown>): boolean {
  const p = step.escalation_policy;
  if (!p) return false;
  if (p.type === "always_human") return true;
  if (p.type === "confidence_below") {
    const conf = typeof output.confidence === "number" ? output.confidence : 1;
    return conf < (p.threshold ?? 0.8);
  }
  return false;
}

async function executeStep(
  step: WorkflowStepDef,
  ctx: Ctx,
  toolCtx: ToolContext,
): Promise<{ output: Record<string, unknown>; tokens: number; toolCalls: Json }> {
  if (step.type === "retrieval") {
    const query = interpolate(step.config && typeof step.config === "object" && "query" in step.config
      ? String((step.config as Record<string, unknown>).query)
      : "{{input.query}}", ctx);
    const chunks = await retrieve(toolCtx.supabase, toolCtx.orgId, query, {
      workspaceId: toolCtx.workspaceId,
      matchCount: 8,
    });
    const text = chunks
      .map((c, i) => `[${i + 1}] ${c.document_title}${c.page_start ? ` p.${c.page_start}` : ""}: ${c.content}`)
      .join("\n\n");
    return {
      output: { type: "retrieval", query, count: chunks.length, text, citations: buildCitations(chunks) as unknown as Json },
      tokens: 0,
      toolCalls: [],
    };
  }

  if (step.type === "transform") {
    return { output: { type: "transform", note: "Deterministic transform applied." }, tokens: 0, toolCalls: [] };
  }

  if (step.type === "compose") {
    if (!hasAnthropic()) {
      return { output: { type: "compose", document: `# ${step.name}\n\n(Simulated — set ANTHROPIC_API_KEY to generate the full document.)\n\nObjective: ${ctx.input.query ?? ""}` }, tokens: 0, toolCalls: [] };
    }
    const { text, usage } = await generateText({
      model: step.model ?? "opus",
      maxTokens: 3000,
      system:
        step.system_prompt ??
        "You assemble regulatory-ready documents for biopharma teams. Produce a clear, well-structured document in Markdown grounded in the provided evidence. Cite source numbers in [n] form where used.",
      prompt: `Objective: ${ctx.input.query ?? ""}\n\nEvidence:\n${gatherEvidence(ctx)}`,
    });
    return { output: { type: "compose", document: text }, tokens: usage.inputTokens + usage.outputTokens, toolCalls: [] };
  }

  // llm_tool: bounded agentic loop with a forced structured result.
  if (!hasAnthropic()) {
    return {
      output: { type: "llm_tool", result: `(Simulated — set ANTHROPIC_API_KEY.) Step: ${step.name}`, confidence: 1 },
      tokens: 0,
      toolCalls: [],
    };
  }
  return runLlmTool(step, ctx, toolCtx);
}

const submitResultTool: OpenAITool = {
  type: "function",
  function: {
    name: "submit_result",
    description: "Submit your final result for this step.",
    parameters: {
      type: "object",
      properties: {
        result: { type: "string", description: "The full result / analysis." },
        confidence: { type: "number", minimum: 0, maximum: 1 },
        key_findings: { type: "array", items: { type: "string" } },
      },
      required: ["result", "confidence"],
    },
  },
};

async function runLlmTool(step: WorkflowStepDef, ctx: Ctx, toolCtx: ToolContext) {
  const tools = toolsForNames(step.tools);
  const openaiTools: OpenAITool[] = [
    ...tools.map((t) => ({
      type: "function" as const,
      function: { name: t.name, description: t.description, parameters: t.input_schema },
    })),
    submitResultTool,
  ];
  const messages: ChatMessage[] = [
    {
      role: "system",
      content:
        step.system_prompt ??
        "You are a meticulous biopharma R&D analyst. Ground every conclusion in the data room. When done, call submit_result with a calibrated confidence (lower it if evidence is thin or the decision needs human judgment).",
    },
    {
      role: "user",
      content: `Objective: ${ctx.input.query ?? ""}\n\nGathered context:\n${gatherEvidence(ctx)}\n\nUse search_data_room if you need more evidence, then call submit_result.`,
    },
  ];
  const toolCalls: { tool: string; args: unknown }[] = [];
  let tokens = 0;

  for (let iter = 0; iter < 5; iter++) {
    const force = iter === 4;
    const { message, usage } = await chat({
      model: step.model ?? "opus",
      maxTokens: 2500,
      messages,
      tools: openaiTools,
      toolChoice: force ? { type: "function", function: { name: "submit_result" } } : "auto",
    });
    tokens += usage.inputTokens + usage.outputTokens;

    const calls = message.tool_calls ?? [];
    const submit = calls.find((c) => c.function.name === "submit_result");
    if (submit) {
      const input = JSON.parse(submit.function.arguments) as {
        result: string;
        confidence: number;
        key_findings?: string[];
      };
      return {
        output: { type: "llm_tool", result: input.result, confidence: input.confidence, key_findings: (input.key_findings ?? []) as unknown as Json },
        tokens,
        toolCalls: toolCalls as unknown as Json,
      };
    }
    if (calls.length === 0) {
      return { output: { type: "llm_tool", result: message.content ?? "", confidence: 0.6 }, tokens, toolCalls: toolCalls as unknown as Json };
    }

    messages.push({ role: "assistant", content: message.content, tool_calls: calls });
    for (const c of calls) {
      const tool = tools.find((t) => t.name === c.function.name);
      let out = "Unknown tool.";
      if (tool) {
        try {
          out = await tool.run(JSON.parse(c.function.arguments) as Record<string, unknown>, toolCtx);
        } catch {
          out = "Tool execution failed.";
        }
      }
      toolCalls.push({ tool: c.function.name, args: c.function.arguments });
      messages.push({ role: "tool", tool_call_id: c.id, content: out });
    }
  }
  return { output: { type: "llm_tool", result: "Unable to complete.", confidence: 0 }, tokens, toolCalls: toolCalls as unknown as Json };
}

async function loadRunContext(db: SupabaseClient, runId: string, inputs: Record<string, unknown>): Promise<Ctx> {
  const { data: steps } = await db
    .from("agent_run_steps")
    .select("step_id, output, status")
    .eq("run_id", runId);
  const ctx: Ctx = { input: inputs, steps: {} };
  for (const s of steps ?? []) {
    if (s.status === "completed" && s.output) ctx.steps[s.step_id] = s.output as Record<string, unknown>;
  }
  return ctx;
}

/** Execute a run from the given step index, pausing at human approval / escalation. */
export async function executeRunFrom(runId: string, startIndex: number) {
  const db = createAdminClient();
  const { data: run } = await db.from("agent_runs").select("*").eq("id", runId).single();
  if (!run) throw new Error("Run not found");

  const { data: template } = await db
    .from("workflow_templates")
    .select("*")
    .eq("id", run.template_id)
    .single();
  if (!template) throw new Error("Template not found");

  const steps = (template.definition.steps ?? []) as WorkflowStepDef[];
  const ctx = await loadRunContext(db, runId, (run.inputs ?? {}) as Record<string, unknown>);
  const toolCtx: ToolContext = { supabase: db, orgId: run.org_id, workspaceId: run.workspace_id };

  for (let i = startIndex; i < steps.length; i++) {
    const step = steps[i];

    if (step.type === "human_approval") {
      const prev = i > 0 ? ctx.steps[steps[i - 1].id] : null;
      await db.from("agent_run_steps").upsert(
        { run_id: runId, org_id: run.org_id, step_id: step.id, step_index: i, name: step.name, type: step.type, status: "waiting_approval", input: (prev ?? {}) as Json, started_at: new Date().toISOString() },
        { onConflict: "run_id,step_id" },
      );
      await db.from("approvals").insert({
        org_id: run.org_id,
        run_id: runId,
        step_id: step.id,
        requested_reason: step.name,
        proposed_action: (prev ?? { message: step.name }) as Json,
        status: "pending",
      });
      await db.from("agent_runs").update({ status: "waiting_approval", current_step_id: step.id }).eq("id", runId);
      await writeAudit(db, { orgId: run.org_id, actorType: "agent", action: "workflow.escalated", targetType: "agent_run", targetId: runId, summary: `Awaiting human approval: ${step.name}` });
      return { paused: true };
    }

    const { data: stepRow } = await db
      .from("agent_run_steps")
      .insert({ run_id: runId, org_id: run.org_id, step_id: step.id, step_index: i, name: step.name, type: step.type, status: "running", model: step.model ?? null, started_at: new Date().toISOString() })
      .select("id")
      .single();

    const t0 = Date.now();
    try {
      const { output, tokens, toolCalls } = await executeStep(step, ctx, toolCtx);
      ctx.steps[step.id] = output;
      const escalate = shouldEscalate(step, output);
      await db
        .from("agent_run_steps")
        .update({
          status: escalate ? "waiting_approval" : "completed",
          output: output as Json,
          tool_calls: toolCalls,
          tokens,
          latency_ms: Date.now() - t0,
          finished_at: new Date().toISOString(),
        })
        .eq("id", stepRow!.id);
      await db.from("agent_runs").update({ cost_tokens: (run.cost_tokens ?? 0) + tokens }).eq("id", runId);
      await writeAudit(db, { orgId: run.org_id, actorType: "agent", action: "workflow.step_completed", targetType: "agent_run", targetId: runId, model: step.model ? MODELS[step.model] : undefined, summary: `Step "${step.name}" completed`, metadata: { step_id: step.id, tokens } });

      if (escalate) {
        await db.from("approvals").insert({ org_id: run.org_id, run_id: runId, step_id: step.id, requested_reason: `Review required for "${step.name}"`, proposed_action: output as Json, status: "pending" });
        await db.from("agent_runs").update({ status: "waiting_approval", current_step_id: step.id }).eq("id", runId);
        await writeAudit(db, { orgId: run.org_id, actorType: "agent", action: "workflow.escalated", targetType: "agent_run", targetId: runId, summary: `Escalated for review: ${step.name}` });
        return { paused: true };
      }
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      await db.from("agent_run_steps").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", stepRow!.id);
      await db.from("agent_runs").update({ status: "failed", error: message, finished_at: new Date().toISOString() }).eq("id", runId);
      await writeAudit(db, { orgId: run.org_id, actorType: "agent", action: "workflow.failed", targetType: "agent_run", targetId: runId, summary: message });
      return { paused: false, failed: true };
    }
  }

  const last = steps[steps.length - 1];
  const finalOutput = ctx.steps[last?.id] ?? {};
  await db.from("agent_runs").update({ status: "completed", outputs: finalOutput as Json, current_step_id: null, finished_at: new Date().toISOString() }).eq("id", runId);
  await writeAudit(db, { orgId: run.org_id, actorType: "agent", action: "workflow.completed", targetType: "agent_run", targetId: runId, summary: "Workflow completed" });
  return { paused: false, completed: true };
}

/** Resume a paused run after an approval decision. */
export async function resumeRun(runId: string, approvalId: string) {
  const db = createAdminClient();
  const { data: approval } = await db.from("approvals").select("*").eq("id", approvalId).single();
  if (!approval) throw new Error("Approval not found");
  const { data: run } = await db.from("agent_runs").select("template_id, org_id").eq("id", runId).single();
  if (!run) throw new Error("Run not found");
  const { data: template } = await db.from("workflow_templates").select("definition").eq("id", run.template_id).single();
  const steps = (template?.definition?.steps ?? []) as WorkflowStepDef[];
  const idx = steps.findIndex((s) => s.id === approval.step_id);

  if (approval.status === "rejected") {
    await db.from("agent_run_steps").update({ status: "skipped" }).eq("run_id", runId).eq("step_id", approval.step_id);
    await db.from("agent_runs").update({ status: "cancelled", current_step_id: null, finished_at: new Date().toISOString() }).eq("id", runId);
    await writeAudit(db, { orgId: run.org_id, actorType: "user", action: "workflow.rejected", targetType: "agent_run", targetId: runId, summary: `Rejected at "${approval.step_id}"` });
    return;
  }

  // Approved/edited: finalize the awaiting step, then continue.
  const stepDef = steps[idx];
  if (stepDef?.type === "human_approval") {
    const output = (approval.decision_payload ?? approval.proposed_action ?? {}) as Json;
    await db.from("agent_run_steps").update({ status: "completed", output, finished_at: new Date().toISOString() }).eq("run_id", runId).eq("step_id", approval.step_id);
  } else {
    await db.from("agent_run_steps").update({ status: "completed" }).eq("run_id", runId).eq("step_id", approval.step_id);
  }
  await db.from("agent_runs").update({ status: "running" }).eq("id", runId);
  await executeRunFrom(runId, idx + 1);
}
