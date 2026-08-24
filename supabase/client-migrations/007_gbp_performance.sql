-- ============================================================
--  007_gbp_performance.sql
--
--  Google Business Profile Performance API storage.
--
--    GET https://businessprofileperformance.googleapis.com/v1/
--        locations/{LOCATION_ID}:getDailyMetricsTimeSeries
--
--  That endpoint is keyed by the GMB LOCATION ID (the numeric tail of the
--  Business Profile resource name "locations/1234567890"), which is a different
--  identifier from the Google Maps place_id we already store. The pipeline used
--  loc.name only in-flight to fetch reviews and never persisted it, so this
--  migration adds a column for it — without the id there is no way to call the
--  Performance API for a branch on a later run.
--
--  Only the client's own branches have one: the Performance API returns data
--  solely for locations the authenticated account manages. Competitor rows keep
--  it NULL.
--
--  NOTE: no schema prefix — resolves via search_path.
-- ============================================================

alter table branches add column if not exists gmb_location_id text;

create index if not exists branches_gmb_location_idx on branches (gmb_location_id);

-- ── Daily metric time series ────────────────────────────────
-- One row per (branch, metric, day). The API is queried once per metric per
-- location, each call returning a day-by-day series for the requested range.
create table if not exists gbp_metrics (
  id              bigserial   primary key,
  job_id          uuid        not null,
  branch_id       uuid        references branches(id) on delete cascade,
  gmb_location_id text        not null,
  brand           text,
  branch_name     text,
  metric          text        not null,
  metric_date     date        not null,
  value           bigint      not null default 0,
  created_at      timestamptz not null default now(),
  -- A re-run of the same job must update, not duplicate.
  unique (job_id, gmb_location_id, metric, metric_date)
);

create index if not exists gbp_metrics_job_idx    on gbp_metrics (job_id);
create index if not exists gbp_metrics_metric_idx on gbp_metrics (metric);
create index if not exists gbp_metrics_date_idx   on gbp_metrics (metric_date);
create index if not exists gbp_metrics_branch_idx on gbp_metrics (branch_id);

-- ── Per-metric totals per branch (dashboard KPI cards + pie charts) ──
create or replace view gbp_metric_totals as
select
  job_id,
  branch_id,
  gmb_location_id,
  brand,
  branch_name,
  metric,
  sum(value)::bigint          as total,
  round(avg(value), 2)        as daily_avg,
  max(value)                  as peak_value,
  min(metric_date)            as date_start,
  max(metric_date)            as date_end,
  count(*)::int               as days
from gbp_metrics
group by job_id, branch_id, gmb_location_id, brand, branch_name, metric;

-- ── Day-of-week × metric grid (heatmap) ─────────────────────
-- dow: 0 = Sunday … 6 = Saturday, matching the popular-times convention
-- already used elsewhere in this schema.
create or replace view gbp_metric_heatmap as
select
  job_id,
  metric,
  extract(dow from metric_date)::int as dow,
  sum(value)::bigint                 as total,
  round(avg(value), 2)               as avg_value,
  count(*)::int                      as days
from gbp_metrics
group by job_id, metric, extract(dow from metric_date);

-- ── Whole-brand daily trend (line charts) ───────────────────
create or replace view gbp_metric_daily as
select
  job_id,
  metric,
  metric_date,
  sum(value)::bigint as value,
  count(*)::int      as branches
from gbp_metrics
group by job_id, metric, metric_date;

grant select on gbp_metric_totals, gbp_metric_heatmap, gbp_metric_daily to anon, authenticated, service_role;
grant select, insert, update, delete on gbp_metrics to anon, authenticated, service_role;
grant usage, select on sequence gbp_metrics_id_seq to anon, authenticated, service_role;

notify pgrst, 'reload schema';
