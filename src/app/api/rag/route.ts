import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/session";
import { retrieve, buildCitations } from "@/server/rag/retrieve";
import { RAG_SYSTEM, buildUserPrompt } from "@/server/rag/answer";
import { streamChat, MODELS } from "@/lib/anthropic/client";
import { hasAnthropic } from "@/lib/env";
import { writeAudit } from "@/server/audit";

export const runtime = "nodejs";
export const maxDuration = 60;

export async function POST(req: NextRequest) {
  const { query, slug, workspaceId, docType } = await req.json();
  if (!query || !slug) {
    return NextResponse.json({ error: "query and slug required" }, { status: 400 });
  }

  const ctx = await getOrgContext(slug);
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const chunks = await retrieve(supabase, ctx.org.id, query, { workspaceId, docType });
  const citations = buildCitations(chunks);
  const citationHeader = Buffer.from(JSON.stringify(citations)).toString("base64");

  await writeAudit(supabase, {
    orgId: ctx.org.id,
    actorType: "user",
    actorId: ctx.userId,
    action: "data_room.query",
    summary: query.slice(0, 200),
    model: hasAnthropic() ? MODELS.sonnet : undefined,
    metadata: { sources: citations.length, doc_type: docType ?? null },
  });

  const headers = {
    "Content-Type": "text/plain; charset=utf-8",
    "x-citations": citationHeader,
    "Cache-Control": "no-cache",
  };

  // Without an Anthropic key, return the retrieved sources so the data room still works.
  if (!hasAnthropic()) {
    const body =
      chunks.length === 0
        ? "No matching sources found in your data room. Upload documents to build it."
        : `Add ANTHROPIC_API_KEY to generate cited answers. Meanwhile, here are the top matching sources:\n\n` +
          chunks
            .map((c, i) => `[${i + 1}] ${c.document_title}${c.page_start ? ` (p.${c.page_start})` : ""}`)
            .join("\n");
    return new NextResponse(body, { headers });
  }

  const stream = new ReadableStream<Uint8Array>({
    async start(controller) {
      const enc = new TextEncoder();
      try {
        await streamChat(
          {
            model: "sonnet",
            maxTokens: 1500,
            system: RAG_SYSTEM,
            prompt: buildUserPrompt(query, chunks),
          },
          (delta) => controller.enqueue(enc.encode(delta)),
        );
      } catch (err) {
        controller.enqueue(
          enc.encode(`\n\n[error generating answer: ${err instanceof Error ? err.message : "unknown"}]`),
        );
      } finally {
        controller.close();
      }
    },
  });

  return new NextResponse(stream, { headers });
}
