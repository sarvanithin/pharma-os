import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { retrieve, buildCitations } from "@/server/rag/retrieve";

/**
 * Tests keyword retrieval over the data room (no Voyage key required).
 * Validates the fallback path of retrieve() + citation construction.
 */
const db = createAdminClient();
let orgId: string;
let docId: string;

describe("data room retrieval (keyword path)", () => {
  beforeAll(async () => {
    const { data: org } = await db
      .from("organizations")
      .insert({ name: "RAG Test", slug: `rag-${Date.now()}` })
      .select("id")
      .single();
    orgId = org!.id;
    const { data: doc } = await db
      .from("documents")
      .insert({ org_id: orgId, title: "Study Report", doc_type: "csr", status: "ready" })
      .select("id")
      .single();
    docId = doc!.id;

    await db.from("chunks").insert([
      {
        org_id: orgId,
        document_id: docId,
        chunk_index: 0,
        content:
          "The primary endpoint was the change from baseline in disease activity at week 12 and was met (p<0.001).",
        page_start: 4,
        page_end: 4,
      },
      {
        org_id: orgId,
        document_id: docId,
        chunk_index: 1,
        content: "Manufacturing was performed under GMP at the contract facility.",
        page_start: 9,
        page_end: 9,
      },
    ]);
  });

  afterAll(async () => {
    if (orgId) await db.from("organizations").delete().eq("id", orgId);
  });

  it("retrieves the most relevant chunk by keyword", async () => {
    const results = await retrieve(db, orgId, "primary endpoint", { matchCount: 5 });
    expect(results.length).toBeGreaterThan(0);
    expect(results[0].content).toContain("primary endpoint");
    expect(results[0].document_title).toBe("Study Report");

    const citations = buildCitations(results);
    expect(citations[0].marker).toBe(1);
    expect(citations[0].documentId).toBe(docId);
    expect(citations[0].pageStart).toBe(4);
  });
});
