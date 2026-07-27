-- Rewrite storage URLs after migration from Supabase Cloud to self-hosted.
-- Run this AFTER migrate-clients.mjs completes.
--
-- Usage:
--   Replace YOUR_SELF_HOSTED_URL with your actual self-hosted Supabase URL.
--   psql $SELF_HOSTED_DB_URL -f docker/scripts/rewrite-urls.sql

-- Update admin DB: jobs table
UPDATE public.jobs
SET excel_url = regexp_replace(
  excel_url,
  'https://[a-z]+\.supabase\.co/storage/v1',
  'YOUR_SELF_HOSTED_URL/storage/v1'
)
WHERE excel_url LIKE '%supabase.co/storage%';

UPDATE public.jobs
SET report_url = regexp_replace(
  report_url,
  'https://[a-z]+\.supabase\.co/storage/v1',
  'YOUR_SELF_HOSTED_URL/storage/v1'
)
WHERE report_url LIKE '%supabase.co/storage%';

-- Note: Client tables (reports, job_history) are now in per-client schemas.
-- The migrate-clients.mjs script uploads files to the self-hosted storage
-- under {schema_name}/{jobId}/ paths. The URLs in these tables point to
-- cloud storage and need to be rewritten per-schema.
--
-- Run this for each client schema:
--
--   SET search_path TO client_XXXXXXXX;
--
--   UPDATE reports
--   SET excel_url = regexp_replace(
--     excel_url,
--     'https://[a-z]+\.supabase\.co/storage/v1/object/public/reports/',
--     'YOUR_SELF_HOSTED_URL/storage/v1/object/public/reports/client_XXXXXXXX/'
--   )
--   WHERE excel_url LIKE '%supabase.co%';
--
--   UPDATE reports
--   SET report_md_url = regexp_replace(
--     report_md_url,
--     'https://[a-z]+\.supabase\.co/storage/v1/object/public/reports/',
--     'YOUR_SELF_HOSTED_URL/storage/v1/object/public/reports/client_XXXXXXXX/'
--   )
--   WHERE report_md_url LIKE '%supabase.co%';
--
--   UPDATE job_history
--   SET ... (same pattern for any URL columns)
--
--   RESET search_path;
