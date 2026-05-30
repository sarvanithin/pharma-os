import { inngest } from "@/lib/inngest/client";
import { runProcessing } from "@/server/processing/pipeline";

/**
 * Kick off document processing. In production (INNGEST_EVENT_KEY set) this enqueues a
 * durable Inngest job; locally it runs the pipeline inline so the demo works without
 * a running Inngest dev server.
 */
export async function dispatchProcessing(documentId: string, orgId: string) {
  if (process.env.INNGEST_EVENT_KEY) {
    await inngest.send({ name: "document/ingested", data: { documentId, orgId } });
    return;
  }
  // Inline fallback — don't let a processing error fail the upload response.
  try {
    await runProcessing(documentId, orgId);
  } catch (err) {
    console.error("[processing] inline run failed", err);
  }
}
