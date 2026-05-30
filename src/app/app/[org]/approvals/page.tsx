import Link from "next/link";
import { CheckSquare, AlertTriangle } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { EmptyState } from "@/components/ui/misc";
import { SubmitButton } from "@/components/app/submit-button";
import { decideApproval } from "@/server/agents/actions";
import { relativeTime } from "@/lib/utils";
import type { Json } from "@/types/domain";

export default async function ApprovalsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();
  const writable = canWrite(ctx.role);

  const { data: approvals } = await supabase
    .from("approvals")
    .select("id, run_id, step_id, requested_reason, proposed_action, created_at, agent_runs(template_key)")
    .eq("org_id", ctx.org.id)
    .eq("status", "pending")
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="Approvals"
        description="Human-in-the-loop decisions. Agents pause here when judgment is required."
      />
      <div className="p-6">
        {!approvals?.length ? (
          <EmptyState
            icon={<CheckSquare />}
            title="No pending approvals"
            description="When a workflow needs human judgment, it will appear here."
          />
        ) : (
          <div className="space-y-4">
            {approvals.map((a) => {
              const pa = (a.proposed_action ?? {}) as Record<string, Json>;
              const tmpl = (a.agent_runs as unknown as { template_key: string } | null)?.template_key;
              const text =
                (typeof pa.result === "string" && pa.result) ||
                (typeof pa.document === "string" && pa.document) ||
                null;
              return (
                <Card key={a.id} className="border-[var(--warning)]/40">
                  <CardContent className="p-5">
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex items-start gap-2">
                        <AlertTriangle className="mt-0.5 size-4 text-[var(--warning)]" />
                        <div>
                          <p className="text-sm font-medium">{a.requested_reason ?? "Review required"}</p>
                          <Link
                            href={`/app/${slug}/workflows/${a.run_id}`}
                            className="text-xs text-muted-foreground hover:text-primary"
                          >
                            {tmpl} · {relativeTime(a.created_at)}
                          </Link>
                        </div>
                      </div>
                    </div>
                    {text && (
                      <div className="mt-3 max-h-40 overflow-y-auto whitespace-pre-wrap rounded-md border bg-muted/30 p-3 text-sm">
                        {text.slice(0, 2000)}
                      </div>
                    )}
                    {writable && (
                      <div className="mt-3 flex items-end gap-2">
                        <form action={decideApproval} className="flex flex-1 items-end gap-2">
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="approvalId" value={a.id} />
                          <input type="hidden" name="runId" value={a.run_id} />
                          <input type="hidden" name="decision" value="approved" />
                          <div className="flex-1">
                            <Input name="note" placeholder="Optional note…" />
                          </div>
                          <SubmitButton size="sm" pendingText="…">
                            Approve
                          </SubmitButton>
                        </form>
                        <form action={decideApproval}>
                          <input type="hidden" name="slug" value={slug} />
                          <input type="hidden" name="approvalId" value={a.id} />
                          <input type="hidden" name="runId" value={a.run_id} />
                          <input type="hidden" name="decision" value="rejected" />
                          <SubmitButton size="sm" variant="ghost" pendingText="…">
                            Reject
                          </SubmitButton>
                        </form>
                      </div>
                    )}
                  </CardContent>
                </Card>
              );
            })}
          </div>
        )}
      </div>
    </div>
  );
}
