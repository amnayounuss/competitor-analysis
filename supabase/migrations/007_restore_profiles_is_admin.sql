-- ============================================================
--  007_restore_profiles_is_admin.sql
--
--  Restores public.profiles.is_admin, which 001_admin_schema.sql declares but
--  which was absent from the live database — most likely lost in the
--  cloud→self-hosted migration, since the API-based copy recreated the table
--  from the columns the cloud project actually returned.
--
--  Around twenty call sites still select it (middleware, the login page, every
--  /api/admin route, lib/user-role.ts), and PostgREST answers a select naming a
--  missing column with a hard 400:
--
--     {"code":"42703","message":"column profiles.is_admin does not exist"}
--
--  On the login page that 400 landed after the credentials had already been
--  accepted: the session cookie was written, then the role lookup failed, so the
--  redirect never ran and the user was left sitting on the login form — or, on
--  pages that render the result, a client-side exception.
--
--  `role` (added in 004_viewer_role.sql) is the newer and richer mechanism —
--  it carries 'viewer' as well — so is_admin is backfilled FROM role rather than
--  the other way round, and the two stay consistent. Code reads role first and
--  falls back to is_admin, so both work after this.
-- ============================================================

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

update public.profiles set is_admin = true  where role = 'admin'    and is_admin is distinct from true;
update public.profiles set is_admin = false where role <> 'admin'   and is_admin is distinct from false;

notify pgrst, 'reload schema';
