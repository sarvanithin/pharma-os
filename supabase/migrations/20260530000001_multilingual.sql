-- Multilingual support: detected language is stored per document.
-- Voyage embeddings (voyage-3) are multilingual by default so semantic search
-- works cross-language; this column lets the UI/filters reason about language
-- and lets keyword fallback choose an appropriate tsvector config later.
alter table public.documents add column if not exists language text;
create index if not exists documents_language_idx on public.documents (org_id, language);
