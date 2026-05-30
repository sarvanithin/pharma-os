import { redirect } from "next/navigation";
import { createClient } from "@/lib/supabase/server";
import type { MembershipRole, OrgContext, Organization } from "@/types/domain";

export async function getCurrentUser() {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}

/** Resolve the org by slug and the caller's role within it. Redirects if no access. */
export async function requireOrg(slug: string): Promise<OrgContext> {
  const user = await requireUser();
  const supabase = await createClient();

  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();

  if (!org) redirect("/orgs");

  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();

  if (!membership) redirect("/orgs");

  return {
    org: org as Organization,
    role: membership.role as MembershipRole,
    userId: user.id,
  };
}

/** Like requireOrg but returns null instead of redirecting — for route handlers. */
export async function getOrgContext(slug: string): Promise<OrgContext | null> {
  const user = await getCurrentUser();
  if (!user) return null;
  const supabase = await createClient();
  const { data: org } = await supabase
    .from("organizations")
    .select("*")
    .eq("slug", slug)
    .maybeSingle();
  if (!org) return null;
  const { data: membership } = await supabase
    .from("memberships")
    .select("role")
    .eq("org_id", org.id)
    .eq("user_id", user.id)
    .maybeSingle();
  if (!membership) return null;
  return { org: org as Organization, role: membership.role as MembershipRole, userId: user.id };
}

export async function listMyOrgs(): Promise<Organization[]> {
  const user = await getCurrentUser();
  if (!user) return [];
  const supabase = await createClient();
  const { data } = await supabase
    .from("memberships")
    .select("organizations(*)")
    .eq("user_id", user.id);
  return ((data ?? []) as unknown as { organizations: Organization | null }[])
    .map((m) => m.organizations)
    .filter((o): o is Organization => Boolean(o));
}

const WRITE_ROLES: MembershipRole[] = ["owner", "admin", "member"];

export function canWrite(role: MembershipRole) {
  return WRITE_ROLES.includes(role);
}

export function canAdmin(role: MembershipRole) {
  return role === "owner" || role === "admin";
}
