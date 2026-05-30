import type { ParsedPage } from "@/lib/parsing/pdf";

export interface Chunk {
  content: string;
  pageStart: number;
  pageEnd: number;
  chunkIndex: number;
  headingPath: string[];
  tokenCount: number;
}

// Rough token estimate (~4 chars/token) — good enough for budgeting chunks.
const estimateTokens = (s: string) => Math.ceil(s.length / 4);

const TARGET_TOKENS = 600;
const OVERLAP_TOKENS = 80;
const MAX_CHARS = TARGET_TOKENS * 4;
const OVERLAP_CHARS = OVERLAP_TOKENS * 4;

const HEADING_RE = /^(#{1,6}\s+.+|[A-Z0-9][A-Z0-9 .()\-/]{6,}|\d+(\.\d+)*\s+[A-Z].+)$/;

function splitParagraphs(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((p) => p.trim())
    .filter(Boolean);
}

/**
 * Heading-aware recursive chunking. Keeps a running heading path for citations and
 * preserves the source page range of each chunk so answers can deep-link to pages.
 */
export function chunkPages(pages: ParsedPage[]): Chunk[] {
  const chunks: Chunk[] = [];
  let headingPath: string[] = [];
  let buf = "";
  let bufPageStart = pages[0]?.page ?? 1;
  let bufPageEnd = bufPageStart;
  let index = 0;

  const flush = () => {
    const content = buf.trim();
    if (content.length < 1) return;
    chunks.push({
      content,
      pageStart: bufPageStart,
      pageEnd: bufPageEnd,
      chunkIndex: index++,
      headingPath: [...headingPath],
      tokenCount: estimateTokens(content),
    });
    // Carry an overlap tail into the next chunk for context continuity.
    buf = content.slice(-OVERLAP_CHARS);
    bufPageStart = bufPageEnd;
  };

  for (const page of pages) {
    for (const para of splitParagraphs(page.text)) {
      const firstLine = para.split("\n")[0]?.trim() ?? "";
      if (firstLine.length < 90 && HEADING_RE.test(firstLine)) {
        if (buf.trim()) flush();
        headingPath = [firstLine.replace(/^#+\s*/, "")];
      }
      if ((buf + "\n\n" + para).length > MAX_CHARS && buf.trim()) {
        flush();
      }
      buf = buf ? `${buf}\n\n${para}` : para;
      bufPageEnd = page.page;
    }
  }
  if (buf.trim()) flush();

  return chunks.filter((c) => c.content.length > 20);
}
