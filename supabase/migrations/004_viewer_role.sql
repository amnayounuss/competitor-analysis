-- ============================================================
--  Add viewer role support for client sub-users
-- ============================================================

-- Add role column (admin, client, viewer)
alter table public.profiles add column if not exists role text not null default 'client';
alter table public.profiles add column if not exists parent_user_id uuid references public.profiles(id) on delete cascade;

-- Backfill existing users
update public.profiles set role = 'admin' where is_admin = true;
update public.profiles set role = 'client' where is_admin = false;

-- Drop is_admin (replaced by role)
alter table public.profiles drop column if exists is_admin;

-- Update trigger to accept role + parent_user_id from metadata
create or replace function public.handle_new_user()
returns trigger language plpgsql security definer set search_path = public as $$
begin
  insert into public.profiles (id, email, full_name, role, parent_user_id)
  values (
    new.id,
    new.email,
    coalesce(new.raw_user_meta_data->>'full_name', new.email),
    coalesce(new.raw_user_meta_data->>'role', 'client'),
    (new.raw_user_meta_data->>'parent_user_id')::uuid
  );
  return new;
end; $$;

-- RLS: viewers can read their parent's client_databases
create policy "client_databases: viewer read parent"
  on public.client_databases for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'viewer'
        and profiles.parent_user_id = client_databases.user_id
    )
  );

-- RLS: viewers can read their parent's jobs
create policy "jobs: viewer read parent"
  on public.jobs for select
  using (
    exists (
      select 1 from public.profiles
      where profiles.id = auth.uid()
        and profiles.role = 'viewer'
        and profiles.parent_user_id = jobs.user_id
    )
  );

-- RLS: clients can read their own viewer profiles
create policy "profiles: read own viewers"
  on public.profiles for select
  using (parent_user_id = auth.uid());

-- RLS: admin full access to profiles (for user management)
drop policy if exists "app_settings: admin" on public.app_settings;
create policy "app_settings: admin"
  on public.app_settings for all
  using (exists (select 1 from public.profiles where id = auth.uid() and role = 'admin'));
