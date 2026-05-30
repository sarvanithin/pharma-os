import type { InngestFunction } from "inngest";
import { inngest } from "@/lib/inngest/client";
import { runProcessing } from "@/server/processing/pipeline";

/** Durable document pipeline: parse -> chunk -> embed -> classify -> extract -> route. */
export const processDocument = inngest.createFunction(
  { id: "process-document", retries: 2, triggers: [{ event: "document/ingested" }] },
  async ({ event, step }) => {
    const { documentId, orgId } = event.data;
    await step.run("process", () => runProcessing(documentId, orgId));
    return { documentId, ok: true };
  },
);

export const functions: InngestFunction.Any[] = [processDocument];
