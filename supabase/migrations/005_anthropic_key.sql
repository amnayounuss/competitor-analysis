-- Add Anthropic API key to app_settings (admin-configured)
ALTER TABLE public.app_settings ADD COLUMN IF NOT EXISTS anthropic_api_key text;
