export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type MembershipRole = "owner" | "admin" | "member" | "viewer";
export type DocType =
  | "csr"
  | "patent"
  | "ind"
  | "protocol"
  | "internal_report"
  | "sop"
  | "lab_record"
  | "dataset"
  | "other";
export type DocStatus =
  | "uploaded"
  | "parsing"
  | "parsed"
  | "classified"
  | "extracted"
  | "embedded"
  | "ready"
  | "failed";
export type ExtractionStatus = "auto" | "needs_review" | "approved" | "rejected";
export type RunStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "cancelled";
export type StepStatus =
  | "pending"
  | "running"
  | "waiting_approval"
  | "completed"
  | "failed"
  | "skipped";
export type ApprovalStatus = "pending" | "approved" | "rejected" | "edited";
export type WorkflowCategory =
  | "ind_assembly"
  | "patent_prior_art"
  | "reg_report"
  | "doc_classification"
  | "drug_hypothesis"
  | "compliance_check"
  | "tabular_review"
  | "knowledge_hub"
  | "dashboard";
export type ComplianceStandard = "ich_e6_r3" | "cfr_part_11" | "custom";
export type ComplianceStatus = "pass" | "fail" | "partial" | "pending";
export type ConnectorType = "upload" | "lims" | "qms" | "eln" | "csv" | "s3";

export interface Organization {
  id: string;
  name: string;
  slug: string;
  plan: string;
  settings: Json;
  created_at: string;
}

export interface Membership {
  id: string;
  org_id: string;
  user_id: string;
  role: MembershipRole;
  status: string;
}

export interface Workspace {
  id: string;
  org_id: string;
  name: string;
  description: string | null;
  created_at: string;
}

export interface DocumentRow {
  id: string;
  org_id: string;
  workspace_id: string | null;
  title: string;
  source_filename: string | null;
  storage_path: string | null;
  mime_type: string | null;
  byte_size: number;
  page_count: number;
  doc_type: DocType;
  doc_type_confidence: number | null;
  status: DocStatus;
  content_hash: string | null;
  error: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
}

export interface ChunkMatch {
  id: string;
  document_id: string;
  content: string;
  page_start: number | null;
  page_end: number | null;
  heading_path: string[] | null;
  chunk_index: number;
  document_title: string;
  doc_type: DocType;
  vector_distance: number | null;
  rrf_score: number;
}

export interface Citation {
  documentId: string;
  documentTitle: string;
  chunkId: string;
  pageStart: number | null;
  pageEnd: number | null;
  marker: number;
}

export interface Extraction {
  id: string;
  org_id: string;
  document_id: string;
  schema_id: string | null;
  fields: Record<string, Json>;
  confidence: number | null;
  status: ExtractionStatus;
  source_anchors: SourceAnchor[];
  created_at: string;
}

export interface SourceAnchor {
  field: string;
  page: number | null;
  quote: string | null;
  chunkId?: string | null;
}

export interface WorkflowStepDef {
  id: string;
  name: string;
  type: "retrieval" | "llm_tool" | "transform" | "human_approval" | "compose";
  model?: "opus" | "haiku" | "sonnet";
  system_prompt?: string;
  tools?: string[];
  output_schema?: Json;
  escalation_policy?: { type: "always_human" | "confidence_below" | "never"; threshold?: number };
  config?: Json;
}

export interface WorkflowDefinition {
  steps: WorkflowStepDef[];
}

export interface WorkflowTemplate {
  id: string;
  org_id: string | null;
  key: string;
  name: string;
  description: string | null;
  category: WorkflowCategory;
  definition: WorkflowDefinition;
  input_schema: Json;
  version: number;
  is_active: boolean;
}

export interface AgentRun {
  id: string;
  org_id: string;
  template_id: string | null;
  template_key: string | null;
  status: RunStatus;
  inputs: Json;
  outputs: Json | null;
  current_step_id: string | null;
  cost_tokens: number;
  error: string | null;
  started_at: string | null;
  finished_at: string | null;
  created_at: string;
}

export interface AgentRunStep {
  id: string;
  run_id: string;
  step_id: string;
  step_index: number;
  name: string;
  type: string;
  status: StepStatus;
  input: Json | null;
  output: Json | null;
  tool_calls: Json;
  model: string | null;
  tokens: number;
  latency_ms: number | null;
  error: string | null;
}

export interface Approval {
  id: string;
  org_id: string;
  run_id: string;
  step_id: string;
  requested_reason: string | null;
  proposed_action: Json | null;
  status: ApprovalStatus;
  created_at: string;
}

export interface AuditEntry {
  id: string;
  org_id: string;
  seq: number;
  actor_type: "user" | "agent" | "system";
  actor_id: string | null;
  action: string;
  target_type: string | null;
  target_id: string | null;
  summary: string | null;
  model: string | null;
  metadata: Json;
  hash: string | null;
  created_at: string;
}

export interface OrgContext {
  org: Organization;
  role: MembershipRole;
  userId: string;
}
