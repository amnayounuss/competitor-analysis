-- ============================================================
--  Admin DB migration 002 — dynamic date range support
--  Run this in YOUR ADMIN Supabase project (the one in .env)
--
--  Safe to re-run (uses IF NOT EXISTS).
-- ============================================================

alter table public.jobs
  add column if not exists date_start date,
  add column if not exists date_end   date;

comment on column public.jobs.date_start is
  'User-selected analysis window start (inclusive). NULL = legacy 3-month lookback.';
comment on column public.jobs.date_end is
  'User-selected analysis window end (inclusive). NULL = today.';

-- Same fields on schedules, so recurring runs remember the window
alter table public.schedules
  add column if not exists date_start_offset_days int,
  add column if not exists date_end_offset_days   int;

comment on column public.schedules.date_start_offset_days is
  'Offset in days from run date for date_start. e.g. -90 = 90 days before run.';
comment on column public.schedules.date_end_offset_days is
  'Offset in days from run date for date_end. e.g. 0 = run date itself.';

-- Free-form location qualifier appended to Google Maps search queries
-- (e.g. "Riyadh", "Dubai UAE", "London"). Empty/NULL = no qualifier.
alter table public.jobs
  add column if not exists search_location text;
alter table public.schedules
  add column if not exists search_location text;
comment on column public.jobs.search_location is
  'Location string appended to Google Maps search queries when scraping. NULL = global / no qualifier.';
