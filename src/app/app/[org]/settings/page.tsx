import { Plug } from "lucide-react";
import { requireOrg, canAdmin } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { PageHeader } from "@/components/app/page-header";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { SubmitButton } from "@/components/app/submit-button";
import { addConnector } from "@/server/connectors/actions";
import { relativeTime, titleCase } from "@/lib/utils";

export default async function SettingsPage({ params }: { params: Promise<{ org: string }> }) {
  const { org: slug } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();
  const admin = canAdmin(ctx.role);

  const [{ data: members }, { data: connectors }] = await Promise.all([
    supabase.from("memberships").select("role, users(email, full_name)").eq("org_id", ctx.org.id),
    supabase.from("connectors").select("*").eq("org_id", ctx.org.id).order("created_at", { ascending: false }),
  ]);

  return (
    <div>
      <PageHeader title="Settings" description="Organization, team, and data connectors." />
      <div className="grid gap-6 p-6 lg:grid-cols-2">
        <Card>
          <CardHeader>
            <CardTitle className="text-base">Organization</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2 text-sm">
            <div className="flex justify-between">
              <span className="text-muted-foreground">Name</span>
              <span className="font-medium">{ctx.org.name}</span>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Plan</span>
              <Badge variant="secondary">{ctx.org.plan}</Badge>
            </div>
            <div className="flex justify-between">
              <span className="text-muted-foreground">Your role</span>
              <Badge variant="muted">{ctx.role}</Badge>
            </div>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="text-base">Team</CardTitle>
          </CardHeader>
          <CardContent className="space-y-2">
            {((members ?? []) as unknown as { role: string; users: { email: string; full_name: string | null } | null }[]).map(
              (m, i) => (
                <div key={i} className="flex items-center justify-between text-sm">
                  <span>{m.users?.full_name || m.users?.email}</span>
                  <Badge variant="muted">{m.role}</Badge>
                </div>
              ),
            )}
          </CardContent>
        </Card>

        <Card className="lg:col-span-2">
          <CardHeader>
            <CardTitle className="text-base">Data connectors</CardTitle>
            <CardDescription>
              Connect LIMS, QMS, ELN, and other sources. (Simulated connectors for this MVP.)
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-4">
            {connectors && connectors.length > 0 && (
              <div className="space-y-2">
                {connectors.map((c) => (
                  <div key={c.id} className="flex items-center justify-between rounded-md border p-3 text-sm">
                    <div className="flex items-center gap-2">
                      <Plug className="size-4 text-primary" />
                      <span className="font-medium">{c.name}</span>
                      <Badge variant="secondary">{c.type.toUpperCase()}</Badge>
                    </div>
                    <span className="text-xs text-muted-foreground">
                      {c.last_synced_at ? `synced ${relativeTime(c.last_synced_at)}` : c.status}
                    </span>
                  </div>
                ))}
              </div>
            )}
            {admin ? (
              <form action={addConnector} className="flex flex-wrap items-end gap-3">
                <input type="hidden" name="slug" value={slug} />
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Type</label>
                  <select name="type" className="h-9 rounded-md border bg-transparent px-2 text-sm">
                    {["lims", "qms", "eln", "csv", "s3"].map((t) => (
                      <option key={t} value={t}>
                        {t.toUpperCase()}
                      </option>
                    ))}
                  </select>
                </div>
                <div className="space-y-1.5">
                  <label className="text-xs text-muted-foreground">Name</label>
                  <Input name="name" placeholder="Benchling ELN" required />
                </div>
                <SubmitButton variant="outline" pendingText="Connecting…">
                  Add connector
                </SubmitButton>
              </form>
            ) : (
              <p className="text-sm text-muted-foreground">Only admins can add connectors.</p>
            )}
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
