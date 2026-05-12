-- ============================================================
--  Client DB migration 002 — Excel-mirror analytics tables
--  Run this in YOUR CLIENT Supabase project (the one connected
--  via /connect-database in the app).
--
--  Adds tables that mirror every sheet of the analysis Excel:
--    Sheet 1 "Branch Wise Data"   → branch_analytics
--    Sheet 2 "Brand Comparison"   → already in `analyses`
--    Sheet 3 "Rankings"           → `branch_rankings` view
--    Sheet 4 "All Reviews"        → already in `reviews`
--    Sheet 5 "Popular Times"      → `popular_times_detail` view
--    Sheet 6 "Dashboard"          → `job_summary` view
--
--  Safe to re-run.
-- ============================================================

-- ── Sheet 1: Branch Wise Data ──────────────────────────────
create table if not exists public.branch_analytics (
  id                      uuid         primary key default gen_random_uuid(),
  job_id                  uuid         not null,
  branch_id               uuid         references public.branches(id) on delete cascade,

  -- denormalized for fast lookup
  brand                   text         not null,
  branch_name             text         not null,
  city                    text,
  address                 text,
  google_maps_link        text,
  business_hours          text,        -- pipe-separated daily hours
  phone                   text,

  -- popular times rollups
  peak_day                text,
  peak_hour               text,
  peak_busyness_pct       int,
  peak_time               text,        -- e.g. "Sunday 8 PM (76%)"
  busy_hours_summary      text,        -- e.g. "Mon: 11AM-2PM | Sat: 6PM-10PM"

  -- period (date_start → date_end) rollups
  avg_rating_period       numeric(3,2),
  total_reviews_period    int          not null default 0,

  -- per-month-bucket breakdown (3 buckets relative to window end)
  month_1_reviews         int          not null default 0,
  month_1_avg_rating      numeric(3,2),
  month_2_reviews         int          not null default 0,
  month_2_avg_rating      numeric(3,2),
  month_3_reviews         int          not null default 0,
  month_3_avg_rating      numeric(3,2),

  -- star histogram (within period)
  star_5_count            int          not null default 0,
  star_4_count            int          not null default 0,
  star_3_count            int          not null default 0,
  star_2_count            int          not null default 0,
  star_1_count            int          not null default 0,

  -- raw popular times grid (7 × 24) for heatmap rendering
  popular_times_grid      jsonb,

  -- analysis window echoed for convenience (so dashboards don't
  -- need to join admin DB)
  date_start              date,
  date_end                date,

  created_at              timestamptz  not null default now()
);

create index if not exists branch_analytics_job_idx
  on public.branch_analytics (job_id);
create index if not exists branch_analytics_brand_idx
  on public.branch_analytics (brand);
create index if not exists branch_analytics_branch_idx
  on public.branch_analytics (branch_id);

-- ── Sheet 3: Rankings (view over branch_analytics) ─────────
create or replace view public.branch_rankings as
select
  row_number() over (
    partition by job_id
    order by avg_rating_period desc nulls last,
             total_reviews_period desc nulls last
  )                            as rank,
  job_id,
  branch_id,
  brand,
  branch_name,
  city,
  address,
  avg_rating_period            as avg_rating,
  total_reviews_period         as reviews
from public.branch_analytics
where total_reviews_period > 0
  and avg_rating_period is not null;

-- ── Sheet 5: Popular Times Detail (flat 24-hour view) ──────
--  One row per (branch × day). Hour columns 0_h .. 23_h hold
--  the % busy value (0-100, NULL if unknown).
create or replace view public.popular_times_detail as
with day_rows as (
  select
    ba.job_id,
    ba.branch_id,
    ba.brand,
    ba.branch_name,
    day_key                                as day,
    case day_key
      when 'SUNDAY'    then 'Sunday'
      when 'MONDAY'    then 'Monday'
      when 'TUESDAY'   then 'Tuesday'
      when 'WEDNESDAY' then 'Wednesday'
      when 'THURSDAY'  then 'Thursday'
      when 'FRIDAY'    then 'Friday'
      when 'SATURDAY'  then 'Saturday'
    end                                     as day_label,
    ba.popular_times_grid -> day_key       as hourly
  from public.branch_analytics ba
  cross join (
    values ('SUNDAY'),('MONDAY'),('TUESDAY'),('WEDNESDAY'),
           ('THURSDAY'),('FRIDAY'),('SATURDAY')
  ) as d(day_key)
  where ba.popular_times_grid is not null
)
select
  job_id, branch_id, brand, branch_name, day, day_label,
  (hourly ->> 0)::int  as h_0,  (hourly ->> 1)::int  as h_1,
  (hourly ->> 2)::int  as h_2,  (hourly ->> 3)::int  as h_3,
  (hourly ->> 4)::int  as h_4,  (hourly ->> 5)::int  as h_5,
  (hourly ->> 6)::int  as h_6,  (hourly ->> 7)::int  as h_7,
  (hourly ->> 8)::int  as h_8,  (hourly ->> 9)::int  as h_9,
  (hourly ->>10)::int  as h_10, (hourly ->>11)::int  as h_11,
  (hourly ->>12)::int  as h_12, (hourly ->>13)::int  as h_13,
  (hourly ->>14)::int  as h_14, (hourly ->>15)::int  as h_15,
  (hourly ->>16)::int  as h_16, (hourly ->>17)::int  as h_17,
  (hourly ->>18)::int  as h_18, (hourly ->>19)::int  as h_19,
  (hourly ->>20)::int  as h_20, (hourly ->>21)::int  as h_21,
  (hourly ->>22)::int  as h_22, (hourly ->>23)::int  as h_23
from day_rows
where hourly is not null;

-- ── Sheet 6: Dashboard summary (per-job rollup) ────────────
create or replace view public.job_summary as
select
  ba.job_id,
  count(*)                                                          as total_branches,
  sum(total_reviews_period)                                         as total_reviews,
  count(*) filter (where popular_times_grid is not null)            as branches_with_pt,
  round(
    sum(avg_rating_period * total_reviews_period)::numeric
      / nullif(sum(total_reviews_period), 0),
    2
  )                                                                  as weighted_avg_rating,
  min(date_start)                                                    as date_start,
  max(date_end)                                                      as date_end
from public.branch_analytics ba
group by ba.job_id;
