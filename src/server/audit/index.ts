import type { SupabaseClient } from "@supabase/supabase-js";
import type { Json } from "@/types/domain";

export interface AuditInput {
  orgId: string;
  actorType: "user" | "agent" | "system";
  actorId?: string | null;
  action: string;
  targetType?: string;
  targetId?: string | null;
  summary?: string;
  model?: string;
  promptRef?: string;
  responseRef?: string;
  metadata?: Json;
}

/**
 * Append an entry to the tamper-evident audit log. The DB trigger computes the
 * hash chain; never set hash/prev_hash here. Pass either a user-scoped client
 * (server actions) or the admin client (background jobs).
 */
export async function writeAudit(supabase: SupabaseClient, input: AuditInput) {
  const { error } = await supabase.from("audit_log").insert({
    org_id: input.orgId,
    actor_type: input.actorType,
    actor_id: input.actorId ?? null,
    action: input.action,
    target_type: input.targetType ?? null,
    target_id: input.targetId ?? null,
    summary: input.summary ?? null,
    model: input.model ?? null,
    prompt_ref: input.promptRef ?? null,
    response_ref: input.responseRef ?? null,
    metadata: input.metadata ?? {},
  });
  if (error) {
    // Auditing must never silently fail in a regulated system — surface it loudly.
    console.error("[audit] failed to write entry", input.action, error.message);
  }
}
