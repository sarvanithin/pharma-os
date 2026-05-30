-- Connectors & ingestion -----------------------------------------------------
create table public.connectors (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  type connector_type not null,
  name text not null,
  config jsonb not null default '{}'::jsonb,
  status text not null default 'idle',
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create index on public.connectors (org_id);

create table public.ingestion_jobs (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  connector_id uuid references public.connectors(id) on delete set null,
  workspace_id uuid references public.workspaces(id) on delete set null,
  status job_status not null default 'queued',
  stats jsonb not null default '{}'::jsonb,
  error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.ingestion_jobs (org_id);

-- Documents ------------------------------------------------------------------
create table public.documents (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  workspace_id uuid references public.workspaces(id) on delete set null,
  connector_id uuid references public.connectors(id) on delete set null,
  ingestion_job_id uuid references public.ingestion_jobs(id) on delete set null,
  title text not null,
  source_filename text,
  storage_path text,
  mime_type text,
  byte_size bigint default 0,
  page_count int default 0,
  doc_type doc_type not null default 'other',
  doc_type_confidence numeric,
  status doc_status not null default 'uploaded',
  current_version int not null default 1,
  content_hash text,
  error text,
  metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create index on public.documents (org_id);
create index on public.documents (workspace_id);
create index on public.documents (org_id, status);
create index on public.documents (org_id, doc_type);

create table public.document_versions (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  version int not null,
  storage_path text,
  content_hash text,
  created_at timestamptz not null default now(),
  created_by uuid,
  unique (document_id, version)
);

create table public.document_pages (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  page_number int not null,
  raw_text text,
  layout jsonb,
  created_at timestamptz not null default now(),
  unique (document_id, page_number)
);
create index on public.document_pages (document_id);

create table public.tags (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  color text not null default 'gray',
  created_at timestamptz not null default now(),
  unique (org_id, name)
);

create table public.document_tags (
  document_id uuid not null references public.documents(id) on delete cascade,
  tag_id uuid not null references public.tags(id) on delete cascade,
  org_id uuid not null references public.organizations(id) on delete cascade,
  primary key (document_id, tag_id)
);

create table public.routing_rules (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  predicate jsonb not null default '{}'::jsonb,
  action jsonb not null default '{}'::jsonb,
  is_active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index on public.routing_rules (org_id);

-- RAG: chunks with embeddings ------------------------------------------------
create table public.chunks (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  document_id uuid not null references public.documents(id) on delete cascade,
  document_version int not null default 1,
  page_start int,
  page_end int,
  chunk_index int not null,
  content text not null,
  token_count int,
  heading_path text[],
  embedding extensions.vector(1024),
  embedding_model text,
  metadata jsonb not null default '{}'::jsonb,
  fts tsvector generated always as (to_tsvector('english', content)) stored,
  created_at timestamptz not null default now()
);
create index on public.chunks (org_id);
create index on public.chunks (document_id);
create index chunks_fts_idx on public.chunks using gin (fts);
-- HNSW index for fast approximate nearest-neighbour cosine search.
create index chunks_embedding_idx on public.chunks
  using hnsw (embedding extensions.vector_cosine_ops);

create trigger set_connector_updated before update on public.connectors for each row execute function public.set_updated_at();
create trigger set_ingestion_updated before update on public.ingestion_jobs for each row execute function public.set_updated_at();
create trigger set_document_updated before update on public.documents for each row execute function public.set_updated_at();
create trigger set_routing_updated before update on public.routing_rules for each row execute function public.set_updated_at();
