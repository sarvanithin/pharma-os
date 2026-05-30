# Architecture

A single Next.js app talking to a single Supabase Postgres. Long-running work goes through Inngest. Everything else is either Server Actions (mutations) or RSC server components (reads).

```
                    ┌──────────────────── Next.js (Vercel) ────────────────────┐
   Browser  <───>   │   RSC pages · Server Actions · Route Handlers · streaming │
                    └─────┬──────────────┬─────────────┬──────────────┬────────┘
                          │              │             │              │
                   (1) Ingest      (2) Doc Proc   (3) Data Room   (4) Agent Engine
                          │              │             │              │
                          └─── Inngest durable functions (retries, fan-out, pause/resume) ───┘
                                                │
                          Supabase Postgres 17 (pgvector + RLS)  ·  Supabase Storage
                                                │
                External APIs:  Claude (via Martian)  ·  Voyage (embed + rerank)  ·  OCR (LlamaParse, optional)
```

## End-to-end data flow

1. User uploads a file via a Server Action (`src/server/ingestion/upload.ts`). The file is streamed to Supabase Storage at `<org_id>/<doc_id>/<filename>`, a `documents` row is inserted, and a `document.uploaded` audit entry is written.
2. The action calls `dispatchProcessing(documentId, orgId)`. With `INNGEST_EVENT_KEY` set it fires the `document/ingested` event; without it, it runs the pipeline inline. Same code either way — `src/server/processing/pipeline.ts`.
3. The pipeline parses the file (native PDF text via `unpdf`, OCR fallback to LlamaParse when text is sparse), inserts `document_pages`, chunks the text (heading-aware, ~500–800 tokens with overlap), and writes `chunks`.
4. If `VOYAGE_API_KEY` is set, the pipeline embeds chunks via `voyage-3` and stores 1024-dim vectors in the `chunks.embedding pgvector` column (HNSW index).
5. If `MARTIAN_API_KEY` (or `ANTHROPIC_API_KEY`) is set, classification + structured extraction runs: Haiku classifies + tags + names entities; Opus runs schema-based extraction using a stored JSON Schema (per `doc_type`) via function calling, with per-field `source_anchors` containing page + verbatim quote.
6. Routing rules evaluate against the classified document and may auto-assign workspace / trigger downstream workflows.
7. The data room (`/api/rag`) embeds the user query, fuses vector + keyword (`match_chunks` RPC, Reciprocal Rank Fusion), reranks the top-N with Voyage `rerank-2`, and streams a cited answer from Claude. Citations are returned in an `x-citations` header (base64 JSON) so the UI can render them as clickable deep-links to source pages.
8. Workflows execute as a deterministic step state-machine (`src/server/agents/runner.ts`). Each step is one of `retrieval | llm_tool | transform | human_approval | compose`. `llm_tool` steps run a bounded tool-use loop (`search_data_room`, `list_documents`, then a forced `submit_result` for structured finalization).
9. Every action — user upload, classification, extraction, retrieval, agent step, tool call, approval — appends a row to `audit_log`. A BEFORE INSERT trigger computes `hash = sha256(prev_hash || canonical_payload)`, chaining each entry to its predecessor. UPDATE and DELETE on `audit_log` are blocked by triggers. A `verify_audit_chain(org_id)` RPC recomputes the chain to detect tampering.

## Decisions

### Inngest over a custom job queue
Three reasons. (a) Step-level retries and persistent state mean an LLM call inside a step is automatically retried with backoff on transient failures and resumed from the same step after a redeploy. (b) `waitForEvent` makes human-in-the-loop pause/resume trivially durable. (c) It survives serverless time limits, which the ingestion + agent flows would hit on a single function. The cost: another dependency and a second source of truth (event log) — but the alternative was building a `jobs` table + worker with the same primitives, badly. *This codebase keeps an inline fallback for local dev so contributors don't need Inngest running.*

### Supabase RLS over a custom permission layer
Org-scoped multi-tenancy with RLS as the backstop means a forgotten `where org_id = ...` in app code can't silently leak across tenants. `is_org_member(org_id)` and `has_org_role(org_id, role[])` are `SECURITY DEFINER STABLE` helpers that bypass policy recursion. Every business table has `org_id` and an `org_X_members_all` policy. The downside: a `service_role` client is needed for background jobs and you must scope by `org_id` manually there.

### Server Actions over REST endpoints
For mutations originating in the UI (upload, start workflow, approve, run compliance check) the cookie session is already there, the action runs as the authenticated user under RLS, and revalidation is one call. There's no payload contract to design or version. The exceptions are routes that need streaming or query-string semantics (`/api/rag` streams; `/api/audit/export` returns a download; `/api/inngest` is a serve handler).

### Claude via the Martian router (OpenAI-compatible)
The LLM client (`src/lib/anthropic/client.ts`) calls Martian's `https://api.withmartian.com/v1/chat/completions` and uses standard OpenAI tool-calling. Swapping providers (OpenAI, OpenRouter, native Anthropic) is a one-file change. This matters because the model layer is the most volatile dependency in any AI app — locking it to one vendor's SDK is a mistake I didn't want to make again.

### Hybrid retrieval + rerank, not pure vector
Pure vector misses keyword-exact phrases (drug codes like "ABC-123", numeric endpoints like "DAS28-CRP"). Pure keyword misses paraphrase. The RPC `match_chunks` runs both and fuses with Reciprocal Rank Fusion; the rerank with Voyage `rerank-2` then materially lifts citation precision. Voyage's models are also multilingual, which removes a class of retrieval failures across en/fr/zh/it.

### Hash chain in SQL, not in app code
The audit chain trigger lives in Postgres (`audit_hash_chain` trigger + `audit_log_immutable` blocker). Computing the chain in app code would mean any client with the service-role key could backdate or skip entries. With the trigger and immutability blockers, you'd need superuser DB access to forge an entry — and even then a `verify_audit_chain` run would surface it.

## Trust boundaries

| Boundary | What crosses it | What does not |
|---|---|---|
| **Browser → Next.js** | Auth cookie (Supabase SSR), document bytes on upload, query text in RAG | Service role key (server-only), other tenants' data (RLS) |
| **Next.js → Supabase** | RLS-scoped reads + writes with the user's JWT; service-role only inside trusted Inngest functions / server actions that need it | The user's JWT is never sent off-platform |
| **Next.js → Claude (Martian)** | The query, retrieved chunk text, conversation messages, step tools/results. Each call writes a row in `audit_log` referencing prompt + response artifacts | Auth cookies, service role key, raw documents (only chunked text is sent) |
| **Next.js → Voyage** | Chunk text (for embeddings), query text (for embeddings/rerank) | Other tenants' chunks (server filters by org_id), auth |
| **Next.js → LlamaParse** | Document bytes during OCR fallback only | Skipped entirely when native parse yields enough text |
| **audit_log** | Append-only inserts | UPDATE and DELETE are rejected at the trigger layer |

Data residency: documents and chunks stay in Supabase; only the chunked **text** ever leaves the platform, and only to LLM and embedding providers. Document bytes are sent to LlamaParse only when the native parser fails to extract enough text.

## One workflow, end-to-end (`drug_hypothesis`)

```
┌──────────┐    ┌──────────┐    ┌──────────────┐    ┌────────────────┐    ┌──────────┐    ┌──────────────────┐    ┌──────────┐
│  start   │──> │ s1 retr. │──> │ s2 llm_tool  │──> │ ESCALATE       │──> │ resume   │──> │ s3 human_approval│──> │ s4 comp. │
│  (user)  │    │ search   │    │ Evaluate hyp │    │ always_human → │    │ (user)   │    │ Expert sign-off  │    │ Report   │
└──────────┘    └──────────┘    └──────────────┘    │ approval row   │    └──────────┘    └──────────────────┘    └──────────┘
                                                    └────────────────┘                              │                    │
                                                                                                    │                    │
                                                                                            resume / pause          completed
```

- `start` writes `agent_runs(status=running)`, audits `workflow.started`, calls `executeRunFrom(runId, 0)`.
- `s1` (`retrieval`): `retrieve()` over the org's data room, returns top chunks; output stored as `agent_run_steps.output`.
- `s2` (`llm_tool`, Opus): a bounded tool-use loop. The model can call `search_data_room` to fetch more context; on the last iteration `submit_result` is forced so the step always finalizes to a structured `{ result, confidence, key_findings }`.
- After s2 completes, `escalation_policy.type === "always_human"` triggers: an `approvals` row is inserted with `proposed_action = output`, run status flips to `waiting_approval`, the function returns `{ paused: true }`.
- The Approvals inbox UI shows the proposed text. The user approves (optionally with a note); `decideApproval` updates the row and calls `resumeRun(runId, approvalId)`.
- `resumeRun` resolves to `s3` (the `human_approval` step itself); it marks s3 completed using the prior step's output (or the user's edited payload) and calls `executeRunFrom(runId, 3)`.
- `s4` (`compose`, Opus): generates a Markdown hypothesis report using accumulated context, persists to `agent_run_steps.output.document`.
- Run sets `status=completed`, writes `workflow.completed` audit, and the chain is closed.

Why the runner manages pause/resume via DB state rather than Inngest's `waitForEvent`: keeping the state in `agent_runs.current_step_id` + `agent_run_steps.status` means any operator can resume or replay a run from the DB without needing Inngest history to be intact, and the run inspector UI reads the same source of truth as the runner. Inngest still handles retries and durability *within* a step; what it doesn't manage is the human pause boundary.

## Multilingual handling

- Voyage `voyage-3` is multilingual by default, so vector retrieval works cross-language without per-language indexes.
- Classification asks Claude to detect the document's primary language (BCP 47 / ISO 639-1) and store it on `documents.language`.
- Tags and entity names are kept in the document's original language so non-Latin scripts surface intact in the UI.
- The keyword fallback (`tsvector` with the `'english'` config) is currently English-biased — sufficient as a *fallback* because primary retrieval is semantic. Per-language tsvector configs are a near-term TODO.
