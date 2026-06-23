-- ============================================================
--  Migration 003 — add store_name column
--  Run THIS in your Supabase SQL editor (the client DB).
--
--  store_name holds the ORIGINAL Google store name for each
--  location (English or Arabic, exactly as Google returns it,
--  e.g. "بستاني شوكولا Bostani Chocolate"). It is shown alongside
--  the clean AI-parsed branch_name (district/area).
-- ============================================================

alter table public.branches         add column if not exists store_name text;
alter table public.branch_analytics add column if not exists store_name text;
