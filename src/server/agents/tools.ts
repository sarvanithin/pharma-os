import type { SupabaseClient } from "@supabase/supabase-js";
import { retrieve } from "@/server/rag/retrieve";

export interface ToolContext {
  supabase: SupabaseClient;
  orgId: string;
  workspaceId?: string | null;
}

export interface ToolDef {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
  run: (args: Record<string, unknown>, ctx: ToolContext) => Promise<string>;
}

const searchDataRoom: ToolDef = {
  name: "search_data_room",
  description:
    "Search the organization's document data room for passages relevant to a query. Returns the most relevant excerpts with their source document and page.",
  input_schema: {
    type: "object",
    properties: { query: { type: "string", description: "What to search for" } },
    required: ["query"],
  },
  async run(args, ctx) {
    const query = String(args.query ?? "");
    const chunks = await retrieve(ctx.supabase, ctx.orgId, query, {
      workspaceId: ctx.workspaceId,
      matchCount: 6,
    });
    if (chunks.length === 0) return "No relevant passages found.";
    return chunks
      .map(
        (c, i) =>
          `[${i + 1}] ${c.document_title}${c.page_start ? ` (p.${c.page_start})` : ""}:\n${c.content}`,
      )
      .join("\n\n");
  },
};

const listDocuments: ToolDef = {
  name: "list_documents",
  description: "List documents in the data room, optionally filtered by type.",
  input_schema: {
    type: "object",
    properties: {
      doc_type: {
        type: "string",
        enum: ["csr", "patent", "ind", "protocol", "internal_report", "sop", "lab_record", "other"],
      },
    },
  },
  async run(args, ctx) {
    let q = ctx.supabase
      .from("documents")
      .select("title, doc_type")
      .eq("org_id", ctx.orgId)
      .eq("status", "ready")
      .limit(50);
    if (args.doc_type) q = q.eq("doc_type", String(args.doc_type));
    const { data } = await q;
    if (!data?.length) return "No documents found.";
    return data.map((d) => `- ${d.title} (${d.doc_type})`).join("\n");
  },
};

export const TOOLS: Record<string, ToolDef> = {
  [searchDataRoom.name]: searchDataRoom,
  [listDocuments.name]: listDocuments,
};

export function toolsForNames(names: string[] | undefined): ToolDef[] {
  if (!names?.length) return [searchDataRoom];
  return names.map((n) => TOOLS[n]).filter(Boolean);
}
