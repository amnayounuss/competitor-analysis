-- Add per-client Anthropic API key to client_databases
ALTER TABLE public.client_databases ADD COLUMN IF NOT EXISTS anthropic_api_key text;
