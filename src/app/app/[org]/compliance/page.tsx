import { ShieldCheck } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/misc";
import { SubmitButton } from "@/components/app/submit-button";
import { runComplianceCheck } from "@/server/compliance/check";
import { relativeTime, titleCase } from "@/lib/utils";
import type { Json } from "@/types/domain";

export default async function CompliancePage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();
  const writable = canWrite(ctx.role);

  const [{ data: docs }, { data: checks }] = await Promise.all([
    supabase
      .from("documents")
      .select("id, title, doc_type")
      .eq("org_id", ctx.org.id)
      .eq("status", "ready")
      .order("created_at", { ascending: false })
      .limit(50),
    supabase
      .from("compliance_checks")
      .select("id, standard, score, status, results, created_at, documents(title)")
      .eq("org_id", ctx.org.id)
      .order("created_at", { ascending: false })
      .limit(20),
  ]);

  return (
    <div>
      <PageHeader
        title="Compliance"
        description="Protocol-compliance checks against ICH E6(R3) and 21 CFR Part 11, with cited evidence."
      />
      <div className="grid gap-8 p-6 lg:grid-cols-2">
        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Run a check</h2>
          {!docs?.length ? (
            <EmptyState icon={<ShieldCheck />} title="No documents ready" description="Upload and process documents first." />
          ) : (
            <div className="space-y-2">
              {docs.map((d) => (
                <Card key={d.id}>
                  <CardContent className="flex items-center justify-between gap-3 p-4">
                    <div>
                      <p className="text-sm font-medium">{d.title}</p>
                      <Badge variant="secondary" className="mt-1">{titleCase(d.doc_type)}</Badge>
                    </div>
                    {writable && (
                      <div className="flex gap-1.5">
                        {(["ich_e6_r3", "cfr_part_11"] as const).map((std) => (
                          <form action={runComplianceCheck} key={std}>
                            <input type="hidden" name="slug" value={slug} />
                            <input type="hidden" name="documentId" value={d.id} />
                            <input type="hidden" name="standard" value={std} />
                            <SubmitButton size="sm" variant="outline" pendingText="…">
                              {std === "ich_e6_r3" ? "ICH E6(R3)" : "21 CFR 11"}
                            </SubmitButton>
                          </form>
                        ))}
                      </div>
                    )}
                  </CardContent>
                </Card>
              ))}
            </div>
          )}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Results</h2>
          {!checks?.length ? (
            <p className="rounded-lg border border-dashed p-6 text-center text-sm text-muted-foreground">
              No compliance checks run yet.
            </p>
          ) : (
            <div className="space-y-3">
              {checks.map((c) => {
                const results = (c.results ?? []) as { rule_key: string; status: string; evidence: string }[];
                const docTitle = (c.documents as unknown as { title: string } | null)?.title;
                return (
                  <Card key={c.id}>
                    <CardHeader className="pb-3">
                      <div className="flex items-center justify-between">
                        <CardTitle className="text-sm">
                          {docTitle} · {c.standard === "ich_e6_r3" ? "ICH E6(R3)" : "21 CFR Part 11"}
                        </CardTitle>
                        <div className="flex items-center gap-2">
                          <Badge variant="muted">{Math.round((c.score ?? 0) * 100)}%</Badge>
                          <StatusBadge status={c.status} />
                        </div>
                      </div>
                      <CardDescription>{relativeTime(c.created_at)}</CardDescription>
                    </CardHeader>
                    <CardContent>
                      <ul className="space-y-1.5 text-sm">
                        {results.map((r) => (
                          <li key={r.rule_key} className="flex items-start gap-2">
                            <StatusBadge status={r.status} />
                            <span className="text-muted-foreground">
                              <span className="font-medium text-foreground">{titleCase(r.rule_key)}</span> — {r.evidence}
                            </span>
                          </li>
                        ))}
                      </ul>
                    </CardContent>
                  </Card>
                );
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
