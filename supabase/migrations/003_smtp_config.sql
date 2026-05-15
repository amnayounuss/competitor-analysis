-- Migrate from Gmail OAuth to SMTP
ALTER TABLE public.app_settings 
  DROP COLUMN IF EXISTS gmail_oauth_client_id,
  DROP COLUMN IF EXISTS gmail_oauth_client_secret,
  DROP COLUMN IF EXISTS gmail_refresh_token,
  DROP COLUMN IF EXISTS gmail_user,
  DROP COLUMN IF EXISTS gmail_from_name;

ALTER TABLE public.app_settings
  ADD COLUMN IF NOT EXISTS smtp_host text,
  ADD COLUMN IF NOT EXISTS smtp_port integer DEFAULT 587,
  ADD COLUMN IF NOT EXISTS smtp_user text,
  ADD COLUMN IF NOT EXISTS smtp_pass text,
  ADD COLUMN IF NOT EXISTS smtp_secure boolean DEFAULT false,
  ADD COLUMN IF NOT EXISTS smtp_from_name text DEFAULT 'Reports',
  ADD COLUMN IF NOT EXISTS smtp_from_email text;
