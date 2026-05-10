-- ============================================================
--  Admin DB schema (BYO Supabase model)
--  Run in YOUR Supabase project (the one in .env)
-- ============================================================

-- ── Profiles ─────────────────────────────────────────────────
create table public.profiles (
  id          uuid        primary key references auth.users(id) on delete cascade,
  email       text        not null,
  full_name   text,
  is_admin    boolean     not null default false,
  created_at  timestamptz not null default now()
);

create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name)
  values (new.id, new.email, coalesce(new.raw_user_meta_data->>'full_name', new.email));
  return new;
end; $$;

create trigger on_auth_user_created
  after insert on auth.users
  for each row execute function public.handle_new_user();

-- ── App settings (singleton) ─────────────────────────────────
-- 2 distinct Google Cloud projects:
--   1. Gmail-side  → for sending email via OAuth2 (admin's account)
--   2. GMB-side    → for Google Business Profile API (clients' refresh tokens use this)
create table public.app_settings (
  id                          int          primary key default 1,

  -- Gmail OAuth (sender — admin's account)
  gmail_user                  text,                       -- the gmail address that sends
  gmail_from_name             text         default 'Reports',
  gmail_oauth_client_id       text,
  gmail_oauth_client_secret   text,
  gmail_refresh_token         text,                       -- admin's refresh token

  -- GMB OAuth (Google Business Profile API — separate Google project)
  gmb_oauth_client_id         text,
  gmb_oauth_client_secret     text,
  -- (refresh tokens here are per-client, captured from the job form)

  -- Worker / behavior
  worker_poll_ms              int          default 5000,
  puppeteer_headless          boolean      default true,
  signup_allowed              boolean      default true,
  setup_completed             boolean      default false,

  updated_at                  timestamptz  not null default now(),
  updated_by                  uuid         references auth.users(id),
  constraint app_settings_singleton check (id = 1)
);
insert into public.app_settings (id) values (1) on conflict do nothing;

-- ── Client database connections ─────────────────────────────
create table public.client_databases (
  user_id            uuid        primary key references auth.users(id) on delete cascade,
  supabase_url       text        not null,
  service_role_key   text        not null,
  schema_version     int         default 1,
  last_test_ok       boolean     default false,
  last_test_at       timestamptz,
  last_test_error    text,
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now()
);

-- ── Jobs queue ───────────────────────────────────────────────
create type job_status as enum ('queued','running','succeeded','failed','cancelled');
create type job_kind   as enum ('manual','scheduled');

create table public.jobs (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  kind            job_kind    not null default 'manual',
  schedule_id     uuid,

  target_name     text        not null,
  competitors     text[]      not null,
  refresh_token   text        not null,                 -- client's GMB refresh token
  email_to        text        not null,

  status          job_status  not null default 'queued',
  progress_pct    int         not null default 0,
  current_stage   text,
  queued_at       timestamptz not null default now(),
  started_at      timestamptz,
  finished_at     timestamptz,
  error_message   text,

  branches_total  int,
  reviews_total   int,
  excel_url       text,
  report_url      text
);

create index jobs_status_queued_at_idx on public.jobs (status, queued_at);
create index jobs_user_id_idx          on public.jobs (user_id);

create table public.job_logs (
  id          bigserial   primary key,
  job_id      uuid        not null references public.jobs(id) on delete cascade,
  level       text        not null default 'info',
  message     text        not null,
  created_at  timestamptz not null default now()
);
create index job_logs_job_id_idx on public.job_logs (job_id, created_at);

-- ── Schedules ────────────────────────────────────────────────
create table public.schedules (
  id              uuid        primary key default gen_random_uuid(),
  user_id         uuid        not null references auth.users(id) on delete cascade,
  enabled         boolean     not null default true,
  target_name     text        not null,
  competitors     text[]      not null,
  refresh_token   text        not null,
  email_to        text        not null,
  day_of_month    int         not null default 1 check (day_of_month between 1 and 28),
  next_run_at     timestamptz not null,
  last_run_at     timestamptz,
  last_job_id     uuid        references public.jobs(id) on delete set null,
  created_at      timestamptz not null default now()
);
create index schedules_next_run_idx on public.schedules (enabled, next_run_at);

-- ── Notifications ────────────────────────────────────────────
create table public.notifications (
  id          bigserial   primary key,
  user_id     uuid        not null references auth.users(id) on delete cascade,
  job_id      uuid        references public.jobs(id) on delete cascade,
  kind        text        not null,
  title       text        not null,
  body        text,
  read_at     timestamptz,
  created_at  timestamptz not null default now()
);
create index notifications_user_unread_idx on public.notifications (user_id, read_at, created_at desc);

-- ── RLS ──────────────────────────────────────────────────────
alter table public.profiles         enable row level security;
alter table public.app_settings     enable row level security;
alter table public.client_databases enable row level security;
alter table public.jobs             enable row level security;
alter table public.job_logs         enable row level security;
alter table public.schedules        enable row level security;
alter table public.notifications    enable row level security;

create policy "profiles: self read"   on public.profiles for select using (auth.uid() = id);
create policy "profiles: self update" on public.profiles for update using (auth.uid() = id);

create policy "app_settings: admin"   on public.app_settings for all
  using (exists (select 1 from public.profiles where id = auth.uid() and is_admin = true));

create policy "client_databases: own" on public.client_databases for all using (auth.uid() = user_id);
create policy "jobs: own"             on public.jobs for all using (auth.uid() = user_id);
create policy "job_logs: own"         on public.job_logs for select
  using (exists (select 1 from public.jobs j where j.id = job_id and j.user_id = auth.uid()));
create policy "schedules: own"        on public.schedules for all using (auth.uid() = user_id);
create policy "notifications: own"    on public.notifications for all using (auth.uid() = user_id);

-- ── Setup status function ───────────────────────────────────
create or replace function public.is_setup_completed()
returns boolean language sql security definer set search_path = public as $$
  select coalesce((select setup_completed from public.app_settings where id = 1), false);
$$;
grant execute on function public.is_setup_completed() to anon, authenticated;

-- ── Realtime ─────────────────────────────────────────────────
alter publication supabase_realtime add table public.jobs;
alter publication supabase_realtime add table public.job_logs;
alter publication supabase_realtime add table public.notifications;
