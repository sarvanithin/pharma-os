import Link from "next/link";
import { ShieldCheck, ShieldAlert, Download } from "lucide-react";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { relativeTime, titleCase } from "@/lib/utils";

export default async function AuditPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();

  const [{ data: entries }, { data: integrity }] = await Promise.all([
    supabase
      .from("audit_log")
      .select("id, seq, actor_type, action, target_type, summary, model, created_at")
      .eq("org_id", ctx.org.id)
      .order("seq", { ascending: false })
      .limit(200),
    supabase.rpc("verify_audit_chain", { p_org_id: ctx.org.id }),
  ]);

  const verified = (integrity as { ok: boolean }[] | null)?.[0]?.ok ?? true;

  return (
    <div>
      <PageHeader
        title="Audit trail"
        description="A tamper-evident, hash-chained record of every action — ready for regulators."
        action={
          <Button asChild variant="outline" size="sm">
            <Link href={`/api/audit/export?slug=${slug}`}>
              <Download className="size-4" /> Export CSV
            </Link>
          </Button>
        }
      />
      <div className="space-y-4 p-6">
        <div
          className={`flex items-center gap-2 rounded-lg border p-3 text-sm ${
            verified ? "border-[var(--success)]/30 bg-[var(--success)]/5" : "border-destructive/30 bg-destructive/5"
          }`}
        >
          {verified ? (
            <>
              <ShieldCheck className="size-4 text-[var(--success)]" />
              <span>Hash chain verified — the audit log has not been tampered with.</span>
            </>
          ) : (
            <>
              <ShieldAlert className="size-4 text-destructive" />
              <span>Integrity check failed — the audit chain is broken.</span>
            </>
          )}
        </div>

        {!entries?.length ? (
          <EmptyState icon={<ShieldCheck />} title="No audit entries yet" />
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>#</TableHead>
                  <TableHead>Actor</TableHead>
                  <TableHead>Action</TableHead>
                  <TableHead>Summary</TableHead>
                  <TableHead>When</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {entries.map((e) => (
                  <TableRow key={e.id}>
                    <TableCell className="tabular-nums text-muted-foreground">{e.seq}</TableCell>
                    <TableCell>
                      <Badge variant={e.actor_type === "agent" ? "default" : e.actor_type === "system" ? "muted" : "secondary"}>
                        {e.actor_type}
                      </Badge>
                    </TableCell>
                    <TableCell className="font-mono text-xs">{e.action}</TableCell>
                    <TableCell className="max-w-md truncate text-muted-foreground">
                      {e.summary}
                      {e.model && <span className="ml-2 text-xs">· {e.model}</span>}
                    </TableCell>
                    <TableCell className="whitespace-nowrap text-muted-foreground">
                      {relativeTime(e.created_at)}
                    </TableCell>
                  </TableRow>
                ))}
              </TableBody>
            </Table>
          </div>
        )}
      </div>
    </div>
  );
}
