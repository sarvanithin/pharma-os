import { Badge } from "@/components/ui/badge";
import { titleCase } from "@/lib/utils";

const MAP: Record<string, "default" | "success" | "warning" | "destructive" | "muted" | "secondary"> = {
  // doc status
  uploaded: "muted",
  parsing: "warning",
  parsed: "secondary",
  classified: "secondary",
  extracted: "secondary",
  embedded: "secondary",
  ready: "success",
  failed: "destructive",
  // run / step status
  pending: "muted",
  running: "warning",
  waiting_approval: "warning",
  completed: "success",
  cancelled: "muted",
  skipped: "muted",
  // extraction / approval
  auto: "secondary",
  needs_review: "warning",
  approved: "success",
  rejected: "destructive",
  // compliance
  pass: "success",
  fail: "destructive",
  partial: "warning",
};

export function StatusBadge({ status }: { status: string }) {
  return <Badge variant={MAP[status] ?? "secondary"}>{titleCase(status)}</Badge>;
}
