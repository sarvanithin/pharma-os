"use server";

import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, canWrite } from "@/lib/auth/session";
import { writeAudit } from "@/server/audit";

export async function decideExtraction(formData: FormData) {
  const slug = String(formData.get("slug"));
  const extractionId = String(formData.get("extractionId"));
  const documentId = String(formData.get("documentId"));
  const decision = String(formData.get("decision")) as "approved" | "rejected";

  const ctx = await requireOrg(slug);
  if (!canWrite(ctx.role)) throw new Error("Insufficient permissions");

  const supabase = await createClient();
  const { error } = await supabase
    .from("extractions")
    .update({ status: decision, reviewed_by: ctx.userId, reviewed_at: new Date().toISOString() })
    .eq("id", extractionId)
    .eq("org_id", ctx.org.id);
  if (error) throw new Error(error.message);

  await writeAudit(supabase, {
    orgId: ctx.org.id,
    actorType: "user",
    actorId: ctx.userId,
    action: `extraction.${decision}`,
    targetType: "extraction",
    targetId: extractionId,
    summary: `Extraction ${decision} after human review`,
  });

  revalidatePath(`/app/${slug}/documents/${documentId}`);
  revalidatePath(`/app/${slug}/documents`);
}
