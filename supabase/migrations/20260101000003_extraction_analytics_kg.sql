-- Extraction -----------------------------------------------------------------
create table public.extraction_schemas (
  id uuid primary key default gen_random_uuid(),
  org_id uuid references public.organizations(id) on delete cascade, -- null = global/seeded
  doc_type doc_type not null,
  name text not null,
  version int not null default 1,
  json_schema jsonb not null,
  prompt_template text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index on public.extraction_schemas (doc_type);

create table public.extractions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  schema_id uuid references public.extraction_schemas(id) on delete set null,
  fields jsonb not null default '{}'::jsonb,
  confidence numeric,
  status extraction_status not null default 'auto',
  source_anchors jsonb not null default '[]'::jsonb,
  reviewed_by uuid,
  reviewed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.extractions (org_id);
create index on public.extractions (document_id);
create index on public.extractions (org_id, status);

-- Knowledge graph ------------------------------------------------------------
create table public.entities (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type entity_type not null,
  name text not null,
  attributes jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique (org_id, type, name)
);
create index on public.entities (org_id);

create table public.links (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  from_type text not null,
  from_id uuid not null,
  to_type text not null,
  to_id uuid not null,
  relation text not null,
  evidence_chunk_id uuid references public.chunks(id) on delete set null,
  created_at timestamptz not null default now()
);
create index on public.links (org_id);
create index on public.links (from_id);
create index on public.links (to_id);

-- Datasets & analytics -------------------------------------------------------
create table public.datasets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  name text not null,
  source text not null default 'csv',
  schema jsonb not null default '[]'::jsonb, -- [{name, type}]
  row_count int not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create index on public.datasets (org_id);

create table public.dataset_rows (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  dataset_id uuid not null references public.datasets(id) on delete cascade,
  row jsonb not null
);
create index on public.dataset_rows (dataset_id);
create index dataset_rows_gin on public.dataset_rows using gin (row);

create table public.dashboards (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  name text not null,
  layout jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create index on public.dashboards (org_id);

create table public.dashboard_widgets (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  dashboard_id uuid not null references public.dashboards(id) on delete cascade,
  type text not null,
  title text not null,
  query_spec jsonb not null,
  viz_config jsonb not null default '{}'::jsonb,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index on public.dashboard_widgets (dashboard_id);

create table public.analytics_queries (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  dataset_id uuid references public.datasets(id) on delete set null,
  nl_question text not null,
  generated_query jsonb,
  result_cache jsonb,
  status text not null default 'pending',
  created_at timestamptz not null default now(),
  created_by uuid
);
create index on public.analytics_queries (org_id);

create trigger set_extraction_updated before update on public.extractions for each row execute function public.set_updated_at();
create trigger set_dataset_updated before update on public.datasets for each row execute function public.set_updated_at();
create trigger set_dashboard_updated before update on public.dashboards for each row execute function public.set_updated_at();
