"use server";

import { redirect } from "next/navigation";
import { nanoid } from "nanoid";
import { createClient } from "@/lib/supabase/server";
import { requireUser } from "@/lib/auth/session";
import { writeAudit } from "@/server/audit";

function slugify(name: string) {
  return (
    name
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, "-")
      .replace(/^-+|-+$/g, "")
      .slice(0, 40) || "org"
  );
}

export async function createOrgAction(formData: FormData) {
  const user = await requireUser();
  const name = String(formData.get("name") ?? "").trim();
  if (!name) return;

  const supabase = await createClient();
  const slug = `${slugify(name)}-${nanoid(6).toLowerCase()}`;

  const { data: orgId, error } = await supabase.rpc("create_organization", {
    p_name: name,
    p_slug: slug,
  });
  if (error || !orgId) {
    throw new Error(error?.message ?? "Failed to create organization");
  }

  await supabase.from("workspaces").insert({
    org_id: orgId,
    name: "Default workspace",
    description: "Your first program workspace",
    created_by: user.id,
  });

  await writeAudit(supabase, {
    orgId,
    actorType: "user",
    actorId: user.id,
    action: "org.created",
    targetType: "organization",
    targetId: orgId,
    summary: `Created organization "${name}"`,
  });

  redirect(`/app/${slug}`);
}
