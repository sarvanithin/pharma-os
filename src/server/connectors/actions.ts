"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, canAdmin } from "@/lib/auth/session";
import { writeAudit } from "@/server/audit";

export async function addConnector(formData: FormData) {
  const slug = String(formData.get("slug"));
  const type = String(formData.get("type"));
  const name = String(formData.get("name") ?? "").trim();
  const ctx = await requireOrg(slug);
  if (!canAdmin(ctx.role)) throw new Error("Only admins can add connectors");
  if (!name) return;

  const supabase = await createClient();
  const { data, error } = await supabase
    .from("connectors")
    .insert({
      org_id: ctx.org.id,
      type,
      name,
      status: "connected",
      config: { simulated: true },
      last_synced_at: new Date().toISOString(),
      created_by: ctx.userId,
    })
    .select("id")
    .single();
  if (error) throw new Error(error.message);

  await writeAudit(supabase, {
    orgId: ctx.org.id,
    actorType: "user",
    actorId: ctx.userId,
    action: "connector.added",
    targetType: "connector",
    targetId: data?.id,
    summary: `Connected ${type.toUpperCase()} source "${name}"`,
  });

  revalidatePath(`/app/${slug}/settings`);
}
