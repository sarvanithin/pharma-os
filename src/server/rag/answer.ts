import type { ChunkMatch } from "@/types/domain";

export const RAG_SYSTEM = `You are Pharma OS, an analyst for biopharma R&D teams. Answer the user's question using ONLY the provided sources from their data room.

Rules:
- Ground every claim in the sources. After each claim, cite the source number(s) in square brackets, e.g. [1] or [2][3].
- If the sources do not contain the answer, say so plainly: "I couldn't find that in your data room." Do not use outside knowledge.
- Be precise and concise. Prefer specifics (numbers, endpoints, dates) from the sources.
- This supports regulated decision-making; never fabricate.`;

export function buildContext(chunks: ChunkMatch[]): string {
  return chunks
    .map((c, i) => {
      const loc = c.page_start ? ` (p.${c.page_start}${c.page_end && c.page_end !== c.page_start ? `–${c.page_end}` : ""})` : "";
      const heading = c.heading_path?.length ? ` › ${c.heading_path.join(" › ")}` : "";
      return `[${i + 1}] ${c.document_title}${loc}${heading}\n${c.content}`;
    })
    .join("\n\n---\n\n");
}

export function buildUserPrompt(query: string, chunks: ChunkMatch[]): string {
  if (chunks.length === 0) {
    return `Question: ${query}\n\n(No sources were found in the data room for this question.)`;
  }
  return `Sources:\n\n${buildContext(chunks)}\n\n---\n\nQuestion: ${query}`;
}
