"use client";

import { useRef, useState, useTransition } from "react";
import { useRouter } from "next/navigation";
import { UploadCloud, File as FileIcon, X, Loader2 } from "lucide-react";
import { uploadDocuments } from "@/server/ingestion/upload";
import { Button } from "@/components/ui/button";
import { cn, formatBytes } from "@/lib/utils";

export function UploadZone({
  slug,
  workspaces,
}: {
  slug: string;
  workspaces: { id: string; name: string }[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [files, setFiles] = useState<File[]>([]);
  const [workspaceId, setWorkspaceId] = useState(workspaces[0]?.id ?? "");
  const [dragging, setDragging] = useState(false);
  const [pending, start] = useTransition();
  const [error, setError] = useState<string | null>(null);

  function addFiles(list: FileList | null) {
    if (!list) return;
    setFiles((prev) => [...prev, ...Array.from(list)]);
  }

  function submit() {
    setError(null);
    const fd = new FormData();
    fd.append("slug", slug);
    if (workspaceId) fd.append("workspaceId", workspaceId);
    files.forEach((f) => fd.append("files", f));
    start(async () => {
      try {
        await uploadDocuments(fd);
        setFiles([]);
        router.push(`/app/${slug}/documents`);
        router.refresh();
      } catch (e) {
        setError(e instanceof Error ? e.message : "Upload failed");
      }
    });
  }

  return (
    <div className="space-y-4">
      <div
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          addFiles(e.dataTransfer.files);
        }}
        onClick={() => inputRef.current?.click()}
        className={cn(
          "flex cursor-pointer flex-col items-center justify-center rounded-xl border border-dashed py-14 transition-colors",
          dragging ? "border-primary bg-primary/5" : "hover:bg-muted/40",
        )}
      >
        <UploadCloud className="size-8 text-muted-foreground" />
        <p className="mt-3 text-sm font-medium">Drop files or click to upload</p>
        <p className="mt-1 text-xs text-muted-foreground">PDF, TXT, CSV, DOCX — CSRs, patents, INDs, reports</p>
        <input
          ref={inputRef}
          type="file"
          multiple
          accept=".pdf,.txt,.csv,.md,.docx"
          className="hidden"
          onChange={(e) => addFiles(e.target.files)}
        />
      </div>

      {workspaces.length > 0 && (
        <div className="flex items-center gap-2 text-sm">
          <label className="text-muted-foreground">Workspace</label>
          <select
            value={workspaceId}
            onChange={(e) => setWorkspaceId(e.target.value)}
            className="h-9 rounded-md border bg-transparent px-2 text-sm"
          >
            {workspaces.map((w) => (
              <option key={w.id} value={w.id}>
                {w.name}
              </option>
            ))}
          </select>
        </div>
      )}

      {files.length > 0 && (
        <div className="space-y-2">
          {files.map((f, i) => (
            <div
              key={i}
              className="flex items-center justify-between rounded-md border px-3 py-2 text-sm"
            >
              <span className="flex items-center gap-2">
                <FileIcon className="size-4 text-muted-foreground" />
                {f.name}
                <span className="text-xs text-muted-foreground">{formatBytes(f.size)}</span>
              </span>
              <button
                onClick={() => setFiles((prev) => prev.filter((_, j) => j !== i))}
                className="text-muted-foreground hover:text-foreground"
              >
                <X className="size-4" />
              </button>
            </div>
          ))}
        </div>
      )}

      {error && <p className="text-sm text-destructive">{error}</p>}

      <Button onClick={submit} disabled={pending || files.length === 0}>
        {pending && <Loader2 className="size-4 animate-spin" />}
        {pending ? "Processing…" : `Upload ${files.length || ""} file${files.length === 1 ? "" : "s"}`}
      </Button>
    </div>
  );
}
