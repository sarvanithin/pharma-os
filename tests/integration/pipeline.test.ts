import { describe, it, expect, beforeAll, afterAll } from "vitest";
import { createAdminClient } from "@/lib/supabase/admin";
import { runProcessing } from "@/server/processing/pipeline";

/**
 * Exercises the ingestion pipeline against the local Supabase instance.
 * Requires `supabase start` to be running. No external API keys needed —
 * parse + chunk run offline; embeddings/classification are skipped without keys.
 */
const db = createAdminClient();
let orgId: string;
let docId: string;

const SAMPLE = `CLINICAL STUDY REPORT

This Phase 2 study evaluated the efficacy and safety of compound ABC-123 in patients
with moderate to severe disease. The primary endpoint was the change from baseline in
the disease activity score at week 12. A total of 240 subjects were randomized.

RESULTS

The primary endpoint was met with statistical significance (p<0.001). Adverse events
were consistent with the known safety profile. No new safety signals were observed.

CONCLUSION

Compound ABC-123 demonstrated a favorable benefit-risk profile in this population.`;

describe("ingestion pipeline", () => {
  beforeAll(async () => {
    const { data: org } = await db
      .from("organizations")
      .insert({ name: "Pipeline Test", slug: `pipe-${Date.now()}` })
      .select("id")
      .single();
    orgId = org!.id;

    const { data: doc } = await db
      .from("documents")
      .insert({
        org_id: orgId,
        title: "Sample CSR",
        source_filename: "sample.txt",
        mime_type: "text/plain",
        byte_size: SAMPLE.length,
        status: "uploaded",
      })
      .select("id")
      .single();
    docId = doc!.id;

    const path = `${orgId}/${docId}/sample.txt`;
    await db.storage.from("documents").upload(path, new Blob([SAMPLE], { type: "text/plain" }), {
      contentType: "text/plain",
      upsert: true,
    });
    await db.from("documents").update({ storage_path: path }).eq("id", docId);
  });

  afterAll(async () => {
    if (orgId) await db.from("organizations").delete().eq("id", orgId);
  });

  it("parses, chunks, and marks the document ready", async () => {
    await runProcessing(docId, orgId);

    const { data: doc } = await db
      .from("documents")
      .select("status, page_count")
      .eq("id", docId)
      .single();
    expect(doc!.status).toBe("ready");
    expect(doc!.page_count).toBeGreaterThanOrEqual(1);

    const { count } = await db
      .from("chunks")
      .select("id", { count: "exact", head: true })
      .eq("document_id", docId);
    expect(count ?? 0).toBeGreaterThan(0);
  });

  it("writes an audit entry for processing", async () => {
    const { data } = await db
      .from("audit_log")
      .select("action")
      .eq("org_id", orgId)
      .eq("action", "document.processed");
    expect(data?.length ?? 0).toBeGreaterThan(0);
  });
});
