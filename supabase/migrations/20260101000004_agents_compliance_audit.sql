-- Workflow templates & runs --------------------------------------------------
create table public.workflow_templates (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = global/seeded
  key text not null,
  name text not null,
  description text,
  category workflow_category not null,
  definition jsonb not null, -- { steps: [...] }
  input_schema jsonb not null default '{}'::jsonb,
  version int not null default 1,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create unique index workflow_templates_key_idx on public.workflow_templates (coalesce(org_id, '00000000-0000-0000-0000-000000000000'::uuid), key);

create table public.agent_runs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  template_id uuid references public.workflow_templates(id) on delete set null,
  template_key text,
  template_version int,
  triggered_by uuid,
  trigger text not null default 'manual',
  status run_status not null default 'pending',
  inputs jsonb not null default '{}'::jsonb,
  outputs jsonb,
  current_step_id text,
  cost_tokens int not null default 0,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.agent_runs (org_id);
create index on public.agent_runs (org_id, status);

create table public.agent_run_steps (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_id text not null,
  step_index int not null,
  name text not null,
  type text not null,
  status step_status not null default 'pending',
  input jsonb,
  output jsonb,
  tool_calls jsonb not null default '[]'::jsonb,
  model text,
  tokens int not null default 0,
  latency_ms int,
  error text,
  started_at timestamptz,
  finished_at timestamptz,
  created_at timestamptz not null default now(),
  unique (run_id, step_id)
);
create index on public.agent_run_steps (run_id);

create table public.approvals (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  run_id uuid not null references public.agent_runs(id) on delete cascade,
  step_id text not null,
  requested_reason text,
  proposed_action jsonb,
  status approval_status not null default 'pending',
  decided_by uuid,
  decision_payload jsonb,
  decided_at timestamptz,
  created_at timestamptz not null default now()
);
create index on public.approvals (org_id);
create index on public.approvals (org_id, status);
create index on public.approvals (run_id);

-- Compliance -----------------------------------------------------------------
create table public.compliance_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = seeded
  standard compliance_standard not null,
  rule_key text not null,
  description text not null,
  check_spec jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now()
);
create index on public.compliance_rules (standard);

create table public.compliance_checks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid references public.documents(id) on delete cascade,
  run_id uuid references public.agent_runs(id) on delete cascade,
  standard compliance_standard not null,
  results jsonb not null default '[]'::jsonb,
  score numeric,
  status compliance_status not null default 'pending',
  checked_by uuid,
  created_at timestamptz not null default now()
);
create index on public.compliance_checks (org_id);

-- Audit log: append-only, hash-chained --------------------------------------
create table public.audit_log (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  seq bigserial,
  actor_type actor_type not null,
  actor_id uuid,
  action text not null,
  target_type text,
  target_id uuid,
  summary text,
  model text,
  prompt_ref text,
  response_ref text,
  metadata jsonb not null default '{}'::jsonb,
  prev_hash text,
  hash text,
  created_at timestamptz not null default now()
);
create index on public.audit_log (org_id, seq);
create index on public.audit_log (org_id, created_at desc);
create index on public.audit_log (org_id, target_type, target_id);

create trigger set_workflow_template_updated before update on public.workflow_templates for each row execute function public.set_updated_at();
create trigger set_agent_run_updated before update on public.agent_runs for each row execute function public.set_updated_at();
