import Link from "next/link";
import { Database, FlaskConical, ClipboardList, FileStack } from "lucide-react";
import { requireOrg } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { UploadZone } from "@/components/app/upload-zone";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";

const CONNECTORS = [
  { type: "lims", label: "LIMS", icon: FlaskConical, desc: "Lab information management" },
  { type: "qms", label: "QMS", icon: ClipboardList, desc: "Quality management system" },
  { type: "eln", label: "ELN", icon: FileStack, desc: "Electronic lab notebook" },
  { type: "csv", label: "CSV / S3", icon: Database, desc: "Bulk structured import" },
];

export default async function IngestPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();
  const { data: workspaces } = await supabase
    .from("workspaces")
    .select("id, name")
    .eq("org_id", ctx.org.id)
    .order("created_at");

  return (
    <div>
      <PageHeader
        title="Ingest data"
        description="Upload documents or connect a source. Everything becomes one unified, AI-readable layer."
      />
      <div className="grid gap-8 p-6 lg:grid-cols-3">
        <div className="lg:col-span-2">
          <Card>
            <CardHeader>
              <CardTitle className="text-base">Upload documents</CardTitle>
              <CardDescription>
                Files are parsed, chunked, embedded, classified, and routed automatically.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <UploadZone slug={slug} workspaces={workspaces ?? []} />
            </CardContent>
          </Card>
        </div>

        <div>
          <h2 className="mb-3 text-sm font-medium text-muted-foreground">Connectors</h2>
          <div className="space-y-3">
            {CONNECTORS.map((c) => (
              <Link key={c.type} href={`/app/${slug}/settings`}>
                <Card className="transition-colors hover:border-primary/40">
                  <CardContent className="flex items-center gap-3 p-4">
                    <div className="flex size-9 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <c.icon className="size-4" />
                    </div>
                    <div className="flex-1">
                      <p className="text-sm font-medium">{c.label}</p>
                      <p className="text-xs text-muted-foreground">{c.desc}</p>
                    </div>
                    <Badge variant="muted">Configure</Badge>
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
