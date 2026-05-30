import type { SupabaseClient } from "@supabase/supabase-js";
import { getEmbedder, toVector } from "@/lib/embeddings";
import { hasVoyage } from "@/lib/env";
import type { ChunkMatch, Citation } from "@/types/domain";

export interface RetrieveOptions {
  workspaceId?: string | null;
  docType?: string | null;
  matchCount?: number;
}

/**
 * Hybrid retrieval over the data room. With Voyage configured this embeds the query
 * and runs vector+keyword fusion (match_chunks RPC) followed by cross-encoder rerank.
 * Without Voyage it degrades to keyword-only search so the data room still works.
 */
export async function retrieve(
  supabase: SupabaseClient,
  orgId: string,
  query: string,
  opts: RetrieveOptions = {},
): Promise<ChunkMatch[]> {
  const matchCount = opts.matchCount ?? 10;

  if (hasVoyage()) {
    const [queryVec] = await getEmbedder().embed([query], "query");
    const { data, error } = await supabase.rpc("match_chunks", {
      p_org_id: orgId,
      p_query_embedding: toVector(queryVec),
      p_query_text: query,
      p_match_count: 40,
      p_candidate_count: 60,
      p_workspace_id: opts.workspaceId ?? null,
      p_doc_type: opts.docType ?? null,
    });
    if (error) throw new Error(`Retrieval failed: ${error.message}`);
    const candidates = (data ?? []) as ChunkMatch[];
    if (candidates.length === 0) return [];

    // Cross-encoder rerank for precision.
    const ranked = await getEmbedder().rerank(
      query,
      candidates.map((c) => c.content),
      matchCount,
    );
    return ranked.map((r) => candidates[r.index]).filter(Boolean);
  }

  // Keyword-only fallback.
  const { data } = await supabase
    .from("chunks")
    .select(
      "id, document_id, content, page_start, page_end, heading_path, chunk_index, documents(title, doc_type)",
    )
    .eq("org_id", orgId)
    .textSearch("fts", query, { type: "websearch" })
    .limit(matchCount);

  return ((data ?? []) as unknown as RawChunk[]).map((c) => ({
    id: c.id,
    document_id: c.document_id,
    content: c.content,
    page_start: c.page_start,
    page_end: c.page_end,
    heading_path: c.heading_path,
    chunk_index: c.chunk_index,
    document_title: c.documents?.title ?? "Untitled",
    doc_type: c.documents?.doc_type ?? "other",
    vector_distance: null,
    rrf_score: 0,
  }));
}

interface RawChunk {
  id: string;
  document_id: string;
  content: string;
  page_start: number | null;
  page_end: number | null;
  heading_path: string[] | null;
  chunk_index: number;
  documents: { title: string; doc_type: ChunkMatch["doc_type"] } | null;
}

export function buildCitations(chunks: ChunkMatch[]): Citation[] {
  return chunks.map((c, i) => ({
    marker: i + 1,
    documentId: c.document_id,
    documentTitle: c.document_title,
    chunkId: c.id,
    pageStart: c.page_start,
    pageEnd: c.page_end,
  }));
}
