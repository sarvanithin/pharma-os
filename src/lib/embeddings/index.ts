/**
 * Embeddings + reranking behind a small interface so the provider is swappable.
 * Default implementation: Voyage AI (voyage-3, 1024-dim + rerank-2), recommended by
 * Anthropic for technical/scientific/legal text (good for patents & regulatory docs).
 */

export const EMBEDDING_DIM = 1024;
export const EMBEDDING_MODEL = "voyage-3";
export const RERANK_MODEL = "rerank-2";

const VOYAGE_URL = "https://api.voyageai.com/v1";

export interface Embedder {
  model: string;
  embed(texts: string[], inputType?: "query" | "document"): Promise<number[][]>;
  rerank(query: string, documents: string[], topK: number): Promise<RerankResult[]>;
}

export interface RerankResult {
  index: number;
  score: number;
}

function voyageHeaders() {
  const key = process.env.VOYAGE_API_KEY;
  if (!key) throw new Error("VOYAGE_API_KEY is not set");
  return { Authorization: `Bearer ${key}`, "Content-Type": "application/json" };
}

export const voyageEmbedder: Embedder = {
  model: EMBEDDING_MODEL,
  async embed(texts, inputType = "document") {
    if (texts.length === 0) return [];
    const out: number[][] = [];
    // Voyage accepts batches; keep them modest to stay under payload limits.
    for (let i = 0; i < texts.length; i += 128) {
      const batch = texts.slice(i, i + 128);
      // Retry-on-429 lets free-tier rate limits (3 RPM) self-throttle without crashing the pipeline.
      let res: Response | null = null;
      for (let attempt = 0; attempt < 4; attempt++) {
        res = await fetch(`${VOYAGE_URL}/embeddings`, {
          method: "POST",
          headers: voyageHeaders(),
          body: JSON.stringify({
            model: EMBEDDING_MODEL,
            input: batch,
            input_type: inputType,
            output_dimension: EMBEDDING_DIM,
          }),
        });
        if (res.status !== 429) break;
        await new Promise((r) => setTimeout(r, 25_000 * (attempt + 1)));
      }
      if (!res || !res.ok) {
        throw new Error(`Voyage embed failed: ${res?.status ?? "no response"} ${res ? await res.text() : ""}`);
      }
      const json = (await res.json()) as { data: { embedding: number[] }[] };
      out.push(...json.data.map((d) => d.embedding));
    }
    return out;
  },
  async rerank(query, documents, topK) {
    if (documents.length === 0) return [];
    const res = await fetch(`${VOYAGE_URL}/rerank`, {
      method: "POST",
      headers: voyageHeaders(),
      body: JSON.stringify({
        model: RERANK_MODEL,
        query,
        documents,
        top_k: Math.min(topK, documents.length),
      }),
    });
    if (!res.ok) throw new Error(`Voyage rerank failed: ${res.status} ${await res.text()}`);
    const json = (await res.json()) as {
      data: { index: number; relevance_score: number }[];
    };
    return json.data.map((d) => ({ index: d.index, score: d.relevance_score }));
  },
};

export function getEmbedder(): Embedder {
  return voyageEmbedder;
}

/** pgvector text input format: "[v1,v2,...]". Use when inserting / querying vectors. */
export function toVector(values: number[]): string {
  return `[${values.join(",")}]`;
}
