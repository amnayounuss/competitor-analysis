-- ============================================================
--  008_places_key_and_discovery.sql
--
--  Two additions that unblock automatic competitor discovery.
--
--  1. app_settings.google_places_api_key
--     lib/settings.ts has always read `settings.google_places_api_key`, but the
--     column never existed — so the value silently resolved to undefined and
--     fell through to an env var that was never set either. The result: every
--     job skipped Places discovery and fell back to Puppeteer, which yields hex
--     CIDs instead of ChIJ place ids. Apify rejects those, so competitors came
--     back with no popular times and no rating distribution.
--
--  2. client_databases.gmb_refresh_token
--     The token is currently typed into the new-analysis form each time and
--     never stored. Competitor discovery runs on its own, with no job attached,
--     so it needs the token independently. Storing it also means the client
--     stops re-pasting it on every run.
--
--  3. Per-client discovery tuning
--     Radius and thresholds differ by market: 5 km is right inside Riyadh or
--     Jeddah, too tight in a small town. Kept per client rather than global.
-- ============================================================

alter table public.app_settings
  add column if not exists google_places_api_key text;

alter table public.client_databases
  add column if not exists gmb_refresh_token text,
  add column if not exists discovery_radius_m int    not null default 5000,
  add column if not exists discovery_max_per_location int not null default 20,
  add column if not exists discovery_min_colocation   int not null default 2,
  add column if not exists discovery_last_run_at timestamptz;

comment on column public.client_databases.gmb_refresh_token is
  'Google Business Profile refresh token, scoped business.manage. Used by competitor discovery, which has no job to read it from.';
comment on column public.client_databases.discovery_radius_m is
  'Nearby-search radius in metres. 5000 suits a dense city; raise it for sparse areas.';
comment on column public.client_databases.discovery_min_colocation is
  'A candidate must sit near at least this many of the client''s own locations to be suggested. This is what separates a competitor from a neighbour.';

notify pgrst, 'reload schema';
