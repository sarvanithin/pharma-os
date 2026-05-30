"use client";

import { useRef, useState } from "react";
import Link from "next/link";
import { Send, Sparkles, FileText, Loader2, User } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Badge } from "@/components/ui/badge";
import { cn, titleCase } from "@/lib/utils";
import type { Citation } from "@/types/domain";

interface Message {
  role: "user" | "assistant";
  content: string;
  citations?: Citation[];
}

const DOC_TYPES = ["", "csr", "patent", "ind", "protocol", "internal_report", "sop"];

function decodeCitations(header: string | null): Citation[] {
  if (!header) return [];
  try {
    return JSON.parse(decodeURIComponent(escape(atob(header))));
  } catch {
    return [];
  }
}

export function DataRoomChat({ slug }: { slug: string }) {
  const [messages, setMessages] = useState<Message[]>([]);
  const [input, setInput] = useState("");
  const [docType, setDocType] = useState("");
  const [loading, setLoading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);

  async function ask() {
    const q = input.trim();
    if (!q || loading) return;
    setInput("");
    setMessages((m) => [...m, { role: "user", content: q }, { role: "assistant", content: "" }]);
    setLoading(true);

    try {
      const res = await fetch("/api/rag", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query: q, slug, docType: docType || null }),
      });
      const citations = decodeCitations(res.headers.get("x-citations"));
      const reader = res.body?.getReader();
      const decoder = new TextDecoder();
      let acc = "";
      if (reader) {
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          acc += decoder.decode(value, { stream: true });
          setMessages((m) => {
            const next = [...m];
            next[next.length - 1] = { role: "assistant", content: acc, citations };
            return next;
          });
          scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
        }
      }
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "assistant", content: acc || "(no response)", citations };
        return next;
      });
    } catch {
      setMessages((m) => {
        const next = [...m];
        next[next.length - 1] = { role: "assistant", content: "Something went wrong." };
        return next;
      });
    } finally {
      setLoading(false);
    }
  }

  return (
    <div className="flex h-[calc(100svh-3.5rem)] flex-col">
      <div ref={scrollRef} className="flex-1 overflow-y-auto">
        <div className="mx-auto max-w-3xl space-y-6 p-6">
          {messages.length === 0 && (
            <div className="rounded-xl border border-dashed p-10 text-center">
              <Sparkles className="mx-auto size-8 text-primary" />
              <h3 className="mt-3 font-medium">Ask your data room</h3>
              <p className="mx-auto mt-1 max-w-md text-sm text-muted-foreground">
                Get precise, source-cited answers grounded in your documents. Try “What was the
                primary endpoint and result?” or “Summarize the safety profile.”
              </p>
            </div>
          )}
          {messages.map((m, i) => (
            <div key={i} className={cn("flex gap-3", m.role === "user" && "justify-end")}>
              {m.role === "assistant" && (
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-primary/10 text-primary">
                  <Sparkles className="size-4" />
                </div>
              )}
              <div
                className={cn(
                  "max-w-[85%] rounded-xl px-4 py-3 text-sm",
                  m.role === "user" ? "bg-primary text-primary-foreground" : "bg-card border",
                )}
              >
                <p className="whitespace-pre-wrap leading-relaxed">
                  {m.content || (loading && i === messages.length - 1 ? "Thinking…" : "")}
                </p>
                {m.citations && m.citations.length > 0 && (
                  <div className="mt-3 border-t pt-3">
                    <p className="mb-1.5 text-xs font-medium text-muted-foreground">Sources</p>
                    <div className="flex flex-wrap gap-1.5">
                      {m.citations.map((c) => (
                        <Link
                          key={c.marker}
                          href={`/app/${slug}/documents/${c.documentId}${
                            c.pageStart ? `#page-${c.pageStart}` : ""
                          }`}
                        >
                          <Badge variant="secondary" className="gap-1 hover:bg-secondary/70">
                            <FileText className="size-3" />[{c.marker}] {c.documentTitle}
                            {c.pageStart ? ` p.${c.pageStart}` : ""}
                          </Badge>
                        </Link>
                      ))}
                    </div>
                  </div>
                )}
              </div>
              {m.role === "user" && (
                <div className="flex size-7 shrink-0 items-center justify-center rounded-md bg-muted">
                  <User className="size-4" />
                </div>
              )}
            </div>
          ))}
        </div>
      </div>

      <div className="border-t bg-background p-4">
        <div className="mx-auto max-w-3xl">
          <div className="mb-2 flex items-center gap-2">
            <span className="text-xs text-muted-foreground">Filter</span>
            <select
              value={docType}
              onChange={(e) => setDocType(e.target.value)}
              className="h-7 rounded-md border bg-transparent px-2 text-xs"
            >
              {DOC_TYPES.map((t) => (
                <option key={t} value={t}>
                  {t ? titleCase(t) : "All documents"}
                </option>
              ))}
            </select>
          </div>
          <div className="flex items-end gap-2">
            <Textarea
              value={input}
              onChange={(e) => setInput(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) {
                  e.preventDefault();
                  ask();
                }
              }}
              placeholder="Ask a question about your documents…"
              className="min-h-[44px] resize-none"
              rows={1}
            />
            <Button onClick={ask} disabled={loading || !input.trim()} size="icon" className="size-11">
              {loading ? <Loader2 className="size-4 animate-spin" /> : <Send className="size-4" />}
            </Button>
          </div>
        </div>
      </div>
    </div>
  );
}
