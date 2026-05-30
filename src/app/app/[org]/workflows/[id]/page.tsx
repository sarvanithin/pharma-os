import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, CheckCircle2, Circle, Clock, AlertTriangle, Workflow } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/app/submit-button";
import { Button } from "@/components/ui/button";
import { decideApproval } from "@/server/agents/actions";
import { cn } from "@/lib/utils";
import type { Json } from "@/types/domain";

function StepIcon({ status }: { status: string }) {
  if (status === "completed") return <CheckCircle2 className="size-5 text-[var(--success)]" />;
  if (status === "running") return <Clock className="size-5 animate-pulse text-[var(--warning)]" />;
  if (status === "waiting_approval") return <AlertTriangle className="size-5 text-[var(--warning)]" />;
  if (status === "failed") return <AlertTriangle className="size-5 text-destructive" />;
  return <Circle className="size-5 text-muted-foreground" />;
}

function StepOutput({ output }: { output: Record<string, Json> | null }) {
  if (!output) return null;
  const doc = typeof output.document === "string" ? output.document : null;
  const result = typeof output.result === "string" ? output.result : null;
  const confidence = typeof output.confidence === "number" ? output.confidence : null;
  const count = typeof output.count === "number" ? output.count : null;
  return (
    <div className="mt-2 space-y-2">
      {count != null && <p className="text-xs text-muted-foreground">Retrieved {count} sources</p>}
      {confidence != null && (
        <Badge variant={confidence >= 0.8 ? "success" : "warning"}>
          Confidence {Math.round(confidence * 100)}%
        </Badge>
      )}
      {(doc || result) && (
        <div className="whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm leading-relaxed">
          {(doc || result)!.slice(0, 6000)}
        </div>
      )}
    </div>
  );
}

export default async function RunDetail({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org: slug, id } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();

  const { data: run } = await supabase
    .from("agent_runs")
    .select("*")
    .eq("id", id)
    .eq("org_id", ctx.org.id)
    .maybeSingle();
  if (!run) notFound();

  const [{ data: steps }, { data: approvals }] = await Promise.all([
    supabase.from("agent_run_steps").select("*").eq("run_id", id).order("step_index"),
    supabase.from("approvals").select("*").eq("run_id", id).order("created_at"),
  ]);

  const pendingApproval = (approvals ?? []).find((a) => a.status === "pending");
  const inputs = (run.inputs ?? {}) as { query?: string };

  return (
    <div className="mx-auto max-w-3xl p-6">
      <Link
        href={`/app/${slug}/workflows`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Workflows
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <Workflow className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{run.template_key}</h1>
            <p className="mt-1 text-sm text-muted-foreground">{inputs.query}</p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <StatusBadge status={run.status} />
          {run.cost_tokens > 0 && (
            <Badge variant="muted">{run.cost_tokens.toLocaleString()} tokens</Badge>
          )}
        </div>
      </div>

      {run.error && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {run.error}
        </p>
      )}

      {pendingApproval && canWrite(ctx.role) && (
        <Card className="mt-6 border-[var(--warning)]/40">
          <CardHeader>
            <CardTitle className="flex items-center gap-2 text-base">
              <AlertTriangle className="size-4 text-[var(--warning)]" />
              Human approval required
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-3">
            <p className="text-sm text-muted-foreground">
              {pendingApproval.requested_reason ?? "Review the proposed action before continuing."}
            </p>
            {(() => {
              const pa = (pendingApproval.proposed_action ?? {}) as Record<string, Json>;
              const text =
                (typeof pa.result === "string" && pa.result) ||
                (typeof pa.document === "string" && pa.document) ||
                null;
              return text ? (
                <div className="max-h-64 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                  {text.slice(0, 4000)}
                </div>
              ) : null;
            })()}
            <div className="flex items-end gap-2">
              <form action={decideApproval} className="flex flex-1 items-end gap-2">
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="approvalId" value={pendingApproval.id} />
                <input type="hidden" name="runId" value={id} />
                <input type="hidden" name="decision" value="approved" />
                <div className="flex-1">
                  <Input name="note" placeholder="Optional note…" />
                </div>
                <SubmitButton pendingText="Resuming…">Approve &amp; continue</SubmitButton>
              </form>
              <form action={decideApproval}>
                <input type="hidden" name="slug" value={slug} />
                <input type="hidden" name="approvalId" value={pendingApproval.id} />
                <input type="hidden" name="runId" value={id} />
                <input type="hidden" name="decision" value="rejected" />
                <SubmitButton variant="ghost" pendingText="…">
                  Reject
                </SubmitButton>
              </form>
            </div>
          </CardContent>
        </Card>
      )}

      <div className="mt-6">
        <h2 className="mb-3 text-sm font-medium text-muted-foreground">Step timeline</h2>
        <ol className="space-y-1">
          {(steps ?? []).map((s, i) => (
            <li key={s.id} className="flex gap-3">
              <div className="flex flex-col items-center">
                <StepIcon status={s.status} />
                {i < (steps?.length ?? 0) - 1 && <div className="my-1 w-px flex-1 bg-border" />}
              </div>
              <div className="flex-1 pb-5">
                <div className="flex items-center gap-2">
                  <span className="text-sm font-medium">{s.name}</span>
                  <Badge variant="muted" className="text-[10px]">
                    {s.type}
                  </Badge>
                  {s.model && <span className="text-xs text-muted-foreground">{s.model}</span>}
                </div>
                <StepOutput output={s.output as Record<string, Json> | null} />
                {s.error && <p className="mt-1 text-sm text-destructive">{s.error}</p>}
              </div>
            </li>
          ))}
          {!steps?.length && (
            <p className="text-sm text-muted-foreground">No steps recorded yet.</p>
          )}
        </ol>
      </div>

      {run.status === "completed" && (
        <div className="mt-2">
          <Button asChild variant="outline" size="sm">
            <Link href={`/app/${slug}/audit`}>View audit trail</Link>
          </Button>
        </div>
      )}
    </div>
  );
}
