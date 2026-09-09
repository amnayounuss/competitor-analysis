-- ============================================================
--  009_ai_provider_key.sql
--
--  One AI key column, either provider.
--
--  client_databases.anthropic_api_key predates OpenAI support and its name now
--  misleads: a client may hold an OpenAI key instead. ai_api_key replaces it,
--  with the provider inferred from the key itself (sk-ant- → Anthropic,
--  otherwise OpenAI) rather than stored as a separate field that could disagree
--  with the key beside it.
--
--  The old column is kept and back-filled rather than dropped, so a rollback
--  does not lose anyone's key. Code reads ai_api_key first and falls back.
-- ============================================================

alter table public.client_databases
  add column if not exists ai_api_key text;

-- Carry existing keys across; they are all Anthropic by definition.
update public.client_databases
   set ai_api_key = anthropic_api_key
 where ai_api_key is null
   and anthropic_api_key is not null
   and btrim(anthropic_api_key) <> '';

comment on column public.client_databases.ai_api_key is
  'Claude or OpenAI API key. The provider is detected from the prefix — see lib/ai-provider.ts. Supersedes anthropic_api_key, which is retained for rollback.';

notify pgrst, 'reload schema';
