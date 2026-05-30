-- Extensions ----------------------------------------------------------------
create extension if not exists "pgcrypto" with schema extensions;
create extension if not exists "vector" with schema extensions;

-- Enums ---------------------------------------------------------------------
create type membership_role as enum ('owner', 'admin', 'member', 'viewer');
create type connector_type as enum ('upload', 'lims', 'qms', 'eln', 'csv', 's3');
create type job_status as enum ('queued', 'running', 'succeeded', 'failed');
create type doc_type as enum ('csr', 'patent', 'ind', 'protocol', 'internal_report', 'sop', 'lab_record', 'dataset', 'other');
create type doc_status as enum ('uploaded', 'parsing', 'parsed', 'classified', 'extracted', 'embedded', 'ready', 'failed');
create type extraction_status as enum ('auto', 'needs_review', 'approved', 'rejected');
create type entity_type as enum ('molecule', 'study', 'trial', 'patent', 'person', 'site', 'endpoint', 'indication', 'other');
create type workflow_category as enum ('ind_assembly', 'patent_prior_art', 'reg_report', 'doc_classification', 'drug_hypothesis', 'compliance_check', 'tabular_review', 'knowledge_hub', 'dashboard');
create type run_status as enum ('pending', 'running', 'waiting_approval', 'completed', 'failed', 'cancelled');
create type step_status as enum ('pending', 'running', 'waiting_approval', 'completed', 'failed', 'skipped');
create type approval_status as enum ('pending', 'approved', 'rejected', 'edited');
create type actor_type as enum ('user', 'agent', 'system');
create type compliance_standard as enum ('ich_e6_r3', 'cfr_part_11', 'custom');
create type compliance_status as enum ('pass', 'fail', 'partial', 'pending');

-- Shared updated_at trigger --------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at = now();
  return new;
end;
$$;

-- Tenancy & identity ---------------------------------------------------------
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  plan text not null default 'trial',
  settings jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);

create table public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text not null,
  full_name text,
  avatar_url text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.memberships (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role membership_role not null default 'member',
  status text not null default 'active',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (org_id, user_id)
);
create index on public.memberships (user_id);
create index on public.memberships (org_id);

create table public.workspaces (
  id uuid primary key default gen_random_uuid(),
  org_id uuid not null references public.organizations(id) on delete cascade,
  name text not null,
  description text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  created_by uuid
);
create index on public.workspaces (org_id);

create table public.workspace_members (
  workspace_id uuid not null references public.workspaces(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  role membership_role not null default 'member',
  primary key (workspace_id, user_id)
);

-- RLS helper functions (SECURITY DEFINER to avoid policy recursion) -----------
create or replace function public.is_org_member(p_org_id uuid)
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
  );
$$;

create or replace function public.has_org_role(p_org_id uuid, p_roles membership_role[])
returns boolean
language sql
security definer
stable
set search_path = public
as $$
  select exists (
    select 1 from public.memberships m
    where m.org_id = p_org_id
      and m.user_id = auth.uid()
      and m.status = 'active'
      and m.role = any(p_roles)
  );
$$;

-- Auto-create a public.users row when an auth user signs up ------------------
create or replace function public.handle_new_user()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  insert into public.users (id, email, full_name, avatar_url)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.raw_user_meta_data->>'name'),
    new.raw_user_meta_data->>'avatar_url'
  )
  on conflict (id) do nothing;
  return new;
end;
$$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

create trigger set_org_updated before update on public.organizations for each row execute function public.set_updated_at();
create trigger set_user_updated before update on public.users for each row execute function public.set_updated_at();
create trigger set_membership_updated before update on public.memberships for each row execute function public.set_updated_at();
create trigger set_workspace_updated before update on public.workspaces for each row execute function public.set_updated_at();
