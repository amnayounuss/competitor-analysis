-- ============================================================
--  Client DB schema — run THIS in YOUR Supabase project
--  (the one you connect to the SaaS app)
--
--  This creates the tables that will hold your scraped business
--  data: branches, reviews, analyses, and report files.
-- ============================================================

-- ── Branches (target + competitors) ─────────────────────────
create table if not exists public.branches (
  id              uuid        primary key default gen_random_uuid(),
  job_id          uuid        not null,                   -- from the SaaS app
  brand           text        not null,                   -- "Anoosh", "Patchi" etc
  branch_name     text        not null,
  city            text,
  address         text,
  phone           text,
  website         text,
  hours_json      jsonb,
  popular_times   jsonb,
  is_target       boolean     default false,              -- true for the brand owner ran the analysis on
  created_at      timestamptz not null default now()
);

create index if not exists branches_job_idx   on public.branches (job_id);
create index if not exists branches_brand_idx on public.branches (brand);

-- ── Reviews (last 3 months, per branch) ─────────────────────
create table if not exists public.reviews (
  id            bigserial   primary key,
  job_id        uuid        not null,
  branch_id     uuid        references public.branches(id) on delete cascade,
  brand         text        not null,
  rating        int         check (rating between 1 and 5),
  text          text,
  reviewer_name text,
  published_at  timestamptz,
  created_at    timestamptz not null default now()
);

create index if not exists reviews_job_idx       on public.reviews (job_id);
create index if not exists reviews_branch_idx    on public.reviews (branch_id);
create index if not exists reviews_published_idx on public.reviews (published_at desc);

-- ── Analyses (per-brand summary) ────────────────────────────
create table if not exists public.analyses (
  id                bigserial   primary key,
  job_id            uuid        not null,
  brand             text        not null,
  branch_count      int,
  total_reviews_3m  int,
  avg_rating_3m     numeric(3,2),
  star_5_count      int default 0,
  star_4_count      int default 0,
  star_3_count      int default 0,
  star_2_count      int default 0,
  star_1_count      int default 0,
  created_at        timestamptz not null default now()
);

create index if not exists analyses_job_idx on public.analyses (job_id);

-- ── Reports (Excel + Markdown URLs) ─────────────────────────
create table if not exists public.reports (
  id              bigserial   primary key,
  job_id          uuid        not null unique,
  target_brand    text        not null,
  competitors     text[],
  excel_url       text,
  report_md_url   text,
  excel_size_kb   int,
  created_at      timestamptz not null default now()
);

create index if not exists reports_job_idx on public.reports (job_id);

-- ── Job history (mirror of admin's jobs for client's view) ──
create table if not exists public.job_history (
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

-- ── Storage bucket for Excel + Markdown files ───────────────
-- This SQL creates the bucket if it doesn't exist.
insert into storage.buckets (id, name, public)
values ('reports', 'reports', true)
on conflict (id) do nothing;

-- Public read access for the bucket — files have unguessable UUIDs in their paths
drop policy if exists "Public reports read" on storage.objects;
create policy "Public reports read"
  on storage.objects for select
  using (bucket_id = 'reports');

drop policy if exists "Service role full access" on storage.objects;
create policy "Service role full access"
  on storage.objects for all
  using (bucket_id = 'reports');
