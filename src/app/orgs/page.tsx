import Link from "next/link";
import { ArrowRight, Building2, Plus } from "lucide-react";
import { listMyOrgs, requireUser } from "@/lib/auth/session";
import { createOrgAction } from "./actions";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Card, CardContent, CardHeader, CardTitle, CardDescription } from "@/components/ui/card";

export default async function OrgsPage() {
  await requireUser();
  const orgs = await listMyOrgs();

  return (
    <div className="mx-auto w-full max-w-2xl px-6 py-16">
      <h1 className="text-2xl font-semibold tracking-tight">Your organizations</h1>
      <p className="mt-1 text-muted-foreground">Choose a workspace or create a new one.</p>

      {orgs.length > 0 && (
        <div className="mt-8 space-y-3">
          {orgs.map((org) => (
            <Link key={org.id} href={`/app/${org.slug}`}>
              <Card className="transition-colors hover:border-primary/40">
                <CardContent className="flex items-center justify-between p-5">
                  <div className="flex items-center gap-3">
                    <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
                      <Building2 className="size-5" />
                    </div>
                    <div>
                      <p className="font-medium">{org.name}</p>
                      <p className="text-xs text-muted-foreground">{org.plan} plan</p>
                    </div>
                  </div>
                  <ArrowRight className="size-4 text-muted-foreground" />
                </CardContent>
              </Card>
            </Link>
          ))}
        </div>
      )}

      <Card className="mt-8">
        <CardHeader>
          <CardTitle className="text-base">Create a new organization</CardTitle>
          <CardDescription>Each org is an isolated, multi-tenant workspace.</CardDescription>
        </CardHeader>
        <CardContent>
          <form action={createOrgAction} className="flex items-end gap-3">
            <div className="flex-1 space-y-1.5">
              <Label htmlFor="name">Organization name</Label>
              <Input id="name" name="name" placeholder="Acme Therapeutics" required />
            </div>
            <Button type="submit">
              <Plus className="size-4" /> Create
            </Button>
          </form>
        </CardContent>
      </Card>
    </div>
  );
}
