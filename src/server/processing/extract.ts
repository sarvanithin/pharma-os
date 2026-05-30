import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { ParsedPage } from "@/lib/parsing/pdf";
import { generateStructured, generateJsonSchema } from "@/lib/anthropic/client";
import { writeAudit } from "@/server/audit";

export interface ExtractContext {
  documentId: string;
  orgId: string;
  pages: ParsedPage[];
  title: string;
}

const DOC_TYPES = [
  "csr",
  "patent",
  "ind",
  "protocol",
  "internal_report",
  "sop",
  "lab_record",
  "other",
] as const;

const classificationSchema = z.object({
  doc_type: z.enum(DOC_TYPES),
  confidence: z.number().min(0).max(1),
  rationale: z.string(),
  // Detected language as a BCP 47 / ISO 639-1 code (e.g. "en", "fr", "zh", "it").
  language: z.string().min(2).max(8),
  tags: z.array(z.string()),
  entities: z.array(
    z.object({
      type: z.enum([
        "molecule",
        "study",
        "trial",
        "patent",
        "person",
        "site",
        "endpoint",
        "indication",
        "other",
      ]),
      name: z.string(),
    }),
  ),
});

const REVIEW_THRESHOLD = 0.8;

function corpus(pages: ParsedPage[], maxChars = 12000) {
  let out = "";
  for (const p of pages) {
    if (out.length > maxChars) break;
    out += `\n\n[page ${p.page}]\n${p.text}`;
  }
  return out.slice(0, maxChars);
}

/** Classify the document, extract tags + entities, then run schema-based extraction. */
export async function classifyAndExtract(db: SupabaseClient, ctx: ExtractContext) {
  const text = corpus(ctx.pages);

  // 1. Classification + tags + entities (cheap, Haiku) ----------------------
  const { data: cls } = await generateStructured({
    model: "haiku",
    schema: classificationSchema,
    system:
      "You are a regulatory affairs analyst classifying pharmaceutical/biotech documents written in any language " +
      "(English, French, Italian, Chinese, etc.). Identify the document type, the primary language (as an ISO 639-1 code), " +
      "key tags, and named entities (molecules, studies, trials, endpoints, indications). Tags and entity names should be returned " +
      "in their original language as they appear in the document.",
    prompt: `Document title: "${ctx.title}"\n\nContent:\n${text}`,
    toolName: "classify_document",
    maxTokens: 1500,
  });

  await db
    .from("documents")
    .update({ doc_type: cls.doc_type, doc_type_confidence: cls.confidence, language: cls.language.toLowerCase() })
    .eq("id", ctx.documentId);

  // Tags (cap defensively — models don't always honor maxItems)
  for (const name of cls.tags.slice(0, 8)) {
    const { data: tag } = await db
      .from("tags")
      .upsert({ org_id: ctx.orgId, name }, { onConflict: "org_id,name" })
      .select("id")
      .single();
    if (tag) {
      await db
        .from("document_tags")
        .upsert({ document_id: ctx.documentId, tag_id: tag.id, org_id: ctx.orgId });
    }
  }

  // Entities + links
  for (const e of cls.entities.slice(0, 20)) {
    const { data: ent } = await db
      .from("entities")
      .upsert(
        { org_id: ctx.orgId, type: e.type, name: e.name },
        { onConflict: "org_id,type,name" },
      )
      .select("id")
      .single();
    if (ent) {
      await db.from("links").insert({
        org_id: ctx.orgId,
        from_type: "document",
        from_id: ctx.documentId,
        to_type: "entity",
        to_id: ent.id,
        relation: "mentions",
      });
    }
  }

  // 2. Schema-based field extraction (Opus, structured) ---------------------
  const { data: schema } = await db
    .from("extraction_schemas")
    .select("*")
    .eq("doc_type", cls.doc_type)
    .eq("is_active", true)
    .or(`org_id.eq.${ctx.orgId},org_id.is.null`)
    .order("org_id", { nullsFirst: false })
    .limit(1)
    .maybeSingle();

  if (schema) {
    const wrapper = {
      type: "object",
      properties: {
        fields: schema.json_schema,
        confidence: { type: "number", minimum: 0, maximum: 1 },
        anchors: {
          type: "array",
          items: {
            type: "object",
            properties: {
              field: { type: "string" },
              page: { type: "number" },
              quote: { type: "string" },
            },
            required: ["field"],
          },
        },
      },
      required: ["fields", "confidence"],
    } as Record<string, unknown>;

    const { data: extractedRaw } = await generateJsonSchema({
      model: "opus",
      name: "submit_extraction",
      description: schema.prompt_template ?? "Extract the requested fields with page-cited quotes.",
      inputSchema: wrapper,
      system:
        "You extract structured data from pharmaceutical regulatory documents. " +
        "Only use information present in the document. For every field, include an anchor " +
        "with the source page number and a short verbatim quote. If a field is unknown, omit it.",
      prompt: `Document title: "${ctx.title}"\nType: ${cls.doc_type}\n\nContent:\n${corpus(
        ctx.pages,
        20000,
      )}`,
      maxTokens: 4096,
    });

    const extracted = extractedRaw as {
      fields?: Record<string, unknown>;
      confidence?: number;
      anchors?: { field: string; page?: number; quote?: string }[];
    };
    const confidence = extracted.confidence ?? cls.confidence;

    await db.from("extractions").delete().eq("document_id", ctx.documentId);
    await db.from("extractions").insert({
      org_id: ctx.orgId,
      document_id: ctx.documentId,
      schema_id: schema.id,
      fields: extracted.fields ?? {},
      confidence,
      status: confidence >= REVIEW_THRESHOLD ? "auto" : "needs_review",
      source_anchors: (extracted.anchors ?? []).map((a) => ({
        field: a.field,
        page: a.page ?? null,
        quote: a.quote ?? null,
      })),
    });
  }

  await writeAudit(db, {
    orgId: ctx.orgId,
    actorType: "agent",
    action: "document.classified",
    targetType: "document",
    targetId: ctx.documentId,
    model: "claude-haiku-4-5",
    summary: `Classified as ${cls.doc_type} (${Math.round(cls.confidence * 100)}%), ${
      cls.entities.length
    } entities`,
    metadata: { doc_type: cls.doc_type, confidence: cls.confidence },
  });
}
