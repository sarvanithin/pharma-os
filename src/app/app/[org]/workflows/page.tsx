import Link from "next/link";
import { Workflow, GitBranch } from "lucide-react";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { StatusBadge } from "@/components/status-badge";
import { SubmitButton } from "@/components/app/submit-button";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { WORKFLOW_CATALOG } from "@/lib/workflows/catalog";
import { startWorkflow } from "@/server/agents/actions";
import { relativeTime } from "@/lib/utils";

export default async function WorkflowsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();
  const { data: runs } = await supabase
    .from("agent_runs")
    .select("id, template_key, status, inputs, created_at")
    .eq("org_id", ctx.org.id)
    .order("created_at", { ascending: false })
    .limit(15);

  return (
    <div>
      <PageHeader
        title="Workflows"
        description="Run deterministic, multi-step agentic workflows that escalate to you when judgment is required."
      />
      <div className="space-y-8 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-3">
          {WORKFLOW_CATALOG.map((w) => (
            <Card key={w.key}>
              <CardHeader>
                <GitBranch className="size-5 text-primary" />
                <CardTitle className="text-base">{w.name}</CardTitle>
                <CardDescription>{w.description}</CardDescription>
              </CardHeader>
              <CardContent>
                <form action={startWorkflow} className="space-y-2">
                  <input type="hidden" name="slug" value={slug} />
                  <input type="hidden" name="templateKey" value={w.key} />
                  <Input name="query" placeholder="Objective…" required />
                  <SubmitButton size="sm" className="w-full" pendingText="Running…">
                    Run workflow
                  </SubmitButton>
                </form>
              </CardContent>
            </Card>
          ))}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Recent runs</h2>
          {!runs?.length ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No runs yet. Start a workflow above.
            </p>
          ) : (
            <div className="rounded-xl border">
              <Table>
                <TableHeader>
                  <TableRow>
                    <TableHead>Workflow</TableHead>
                    <TableHead>Objective</TableHead>
                    <TableHead>Status</TableHead>
                    <TableHead>Started</TableHead>
                  </TableRow>
                </TableHeader>
                <TableBody>
                  {runs.map((r) => {
                    const inputs = (r.inputs ?? {}) as { query?: string };
                    return (
                      <TableRow key={r.id}>
                        <TableCell>
                          <Link
                            href={`/app/${slug}/workflows/${r.id}`}
                            className="inline-flex items-center gap-2 font-medium hover:text-primary"
                          >
                            <Workflow className="size-4 text-muted-foreground" />
                            {r.template_key}
                          </Link>
                        </TableCell>
                        <TableCell className="max-w-xs truncate text-muted-foreground">
                          {inputs.query ?? "—"}
                        </TableCell>
                        <TableCell>
                          <StatusBadge status={r.status} />
                        </TableCell>
                        <TableCell className="text-muted-foreground">
                          {relativeTime(r.created_at)}
                        </TableCell>
                      </TableRow>
                    );
                  })}
                </TableBody>
              </Table>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
