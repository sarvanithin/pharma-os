import { Inngest } from "inngest";

export type Events = {
  "document/ingested": {
    data: { documentId: string; orgId: string };
  };
  "workflow/run.requested": {
    data: { runId: string; orgId: string };
  };
  "workflow/approval.decided": {
    data: { runId: string; approvalId: string; decision: "approved" | "rejected" | "edited" };
  };
  "connector/sync.requested": {
    data: { connectorId: string; orgId: string };
  };
};

export const inngest = new Inngest({
  id: "pharma-os",
  // Keys are read from INNGEST_EVENT_KEY / INNGEST_SIGNING_KEY env vars automatically.
});
