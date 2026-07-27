-- ============================================================
--  Client DB schema — tables for scraped business data.
--  Used both for cloud Supabase clients and self-hosted schemas.
--  NOTE: No schema prefix — tables resolve via search_path.
-- ============================================================

-- ── Branches (target + competitors) ─────────────────────────
create table if not exists branches (
  id              uuid        primary key default gen_random_uuid(),
  job_id          uuid        not null,                   -- from the SaaS app
  place_id        text,                                   -- Google Maps place identifier for dedup
  brand           text        not null,                   -- target brand or competitor name
  branch_name     text        not null,                   -- clean district/area name (AI-parsed)
  store_name      text,                                   -- original Google store name (EN or AR, as Google returns it)
  city            text,
  address         text,
  phone           text,
  website         text,
  hours_json      jsonb,
  popular_times   jsonb,
  stars           numeric(3,2) default 0,
  reviews_count   int          default 0,
  is_target       boolean      default false,
  created_at      timestamptz not null default now()
);

create index if not exists branches_job_idx   on branches (job_id);
create index if not exists branches_brand_idx on branches (brand);

-- ── Reviews (per branch) ─────────────────────────────────────
create table if not exists reviews (
  id            bigserial   primary key,
  job_id        uuid        not null,
  branch_id     uuid        references branches(id) on delete cascade,
  brand         text        not null,
  rating        int         check (rating between 1 and 5),
  text          text,
  reviewer_name text,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists reviews_job_idx       on reviews (job_id);
create index if not exists reviews_branch_idx    on reviews (branch_id);
create index if not exists reviews_published_idx on reviews (published_at desc);

-- ── Analyses (per-brand summary) ────────────────────────────
create table if not exists analyses (
  id                bigserial   primary key,
  job_id            uuid        not null,
  brand             text        not null,
  branch_count      int,
  total_reviews_period  int,
  avg_rating_period     numeric(3,2),
  star_5_count      int default 0,
  star_4_count      int default 0,
  star_3_count      int default 0,
  star_2_count      int default 0,
  star_1_count      int default 0,
  created_at        timestamptz not null default now()
);

create index if not exists analyses_job_idx on analyses (job_id);

-- ── Reports (Excel + Markdown URLs) ─────────────────────────
create table if not exists reports (
  id              bigserial   primary key,
  job_id          uuid        not null unique,
  target_brand    text        not null,
  competitors     text[],
  excel_url       text,
  report_md_url   text,
  excel_size_kb   int,
  created_at      timestamptz not null default now()
);

create index if not exists reports_job_idx on reports (job_id);

-- ── Job history (mirror of admin's jobs for client's view) ──
create table if not exists job_history (
  job_id          uuid        primary key,
  target_brand    text        not null,
  competitors     text[],
  status          text        not null,
  branches_total  int,
  reviews_total   int,
  started_at      timestamptz,
  finished_at     timestamptz,
  duration_sec    int,
  created_at      timestamptz not null default now()
);

-- ── Branch analytics (mirrors Excel "Branch Wise Data" sheet) ──
create table if not exists branch_analytics (
  id                      uuid         primary key default gen_random_uuid(),
  job_id                  uuid         not null,
  branch_id               uuid         references branches(id) on delete cascade,

  brand                   text         not null,
  branch_name             text         not null,
  store_name              text,
  city                    text,
  address                 text,
  google_maps_link        text,
  business_hours          text,
  phone                   text,

  peak_day                text,
  peak_hour               text,
  peak_busyness_pct       int,
  peak_time               text,
  busy_hours_summary      text,

  avg_rating_period       numeric(3,2),
  total_reviews_period    int          not null default 0,

  period_1_reviews         int          not null default 0,
  period_1_avg_rating      numeric(3,2),
  period_2_reviews         int          not null default 0,
  period_2_avg_rating      numeric(3,2),
  period_3_reviews         int          not null default 0,
  period_3_avg_rating      numeric(3,2),

  star_5_count            int          not null default 0,
  star_4_count            int          not null default 0,
  star_3_count            int          not null default 0,
  star_2_count            int          not null default 0,
  star_1_count            int          not null default 0,

  popular_times_grid      jsonb,
  date_start              date,
  date_end                date,

  created_at              timestamptz  not null default now()
);

create index if not exists branch_analytics_job_idx    on branch_analytics (job_id);
create index if not exists branch_analytics_brand_idx  on branch_analytics (brand);
create index if not exists branch_analytics_branch_idx on branch_analytics (branch_id);

-- ── Rankings view (Sheet 3) ────────────────────────────────
create or replace view branch_rankings as
select
  row_number() over (
    partition by job_id
    order by avg_rating_period desc nulls last,
             total_reviews_period desc nulls last
  )                        as rank,
  job_id, branch_id, brand, branch_name, city, address,
  avg_rating_period        as avg_rating,
  total_reviews_period     as reviews
from branch_analytics
where total_reviews_period > 0 and avg_rating_period is not null;

-- ── Popular times flat view (Sheet 5) ──────────────────────
create or replace view popular_times_detail as
with day_rows as (
  select ba.job_id, ba.branch_id, ba.brand, ba.branch_name,
         d.day_key as day,
         case d.day_key
           when 'SUNDAY' then 'Sunday' when 'MONDAY' then 'Monday'
           when 'TUESDAY' then 'Tuesday' when 'WEDNESDAY' then 'Wednesday'
           when 'THURSDAY' then 'Thursday' when 'FRIDAY' then 'Friday'
           when 'SATURDAY' then 'Saturday'
         end as day_label,
         ba.popular_times_grid -> d.day_key as hourly
  from branch_analytics ba
  cross join (values ('SUNDAY'),('MONDAY'),('TUESDAY'),('WEDNESDAY'),
                     ('THURSDAY'),('FRIDAY'),('SATURDAY')) as d(day_key)
  where ba.popular_times_grid is not null
)
select job_id, branch_id, brand, branch_name, day, day_label,
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
from day_rows where hourly is not null;

-- ── Per-job summary (Sheet 6 "Dashboard") ──────────────────
create or replace view job_summary as
select
  job_id,
  count(*)                                                  as total_branches,
  sum(total_reviews_period)                                 as total_reviews,
  count(*) filter (where popular_times_grid is not null)    as branches_with_pt,
  round(
    sum(avg_rating_period * total_reviews_period)::numeric
      / nullif(sum(total_reviews_period), 0), 2
  )                                                         as weighted_avg_rating,
  min(date_start)                                           as date_start,
  max(date_end)                                             as date_end
from branch_analytics
group by job_id;

-- ── Storage ─────────────────────────────────────────────────
-- Storage bucket (reports) is created once at the instance level,
-- not per-client schema. See docker/scripts/setup.sh.
