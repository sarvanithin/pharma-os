"use server";

import { z } from "zod";
import { revalidatePath } from "next/cache";
import { createClient } from "@/lib/supabase/server";
import { requireOrg, canWrite } from "@/lib/auth/session";
import { generateStructured } from "@/lib/anthropic/client";
import { hasAnthropic } from "@/lib/env";
import { writeAudit } from "@/server/audit";
import type { Json } from "@/types/domain";

const resultsSchema = z.object({
  results: z.array(
    z.object({
      rule_key: z.string(),
      status: z.enum(["pass", "fail", "partial"]),
      evidence: z.string(),
    }),
  ),
});

export async function runComplianceCheck(formData: FormData) {
  const slug = String(formData.get("slug"));
  const documentId = String(formData.get("documentId"));
  const standard = String(formData.get("standard")) as "ich_e6_r3" | "cfr_part_11";

  const ctx = await requireOrg(slug);
  if (!canWrite(ctx.role)) throw new Error("Insufficient permissions");

  const supabase = await createClient();
  const [{ data: pages }, { data: rules }] = await Promise.all([
    supabase.from("document_pages").select("page_number, raw_text").eq("document_id", documentId).order("page_number").limit(40),
    supabase.from("compliance_rules").select("rule_key, description").eq("standard", standard).is("org_id", null),
  ]);

  const corpus = (pages ?? [])
    .map((p) => `[p${p.page_number}] ${p.raw_text ?? ""}`)
    .join("\n")
    .slice(0, 16000);

  let results: { rule_key: string; status: "pass" | "fail" | "partial"; evidence: string }[];

  if (hasAnthropic() && (rules?.length ?? 0) > 0) {
    const { data } = await generateStructured({
      model: "opus",
      schema: resultsSchema,
      system:
        "You are a GCP / regulatory compliance auditor. For each rule, decide whether the document demonstrates compliance (pass), partially (partial), or not (fail). Provide a short evidence note citing the page where possible. Base judgments only on the document.",
      prompt: `Standard: ${standard}\n\nRules:\n${(rules ?? [])
        .map((r) => `- ${r.rule_key}: ${r.description}`)
        .join("\n")}\n\nDocument:\n${corpus}`,
      toolName: "submit_compliance",
      maxTokens: 2000,
    });
    results = data.results;
  } else {
    results = (rules ?? []).map((r) => ({
      rule_key: r.rule_key,
      status: "partial" as const,
      evidence: hasAnthropic() ? "No rules configured." : "Set ANTHROPIC_API_KEY to run automated checks.",
    }));
  }

  const total = results.length || 1;
  const pass = results.filter((r) => r.status === "pass").length;
  const partial = results.filter((r) => r.status === "partial").length;
  const score = (pass + 0.5 * partial) / total;
  const status = score >= 0.8 ? "pass" : score >= 0.4 ? "partial" : "fail";

  await supabase.from("compliance_checks").insert({
    org_id: ctx.org.id,
    document_id: documentId,
    standard,
    results: results as unknown as Json,
    score,
    status,
    checked_by: ctx.userId,
  });

  await writeAudit(supabase, {
    orgId: ctx.org.id,
    actorType: "user",
    actorId: ctx.userId,
    action: "compliance.checked",
    targetType: "document",
    targetId: documentId,
    model: hasAnthropic() ? "claude-opus-4-7" : undefined,
    summary: `${standard.toUpperCase()} check: ${status} (${Math.round(score * 100)}%)`,
    metadata: { standard, score, status },
  });

  revalidatePath(`/app/${slug}/compliance`);
}
