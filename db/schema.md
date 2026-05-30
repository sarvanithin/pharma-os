# Data model

30 public tables in 8 logical groups, all org-scoped, all under RLS. Postgres 17 on Supabase, with the `vector` (pgvector) and `pgcrypto` extensions in the `extensions` schema.

Migrations live in [`supabase/migrations/`](../supabase/migrations/) and are applied (in order) by `supabase db push`. Seed reference data — workflow templates, extraction schemas, compliance rules — is a regular migration so it lands on every environment (local reset and cloud push) without a separate seed step.

## Multi-tenancy and RLS

Every business table has an `org_id uuid` column and a single permissive policy:

```sql
create policy <table>_members_all on public.<table>
  for all
  using (public.is_org_member(org_id))
  with check (public.is_org_member(org_id));
```

`is_org_member(p_org_id)` is a `SECURITY DEFINER STABLE` SQL function that checks `public.memberships` for `auth.uid()` with `status = 'active'`. Marking it `SECURITY DEFINER` is what avoids policy recursion when `memberships` itself has RLS — the helper bypasses RLS to ask the membership question, then the caller's policies use the boolean.

Org creation has a chicken-and-egg problem (you need to be a member to satisfy RLS, but the first member doesn't exist yet). Solved by an atomic `create_organization(name, slug)` RPC, also `SECURITY DEFINER`, which inserts the org and the owner membership in one transaction. Direct INSERTs to `organizations` are blocked by RLS.

Tables with nullable `org_id` (`workflow_templates`, `extraction_schemas`, `compliance_rules`) hold seeded global reference data: visible to everyone, writable only by org members for their own org-scoped overrides.

## Table groups

**Tenancy & identity.** `organizations`, `users` (mirrors `auth.users` via a `handle_new_user` trigger), `memberships(role: owner|admin|member|viewer)`, `workspaces`, `workspace_members`.

**Ingestion.** `connectors(type: upload|lims|qms|eln|csv|s3)` — the model for live integrations; current MVP wires the upload/CSV paths and stubs the rest. `ingestion_jobs` tracks connector syncs.

**Documents.** `documents(doc_type, status, content_hash, page_count, language, metadata)`, `document_versions`, `document_pages(page_number, raw_text, layout)`, `tags` + `document_tags`, `routing_rules(predicate jsonb, action jsonb, is_active)`.

**RAG / vectors.** `chunks(content, embedding vector(1024), page_start, page_end, heading_path[], embedding_model, fts tsvector GENERATED)`. Two indexes:
- HNSW cosine on `embedding` for vector ANN search.
- GIN on `fts` for keyword search.

The `match_chunks(p_org_id, p_query_embedding, p_query_text, ...)` RPC fuses vector + keyword with Reciprocal Rank Fusion in SQL and returns the top-N candidates by RRF score. Reranking with Voyage `rerank-2` is done in app code on the returned set.

**Extraction.** `extraction_schemas(doc_type, json_schema jsonb, prompt_template)` — one per `doc_type`, seeded globally. `extractions(fields jsonb, confidence, status, source_anchors jsonb, reviewed_by, reviewed_at)`. `source_anchors` is `[{field, page, quote}]` so every extracted field traces back to the source page + verbatim text.

**Knowledge graph.** `entities(type, name)` (unique per org+type+name), `links(from_type, from_id, to_type, to_id, relation, evidence_chunk_id)`. Documents link to entities via "mentions" during classification.

**Analytics.** `datasets(name, schema jsonb, row_count)` + `dataset_rows(row jsonb)` (one generic jsonb row store, fine for the MVP scale). `dashboards`, `dashboard_widgets(type, query_spec jsonb, viz_config jsonb)`, `analytics_queries`.

**Agents.** `workflow_templates(definition jsonb)` — see [agent-design.md](../docs/agent-design.md). `agent_runs(status, current_step_id, cost_tokens, inputs, outputs)`. `agent_run_steps(step_id, step_index, status, input jsonb, output jsonb, tool_calls jsonb, model, tokens, latency_ms)` with `unique(run_id, step_id)` so an upsert can persist a paused step idempotently. `approvals(run_id, step_id, proposed_action, status, decided_by, decision_payload)`.

**Compliance.** `compliance_rules(standard, rule_key, description, check_spec jsonb)` — seeded for ICH E6(R3) and 21 CFR Part 11. `compliance_checks(document_id, standard, results jsonb, score, status)`.

**Audit.** `audit_log(seq bigserial, actor_type, actor_id, action, target_type, target_id, summary, model, prompt_ref, response_ref, metadata jsonb, prev_hash, hash)`. Append-only:
- A BEFORE INSERT trigger computes `prev_hash` (last row for the org) and `hash = sha256(prev_hash || canonical_payload_of_this_row)`.
- A BEFORE UPDATE trigger and a BEFORE DELETE trigger both raise. Mutating the chain requires superuser DB access.
- `verify_audit_chain(p_org_id)` recomputes the chain row-by-row and returns the first broken `seq`, or null.

## Storage

Two private buckets: `documents/` (user uploads, path convention `<org_id>/<doc_id>/<filename>`) and `audit/` (reserved for archiving large prompt/response blobs in regulated deployments — not yet used by the MVP). RLS on `storage.objects` enforces that authenticated users can only read/write objects whose first path segment is an org they're a member of; background jobs use the service-role key and bypass these policies.

## Seeded reference data

A single migration (`20260101000008_seed_reference_data.sql`) inserts:

- 4 `extraction_schemas` — `csr`, `patent`, `ind`, `protocol` — each a JSON Schema of the fields a Claude extraction call should fill, plus a per-doc-type prompt hint.
- 9 `compliance_rules` — 5 for ICH E6(R3) (protocol objectives, informed consent, risk-based monitoring, ALCOA+ data integrity, safety reporting) and 4 for 21 CFR Part 11 (audit trail, e-signatures, access controls, validation).
- 9 `workflow_templates` covering the eight headline workflows (patent prior-art, patent extraction, IND assembly, regulatory report, tabular review, drug hypothesis, document classification, knowledge hub) plus an on-demand-dashboard scaffold. Each template's `definition.steps` is the data the agent runner executes.

This pattern — reference data as migrations, with `where not exists` style guards if you need re-runnability — is preferable to a separate `seed.sql` for cloud environments where you can't just `supabase db reset`.
