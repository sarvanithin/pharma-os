import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft, FileText } from "lucide-react";
import { requireOrg, canWrite } from "@/lib/auth/session";
import { createClient } from "@/lib/supabase/server";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { StatusBadge } from "@/components/status-badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { formatBytes, titleCase } from "@/lib/utils";
import { decideExtraction } from "@/server/processing/review";
import type { SourceAnchor } from "@/types/domain";

export default async function DocumentDetail({
  params,
}: {
  params: Promise<{ org: string; id: string }>;
}) {
  const { org: slug, id } = await params;
  const ctx = await requireOrg(slug);
  const supabase = await createClient();

  const { data: doc } = await supabase
    .from("documents")
    .select("*")
    .eq("id", id)
    .eq("org_id", ctx.org.id)
    .maybeSingle();
  if (!doc) notFound();

  const [{ data: pages }, { data: extraction }, { data: tagRows }, { data: linkRows }] =
    await Promise.all([
      supabase
        .from("document_pages")
        .select("page_number, raw_text")
        .eq("document_id", id)
        .order("page_number"),
      supabase.from("extractions").select("*").eq("document_id", id).maybeSingle(),
      supabase.from("document_tags").select("tags(name)").eq("document_id", id),
      supabase
        .from("links")
        .select("relation, entities:to_id(name, type)")
        .eq("from_id", id),
    ]);

  const tags = ((tagRows ?? []) as unknown as { tags: { name: string } | null }[])
    .map((t) => t.tags?.name)
    .filter(Boolean) as string[];

  const fields = (extraction?.fields ?? {}) as Record<string, unknown>;
  const anchors = (extraction?.source_anchors ?? []) as SourceAnchor[];

  return (
    <div className="mx-auto max-w-5xl p-6">
      <Link
        href={`/app/${slug}/documents`}
        className="mb-4 inline-flex items-center gap-1.5 text-sm text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-4" /> Documents
      </Link>

      <div className="flex items-start justify-between gap-4">
        <div className="flex items-start gap-3">
          <div className="flex size-10 items-center justify-center rounded-lg bg-primary/10 text-primary">
            <FileText className="size-5" />
          </div>
          <div>
            <h1 className="text-xl font-semibold tracking-tight">{doc.title}</h1>
            <p className="mt-1 text-sm text-muted-foreground">
              {doc.source_filename} · {doc.page_count} pages · {formatBytes(doc.byte_size)}
            </p>
          </div>
        </div>
        <div className="flex items-center gap-2">
          <Badge variant="secondary">{titleCase(doc.doc_type)}</Badge>
          <StatusBadge status={doc.status} />
        </div>
      </div>

      {doc.error && (
        <p className="mt-4 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-sm text-destructive">
          {doc.error}
        </p>
      )}

      {(tags.length > 0 || (linkRows?.length ?? 0) > 0) && (
        <div className="mt-4 flex flex-wrap gap-2">
          {tags.map((t) => (
            <Badge key={t} variant="muted">
              {t}
            </Badge>
          ))}
          {((linkRows ?? []) as unknown as { entities: { name: string; type: string } | null }[])
            .map((l) => l.entities)
            .filter(Boolean)
            .map((e, i) => (
              <Badge key={i} variant="outline">
                {titleCase(e!.type)}: {e!.name}
              </Badge>
            ))}
        </div>
      )}

      {extraction && (
        <Card className="mt-6">
          <CardHeader className="flex-row items-center justify-between">
            <CardTitle className="text-base">Extracted fields</CardTitle>
            <div className="flex items-center gap-2">
              <StatusBadge status={extraction.status} />
              {extraction.status === "needs_review" && canWrite(ctx.role) && (
                <div className="flex gap-1.5">
                  <form action={decideExtraction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="extractionId" value={extraction.id} />
                    <input type="hidden" name="documentId" value={id} />
                    <input type="hidden" name="decision" value="approved" />
                    <Button size="sm" variant="outline" type="submit">
                      Approve
                    </Button>
                  </form>
                  <form action={decideExtraction}>
                    <input type="hidden" name="slug" value={slug} />
                    <input type="hidden" name="extractionId" value={extraction.id} />
                    <input type="hidden" name="documentId" value={id} />
                    <input type="hidden" name="decision" value="rejected" />
                    <Button size="sm" variant="ghost" type="submit">
                      Reject
                    </Button>
                  </form>
                </div>
              )}
            </div>
          </CardHeader>
          <CardContent className="space-y-4">
            <div className="grid gap-3 sm:grid-cols-2">
              {Object.entries(fields).map(([k, v]) => (
                <div key={k} className="rounded-md border p-3">
                  <p className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                    {titleCase(k)}
                  </p>
                  <p className="mt-1 text-sm">
                    {typeof v === "object" ? JSON.stringify(v) : String(v)}
                  </p>
                </div>
              ))}
            </div>
            {anchors.length > 0 && (
              <div>
                <p className="mb-2 text-xs font-medium text-muted-foreground">Source provenance</p>
                <ul className="space-y-1.5 text-sm">
                  {anchors.map((a, i) => (
                    <li key={i} className="text-muted-foreground">
                      <span className="font-medium text-foreground">{titleCase(a.field)}</span>
                      {a.page != null && ` (p.${a.page})`}
                      {a.quote && <span className="italic"> — “{a.quote}”</span>}
                    </li>
                  ))}
                </ul>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      <Card className="mt-6">
        <CardHeader>
          <CardTitle className="text-base">Document text</CardTitle>
        </CardHeader>
        <CardContent className="space-y-5">
          {pages?.length ? (
            pages.map((p) => (
              <div key={p.page_number} id={`page-${p.page_number}`}>
                <p className="mb-1 text-xs font-medium text-muted-foreground">Page {p.page_number}</p>
                <p className="whitespace-pre-wrap text-sm leading-relaxed text-foreground/90">
                  {p.raw_text?.slice(0, 4000) || "(no extractable text)"}
                </p>
              </div>
            ))
          ) : (
            <p className="text-sm text-muted-foreground">No parsed pages yet.</p>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
