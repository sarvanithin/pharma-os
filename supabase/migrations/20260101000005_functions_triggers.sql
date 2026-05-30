-- Audit log hash chaining ----------------------------------------------------
-- Each row's hash = sha256(prev_hash || canonical payload). prev_hash links to the
-- previous row for the same org, making the log tamper-evident.
create or replace function public.audit_hash_chain()
returns trigger
language plpgsql
security definer
set search_path = public, extensions
as $$
declare
  v_prev text;
  v_payload text;
begin
  select a.hash into v_prev
  from public.audit_log a
  where a.org_id = new.org_id
  order by a.seq desc
  limit 1;

  new.prev_hash := v_prev;
  v_payload := coalesce(v_prev, '') ||
    new.org_id::text || '|' ||
    new.actor_type::text || '|' ||
    coalesce(new.actor_id::text, '') || '|' ||
    new.action || '|' ||
    coalesce(new.target_type, '') || '|' ||
    coalesce(new.target_id::text, '') || '|' ||
    coalesce(new.summary, '') || '|' ||
    coalesce(new.model, '') || '|' ||
    coalesce(new.metadata::text, '{}') || '|' ||
    new.created_at::text;

  new.hash := encode(digest(v_payload, 'sha256'), 'hex');
  return new;
end;
$$;

create trigger audit_log_hash before insert on public.audit_log
  for each row execute function public.audit_hash_chain();

-- Block any mutation of the audit log.
create or replace function public.audit_log_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'audit_log is append-only and cannot be % ', tg_op;
end;
$$;

create trigger audit_log_no_update before update on public.audit_log
  for each row execute function public.audit_log_immutable();
create trigger audit_log_no_delete before delete on public.audit_log
  for each row execute function public.audit_log_immutable();

-- Hybrid search over chunks (vector + keyword) fused with Reciprocal Rank Fusion.
create or replace function public.match_chunks(
  p_org_id uuid,
  p_query_embedding extensions.vector(1024),
  p_query_text text,
  p_match_count int default 12,
  p_candidate_count int default 40,
  p_workspace_id uuid default null,
  p_doc_type doc_type default null
)
returns table (
  id uuid,
  document_id uuid,
  content text,
  page_start int,
  page_end int,
  heading_path text[],
  chunk_index int,
  document_title text,
  doc_type doc_type,
  vector_distance float,
  rrf_score float
)
language sql
stable
security invoker
set search_path = public, extensions
as $$
  with vector_hits as (
    select c.id, (c.embedding <=> p_query_embedding) as distance,
      row_number() over (order by c.embedding <=> p_query_embedding) as rank
    from public.chunks c
    join public.documents d on d.id = c.document_id
    where c.org_id = p_org_id
      and c.embedding is not null
      and (p_workspace_id is null or d.workspace_id = p_workspace_id)
      and (p_doc_type is null or d.doc_type = p_doc_type)
    order by c.embedding <=> p_query_embedding
    limit p_candidate_count
  ),
  keyword_hits as (
    select c.id,
      row_number() over (order by ts_rank(c.fts, websearch_to_tsquery('english', p_query_text)) desc) as rank
    from public.chunks c
    join public.documents d on d.id = c.document_id
    where c.org_id = p_org_id
      and p_query_text is not null and length(trim(p_query_text)) > 0
      and c.fts @@ websearch_to_tsquery('english', p_query_text)
      and (p_workspace_id is null or d.workspace_id = p_workspace_id)
      and (p_doc_type is null or d.doc_type = p_doc_type)
    order by ts_rank(c.fts, websearch_to_tsquery('english', p_query_text)) desc
    limit p_candidate_count
  ),
  fused as (
    select coalesce(v.id, k.id) as id,
      coalesce(1.0 / (60 + v.rank), 0) + coalesce(1.0 / (60 + k.rank), 0) as rrf_score,
      v.distance as vector_distance
    from vector_hits v
    full outer join keyword_hits k on k.id = v.id
  )
  select c.id, c.document_id, c.content, c.page_start, c.page_end, c.heading_path,
         c.chunk_index, d.title as document_title, d.doc_type,
         f.vector_distance, f.rrf_score
  from fused f
  join public.chunks c on c.id = f.id
  join public.documents d on d.id = c.document_id
  order by f.rrf_score desc
  limit p_match_count;
$$;

-- Verify the integrity of an org's audit chain (returns first broken seq, or null).
create or replace function public.verify_audit_chain(p_org_id uuid)
returns table (broken_seq bigint, ok boolean)
language plpgsql
stable
security definer
set search_path = public, extensions
as $$
declare
  r record;
  v_prev text := null;
  v_payload text;
  v_calc text;
begin
  for r in
    select * from public.audit_log where org_id = p_org_id order by seq asc
  loop
    v_payload := coalesce(v_prev, '') ||
      r.org_id::text || '|' || r.actor_type::text || '|' ||
      coalesce(r.actor_id::text, '') || '|' || r.action || '|' ||
      coalesce(r.target_type, '') || '|' || coalesce(r.target_id::text, '') || '|' ||
      coalesce(r.summary, '') || '|' || coalesce(r.model, '') || '|' ||
      coalesce(r.metadata::text, '{}') || '|' || r.created_at::text;
    v_calc := encode(digest(v_payload, 'sha256'), 'hex');
    if r.hash is distinct from v_calc then
      broken_seq := r.seq; ok := false; return next; return;
    end if;
    v_prev := r.hash;
  end loop;
  broken_seq := null; ok := true; return next;
end;
$$;
