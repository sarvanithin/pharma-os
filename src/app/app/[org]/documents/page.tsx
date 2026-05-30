import Link from "next/link";
import { FileText, Upload } from "lucide-react";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { StatusBadge } from "@/components/status-badge";
import { EmptyState } from "@/components/ui/misc";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@/components/ui/table";
import { relativeTime, titleCase } from "@/lib/utils";

export default async function DocumentsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();
  const { data: docs } = await supabase
    .from("documents")
    .select("id, title, doc_type, status, page_count, byte_size, created_at")
    .eq("org_id", ctx.org.id)
    .order("created_at", { ascending: false });

  return (
    <div>
      <PageHeader
        title="Documents"
        description="Every document, parsed and connected into your data room."
        action={
          <Button asChild>
            <Link href={`/app/${slug}/ingest`}>
              <Upload className="size-4" /> Upload
            </Link>
          </Button>
        }
      />
      <div className="p-6">
        {!docs?.length ? (
          <EmptyState
            icon={<FileText />}
            title="No documents yet"
            description="Upload CSRs, patents, INDs or reports to build your data room."
            action={
              <Button asChild>
                <Link href={`/app/${slug}/ingest`}>
                  <Upload className="size-4" /> Upload documents
                </Link>
              </Button>
            }
          />
        ) : (
          <div className="rounded-xl border">
            <Table>
              <TableHeader>
                <TableRow>
                  <TableHead>Title</TableHead>
                  <TableHead>Type</TableHead>
                  <TableHead>Status</TableHead>
                  <TableHead>Pages</TableHead>
                  <TableHead>Added</TableHead>
                </TableRow>
              </TableHeader>
              <TableBody>
                {docs.map((d) => (
                  <TableRow key={d.id}>
                    <TableCell>
                      <Link
                        href={`/app/${slug}/documents/${d.id}`}
                        className="font-medium hover:text-primary"
                      >
                        {d.title}
                      </Link>
                    </TableCell>
                    <TableCell>
                      <Badge variant="secondary">{titleCase(d.doc_type)}</Badge>
                    </TableCell>
                    <TableCell>
                      <StatusBadge status={d.status} />
                    </TableCell>
                    <TableCell className="tabular-nums text-muted-foreground">
                      {d.page_count || "—"}
                    </TableCell>
                    <TableCell className="text-muted-foreground">
                      {relativeTime(d.created_at)}
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
