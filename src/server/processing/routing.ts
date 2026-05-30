import type { SupabaseClient } from "@supabase/supabase-js";
import { writeAudit } from "@/server/audit";

/**
 * Evaluate declarative routing rules against a processed document.
 * A rule predicate matches on { doc_type } / { tag }; actions can move the document
 * to a workspace or trigger a downstream workflow.
 */
export async function applyRouting(
  db: SupabaseClient,
  { documentId, orgId }: { documentId: string; orgId: string },
) {
  const { data: rules } = await db
    .from("routing_rules")
    .select("*")
    .eq("org_id", orgId)
    .eq("is_active", true);
  if (!rules?.length) return;

  const { data: doc } = await db
    .from("documents")
    .select("id, doc_type, workspace_id")
    .eq("id", documentId)
    .single();
  if (!doc) return;

  const { data: tagRows } = await db
    .from("document_tags")
    .select("tags(name)")
    .eq("document_id", documentId);
  const tags = ((tagRows ?? []) as unknown as { tags: { name: string } | null }[])
    .map((t) => t.tags?.name)
    .filter(Boolean) as string[];

  for (const rule of rules) {
    const pred = (rule.predicate ?? {}) as { doc_type?: string; tag?: string };
    const matches =
      (!pred.doc_type || pred.doc_type === doc.doc_type) &&
      (!pred.tag || tags.includes(pred.tag));
    if (!matches) continue;

    const action = (rule.action ?? {}) as { workspace_id?: string };
    if (action.workspace_id && action.workspace_id !== doc.workspace_id) {
      await db
        .from("documents")
        .update({ workspace_id: action.workspace_id })
        .eq("id", documentId);
    }
    await writeAudit(db, {
      orgId,
      actorType: "system",
      action: "document.routed",
      targetType: "document",
      targetId: documentId,
      summary: `Matched routing rule "${rule.name}"`,
      metadata: { rule_id: rule.id },
    });
  }
}
