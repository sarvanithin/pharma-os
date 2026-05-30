import { NextRequest, NextResponse } from "next/server";
import { createClient } from "@/lib/supabase/server";
import { getOrgContext } from "@/lib/auth/session";

function csvCell(v: unknown): string {
  const s = String(v ?? "");
  return `"${s.replace(/"/g, '""')}"`;
}

export async function GET(req: NextRequest) {
  const slug = req.nextUrl.searchParams.get("slug");
  if (!slug) return NextResponse.json({ error: "slug required" }, { status: 400 });
  const ctx = await getOrgContext(slug);
  if (!ctx) return NextResponse.json({ error: "unauthorized" }, { status: 401 });

  const supabase = await createClient();
  const { data } = await supabase
    .from("audit_log")
    .select("seq, created_at, actor_type, action, target_type, target_id, summary, model, hash, prev_hash")
    .eq("org_id", ctx.org.id)
    .order("seq");

  const header = ["seq", "created_at", "actor_type", "action", "target_type", "target_id", "summary", "model", "hash", "prev_hash"];
  const lines = [header.join(",")];
  for (const r of data ?? []) {
    lines.push(header.map((h) => csvCell((r as Record<string, unknown>)[h])).join(","));
  }

  return new NextResponse(lines.join("\n"), {
    headers: {
      "Content-Type": "text/csv",
      "Content-Disposition": `attachment; filename="audit-${ctx.org.slug}.csv"`,
    },
  });
}
