import { extractText, getDocumentProxy } from "unpdf";
import { hasOcr } from "@/lib/env";

export interface ParsedPage {
  page: number;
  text: string;
}

/** Extract per-page text from a PDF buffer using unpdf (no external service). */
export async function parsePdf(data: Uint8Array): Promise<ParsedPage[]> {
  const pdf = await getDocumentProxy(data);
  const { text } = await extractText(pdf, { mergePages: false });
  const pages = Array.isArray(text) ? text : [text];
  return pages.map((t, i) => ({ page: i + 1, text: (t ?? "").trim() }));
}

/**
 * LlamaParse handles scanned / complex-layout PDFs (tables) when native extraction
 * yields little text. Returns markdown pages; falls back to native parse if no key.
 */
export async function parseWithOcr(
  data: Uint8Array,
  filename: string,
): Promise<ParsedPage[] | null> {
  if (!hasOcr()) return null;
  const base = "https://api.cloud.llamaindex.ai/api/v1/parsing";
  const headers = { Authorization: `Bearer ${process.env.LLAMA_CLOUD_API_KEY}` };

  const form = new FormData();
  form.append("file", new Blob([data as BlobPart]), filename);
  const upload = await fetch(`${base}/upload`, { method: "POST", headers, body: form });
  if (!upload.ok) return null;
  const { id } = (await upload.json()) as { id: string };

  // Poll for completion.
  for (let i = 0; i < 60; i++) {
    const status = await fetch(`${base}/job/${id}`, { headers });
    const { status: s } = (await status.json()) as { status: string };
    if (s === "SUCCESS") break;
    if (s === "ERROR") return null;
    await new Promise((r) => setTimeout(r, 2000));
  }

  const result = await fetch(`${base}/job/${id}/result/markdown`, { headers });
  if (!result.ok) return null;
  const json = (await result.json()) as { pages?: { page: number; md: string }[] };
  if (!json.pages) return null;
  return json.pages.map((p) => ({ page: p.page, text: p.md.trim() }));
}

export async function parseDocument(
  data: Uint8Array,
  mimeType: string,
  filename: string,
): Promise<ParsedPage[]> {
  if (mimeType === "application/pdf" || filename.toLowerCase().endsWith(".pdf")) {
    const native = await parsePdf(data);
    const totalChars = native.reduce((n, p) => n + p.text.length, 0);
    // Sparse text usually means a scanned PDF — try OCR if available.
    if (totalChars < 200 * native.length) {
      const ocr = await parseWithOcr(data, filename);
      if (ocr && ocr.length) return ocr;
    }
    return native;
  }
  // Plain text / markdown / csv treated as a single page.
  const text = new TextDecoder().decode(data);
  return [{ page: 1, text: text.trim() }];
}
