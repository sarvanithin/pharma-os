"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import { ChevronsUpDown, LogOut } from "lucide-react";
import { createClient } from "@/lib/supabase/client";
import { Button } from "@/components/ui/button";
import type { MembershipRole } from "@/types/domain";

export function Topbar({
  orgName,
  role,
  email,
}: {
  orgName: string;
  role: MembershipRole;
  email: string;
}) {
  const router = useRouter();

  async function signOut() {
    await createClient().auth.signOut();
    router.push("/login");
    router.refresh();
  }

  return (
    <header className="flex h-14 items-center justify-between border-b bg-background px-5">
      <Link
        href="/orgs"
        className="flex items-center gap-2 text-sm font-medium hover:text-primary"
      >
        {orgName}
        <ChevronsUpDown className="size-3.5 text-muted-foreground" />
        <span className="rounded bg-muted px-1.5 py-0.5 text-[10px] uppercase text-muted-foreground">
          {role}
        </span>
      </Link>
      <div className="flex items-center gap-3">
        <span className="hidden text-sm text-muted-foreground sm:inline">{email}</span>
        <Button variant="ghost" size="sm" onClick={signOut}>
          <LogOut className="size-4" /> Sign out
        </Button>
      </div>
    </header>
  );
}
