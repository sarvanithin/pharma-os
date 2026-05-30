import type { SupabaseClient } from "@supabase/supabase-js";
import { createAdminClient } from "@/lib/supabase/admin";
import { parseDocument } from "@/lib/parsing/pdf";
import { chunkPages } from "@/server/rag/chunk";
import { getEmbedder, toVector, EMBEDDING_MODEL } from "@/lib/embeddings";
import { hasVoyage, hasAnthropic } from "@/lib/env";
import { writeAudit } from "@/server/audit";
import { classifyAndExtract } from "@/server/processing/extract";
import { applyRouting } from "@/server/processing/routing";

async function setStatus(db: SupabaseClient, id: string, status: string, patch: object = {}) {
  await db.from("documents").update({ status, ...patch }).eq("id", id);
}

export interface ProcessOptions {
  withExtraction?: boolean;
}

/**
 * Full document pipeline: parse -> pages -> chunk -> embed -> classify/extract -> route.
 * Idempotent: re-running replaces pages, chunks, and extractions for the document.
 * Degrades gracefully when API keys are absent (parse + chunk still work offline).
 */
export async function runProcessing(
  documentId: string,
  orgId: string,
  opts: ProcessOptions = {},
) {
  const db = createAdminClient();
  const { data: doc } = await db
    .from("documents")
    .select("*")
    .eq("id", documentId)
    .eq("org_id", orgId)
    .single();
  if (!doc) throw new Error(`Document ${documentId} not found`);

  try {
    await setStatus(db, documentId, "parsing");

    // 1. Download + parse ----------------------------------------------------
    const { data: file, error: dlErr } = await db.storage
      .from("documents")
      .download(doc.storage_path);
    if (dlErr || !file) throw new Error(`Download failed: ${dlErr?.message}`);
    const bytes = new Uint8Array(await file.arrayBuffer());
    const pages = await parseDocument(bytes, doc.mime_type ?? "", doc.source_filename ?? "");

    await db.from("document_pages").delete().eq("document_id", documentId);
    if (pages.length) {
      await db.from("document_pages").insert(
        pages.map((p) => ({
          org_id: orgId,
          document_id: documentId,
          page_number: p.page,
          raw_text: p.text,
        })),
      );
    }
    await setStatus(db, documentId, "parsed", { page_count: pages.length });

    // 2. Chunk ---------------------------------------------------------------
    const chunks = chunkPages(pages);
    await db.from("chunks").delete().eq("document_id", documentId);

    let embeddings: string[] | null = null;
    if (hasVoyage() && chunks.length) {
      const vectors = await getEmbedder().embed(
        chunks.map((c) => c.content),
        "document",
      );
      embeddings = vectors.map(toVector);
    }

    if (chunks.length) {
      await db.from("chunks").insert(
        chunks.map((c, i) => ({
          org_id: orgId,
          document_id: documentId,
          document_version: doc.current_version,
          page_start: c.pageStart,
          page_end: c.pageEnd,
          chunk_index: c.chunkIndex,
          content: c.content,
          token_count: c.tokenCount,
          heading_path: c.headingPath,
          embedding: embeddings ? embeddings[i] : null,
          embedding_model: embeddings ? EMBEDDING_MODEL : null,
        })),
      );
    }
    await setStatus(db, documentId, embeddings ? "embedded" : "parsed");

    // 3. Classify + extract (Phase 3) ---------------------------------------
    if (opts.withExtraction !== false && hasAnthropic() && pages.length) {
      await classifyAndExtract(db, { documentId, orgId, pages, title: doc.title });
      await applyRouting(db, { documentId, orgId });
    }

    await setStatus(db, documentId, "ready");
    await writeAudit(db, {
      orgId,
      actorType: "system",
      action: "document.processed",
      targetType: "document",
      targetId: documentId,
      summary: `Processed "${doc.title}" — ${pages.length} pages, ${chunks.length} chunks${
        embeddings ? ", embedded" : ""
      }`,
      metadata: { pages: pages.length, chunks: chunks.length, embedded: Boolean(embeddings) },
    });
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    await setStatus(db, documentId, "failed", { error: message });
    await writeAudit(db, {
      orgId,
      actorType: "system",
      action: "document.processing_failed",
      targetType: "document",
      targetId: documentId,
      summary: message,
    });
    throw err;
  }
}
