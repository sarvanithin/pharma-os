import Link from "next/link";
import { FileText, CheckCircle2, Workflow, CheckSquare, ArrowRight } from "lucide-react";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent } from "@/components/ui/card";
import { WORKFLOW_CATALOG } from "@/lib/workflows/catalog";

export default async function DashboardPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();
  const base = `/app/${slug}`;

  const [docs, ready, runs, approvals] = await Promise.all([
    supabase.from("documents").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id),
    supabase
      .from("documents")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.org.id)
      .eq("status", "ready"),
    supabase.from("agent_runs").select("id", { count: "exact", head: true }).eq("org_id", ctx.org.id),
    supabase
      .from("approvals")
      .select("id", { count: "exact", head: true })
      .eq("org_id", ctx.org.id)
      .eq("status", "pending"),
  ]);

  const stats = [
    { label: "Documents", value: docs.count ?? 0, icon: FileText, href: `${base}/documents` },
    { label: "Ready", value: ready.count ?? 0, icon: CheckCircle2, href: `${base}/documents` },
    { label: "Workflow runs", value: runs.count ?? 0, icon: Workflow, href: `${base}/workflows` },
    {
      label: "Pending approvals",
      value: approvals.count ?? 0,
      icon: CheckSquare,
      href: `${base}/approvals`,
    },
  ];

  return (
    <div>
      <PageHeader
        title={`Welcome to ${ctx.org.name}`}
        description="Your unified data and workflow layer for biopharma R&D."
      />
      <div className="space-y-8 p-6">
        <div className="grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
          {stats.map((s) => (
            <Link key={s.label} href={s.href}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center justify-between p-5">
                  <div>
                    <p className="text-sm text-muted-foreground">{s.label}</p>
                    <p className="mt-1 text-3xl font-semibold tabular-nums">{s.value}</p>
                  </div>
                  <s.icon className="size-5 text-primary" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Start a workflow</h2>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {WORKFLOW_CATALOG.slice(0, 8).map((w) => (
              <Link key={w.key} href={`${base}/workflows`}>
                <Card className="h-full transition-colors hover:border-primary/40">
                  <CardContent className="p-4">
                    <div className="flex items-center justify-between">
                      <Workflow className="size-4 text-primary" />
                      <ArrowRight className="size-3.5 text-muted-foreground" />
                    </div>
                    <p className="mt-3 text-sm font-medium">{w.name}</p>
                    <p className="mt-1 line-clamp-2 text-xs text-muted-foreground">{w.description}</p>
                  </CardContent>
                </Card>
              </Link>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
