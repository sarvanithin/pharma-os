# Agent design

The agent layer is intentionally **not** a free-form autonomous loop. It's a deterministic step state-machine where each step is one of five types, and the only "agentic" surface is inside `llm_tool` — where a bounded tool-use loop is forced to finalize via a `submit_result` call.

This is a deliberate trade. The benefits of openness (creative tool composition, emergent solutions) cost you reproducibility, auditability, and predictable cost. In a regulated-adjacent space those costs are unacceptable. So the workflow shape is fixed, the LLM gets a small budget of tool calls inside one step, and every state transition is in SQL.

## Workflow templates are data, not code

A template is a row in `workflow_templates` with a `definition` JSON containing an ordered list of steps:

```ts
type WorkflowStepDef = {
  id: string;
  name: string;
  type: "retrieval" | "llm_tool" | "transform" | "human_approval" | "compose";
  model?: "opus" | "haiku" | "sonnet";
  system_prompt?: string;
  tools?: string[];                                     // for llm_tool
  escalation_policy?:
    | { type: "always_human" }
    | { type: "confidence_below"; threshold: number }
    | { type: "never" };
  config?: Record<string, unknown>;                     // step-specific (e.g. retrieval query template)
};
```

Adding a new workflow is a row insert. Seeded templates in `supabase/migrations/20260101000008_seed_reference_data.sql` cover patent prior-art, IND assembly, regulatory report assembly, tabular review, drug hypothesis, document classification, knowledge hub, and on-demand dashboards.

## Step types

| Type | What it does | Output shape |
|---|---|---|
| `retrieval` | Calls `retrieve()` over the data room (hybrid + rerank). Query is interpolated from `config.query` against the run inputs (`{{input.query}}`). | `{ type, query, count, text, citations[] }` |
| `llm_tool` | Bounded agentic loop: Claude with a tool registry + forced `submit_result` finalization. | `{ type, result, confidence, key_findings[] }` |
| `transform` | Deterministic op (no LLM). Currently a passthrough scaffold for future step types. | `{ type, note }` |
| `human_approval` | Inserts an `approvals` row, flips run to `waiting_approval`, pauses. Resumes on decision. | The approving user's payload (or prior step's output) |
| `compose` | Single Claude call to assemble a regulatory-ready Markdown document from accumulated context. | `{ type, document }` |

## State accumulation

The runner maintains:

```ts
type Ctx = {
  input: Record<string, unknown>;       // run.inputs (user-provided objective)
  steps: Record<stepId, output>;        // outputs of previously completed steps
};
```

`Ctx` is **rebuilt from `agent_run_steps`** at the start of every `executeRunFrom` call. That means a paused run resumes with the same context regardless of how much wall-clock time elapsed or which process picks it up. The runner never relies on in-memory state across pauses.

Evidence is gathered for LLM steps with `gatherEvidence(ctx)`, which concatenates the text/result/document fields of prior step outputs and clips to a 16k-char budget. Heavier prompt-engineering — section-aware context, doc-type-specific framing — is a future iteration.

## The bounded tool loop (the only "agentic" surface)

`llm_tool` calls Claude with two kinds of tools:

1. **Domain tools** declared on the step (`tools: ["search_data_room", "list_documents"]`). Implementations live in `src/server/agents/tools.ts`, each with an OpenAI function-schema and a Node executor that takes args + the org-scoped `supabase` client.
2. **`submit_result`** — always appended, schema `{ result: string, confidence: number, key_findings: string[] }`. This is the "you must call this to finish" sink.

The loop:

```
for iter in 0..4:
  res = chat(messages, tools, tool_choice = iter==4 ? forced submit_result : "auto")
  if submit_result called  -> parse args, return { result, confidence, key_findings }
  if no tool_calls         -> return text as result (rare; conf=0.6)
  else: execute each domain tool, append tool messages, continue
```

Five iterations is a budget for cost predictability. On the last iteration the model is forced to call `submit_result` — the loop always terminates with structured output. Token totals from every iteration are summed into `agent_run_steps.tokens` and surfaced in the UI.

## Escalation policy

Per-step. Evaluated *after* the step completes, with the step's output in hand:

- `always_human` — every run pauses here (used in `drug_hypothesis`).
- `confidence_below: { threshold: 0.7 }` — pauses only if the step's self-reported confidence is below the threshold (used in `patent_prior_art`, `ind_assembly`).
- Default (no policy) — never pauses.

When triggered, the runner inserts an `approvals` row with `proposed_action = output`, sets `agent_runs.status = waiting_approval` + `current_step_id = step.id`, audits a `workflow.escalated` entry, and returns `{ paused: true }`. The function does not block; control returns to the caller (a Server Action), which can render the run page.

## Pause / resume

Resume is a separate function (`resumeRun`) triggered by `decideApproval`:

1. The user approves/rejects in the UI; `decideApproval` updates `approvals.status` and writes an `approval.approved` / `approval.rejected` audit entry.
2. `resumeRun(runId, approvalId)` loads the approval, finds the step index in the template, and:
   - On `rejected`: marks the step skipped, flips run to `cancelled`, audits `workflow.rejected`. Done.
   - On `approved` / `edited`: for a `human_approval` step type, the step's output is set to the user's `decision_payload` (or the original `proposed_action`); the runner then calls `executeRunFrom(runId, idx + 1)` and the chain continues from the next step.

The pause/resume primitive lives in DB state, not in Inngest's `waitForEvent`. This means operators can inspect, audit, replay, and recover runs purely from Postgres, which is useful when the agent infra is down or under change.

## Auditability

Every state transition writes to `audit_log`:

- `workflow.started` (user, with template + objective)
- `workflow.step_completed` (agent, with model + tokens + step id)
- `workflow.escalated` (agent, with the step that escalated and why)
- `approval.approved` / `approval.rejected` (user, with optional note)
- `workflow.completed` / `workflow.failed` / `workflow.rejected` (agent or user)

The chain is hashed in SQL — see [`architecture.md`](architecture.md#decisions). A 30-minute incident replay over a run is one `SELECT * FROM audit_log WHERE target_id = ?` away.

## What I'd add next

- **Trajectory eval** as a first-class artifact (see [`eval.md`](eval.md)) — score every run for tool-use correctness, redundancy, and end-state correctness against golden outputs.
- **Cost-aware step routing** — Haiku for retrieval-summarize steps; reserve Opus for compose + judgment.
- **Sub-agent decomposition for compose steps** — long-form regulatory reports benefit from outline-first then section-by-section, with per-section retrieval.
- **Per-step retry policy with idempotent writes**, so re-running a step doesn't double-insert audit entries.
