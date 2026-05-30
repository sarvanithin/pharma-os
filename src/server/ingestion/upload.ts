"use server";

import { createHash } from "node:crypto";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import { requireOrg, canWrite } from "@/lib/auth/session";
import { dispatchProcessing } from "@/server/processing/dispatch";
import { writeAudit } from "@/server/audit";

export async function uploadDocuments(formData: FormData) {
  const slug = String(formData.get("slug"));
  const workspaceId = (formData.get("workspaceId") as string) || null;
  const ctx = await requireOrg(slug);
  if (!canWrite(ctx.role)) throw new Error("Insufficient permissions");

  const files = formData.getAll("files").filter((f): f is File => f instanceof File && f.size > 0);
  if (files.length === 0) return { count: 0 };

  const supabase = await createClient();
  const admin = createAdminClient();

  for (const file of files) {
    const bytes = Buffer.from(await file.arrayBuffer());
    const hash = createHash("sha256").update(bytes).digest("hex");

    const { data: doc, error } = await supabase
      .from("documents")
      .insert({
        org_id: ctx.org.id,
        workspace_id: workspaceId,
        title: file.name.replace(/\.[^.]+$/, ""),
        source_filename: file.name,
        mime_type: file.type || "application/octet-stream",
        byte_size: file.size,
        content_hash: hash,
        status: "uploaded",
        created_by: ctx.userId,
      })
      .select("id")
      .single();
    if (error || !doc) throw new Error(error?.message ?? "Failed to create document");

    // Supabase storage keys must be ASCII; preserve the user's original filename on the row.
    const ext = file.name.match(/\.[^.]+$/)?.[0] ?? "";
    const path = `${ctx.org.id}/${doc.id}/source${ext}`;
    const { error: upErr } = await admin.storage
      .from("documents")
      .upload(path, bytes, { contentType: file.type || undefined, upsert: true });
    if (upErr) throw new Error(`Upload failed: ${upErr.message}`);

    await supabase.from("documents").update({ storage_path: path }).eq("id", doc.id);

    await writeAudit(supabase, {
      orgId: ctx.org.id,
      actorType: "user",
      actorId: ctx.userId,
      action: "document.uploaded",
      targetType: "document",
      targetId: doc.id,
      summary: `Uploaded "${file.name}"`,
    });

    await dispatchProcessing(doc.id, ctx.org.id);
  }

  revalidatePath(`/app/${slug}/documents`);
  revalidatePath(`/app/${slug}`);
  return { count: files.length };
}
