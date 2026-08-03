---
name: competitor-analysis
description: Project knowledge for the self-hosted Supabase competitor-analysis platform (Next.js + Docker + schema-per-client Postgres). Use when working on jobs, the worker pipeline, client schemas, migrations, Docker/Supabase services, deployment, or debugging auth/PostgREST/realtime issues in this repo.
---

# Competitor Analysis Platform

Self-hosted Supabase SaaS: scrapes Google Business Profiles, runs AI competitive analysis, generates Excel/Markdown reports for multi-tenant clients.

## Architecture

Two-database design in one Postgres instance:
- **Admin data** (`public` schema): jobs, users, settings, logs, schedules, notifications.
- **Client data** (one schema per client, e.g. `client_4ecc33f9`): branches, reviews, analytics.

supabase-js routes queries via the `db: { schema }` option — no query rewriting anywhere.

Next.js app (`:3000`) + separate worker process. Docker stack fronted by Kong (`:8000`).

## Tech Stack

Next.js 14.2 App Router + React + Recharts · PostgreSQL 15.6 (self-hosted Supabase) · GoTrue 2.158 auth · Kong 2.8 → PostgREST 12.2 · Supabase Storage 1.10 · Puppeteer 22 + Google Places API + Apify · Anthropic Claude · xlsx (SheetJS) 0.18 · Resend email · Docker Compose (9 services).

## Project Structure

```
app/(authenticated)/   admin/ connect-database/ dashboard/ jobs/[id]/ schedules/
app/api/               jobs/ client-db/ branches/ schedules/ admin/ auth/
lib/                   client-db.ts  provision-client-schema.ts  job-runner.ts  supabase.ts
worker/index.ts        job queue poller (single instance only)
supabase/migrations/           admin schema (001-006)
supabase/client-migrations/    client schema (002-004)
supabase/client-schema.sql     base client schema — 6 tables + 3 views
docker/docker-compose.yml      9-service stack
docker/scripts/                setup.sh  deploy-server.sh  generate-keys.sh  migrate-all.mjs
docker/volumes/api/kong.yml    gateway routing
docker/dumps/                  pg_dump files (gitignored)
```

## Docker Services

| Service | Image | Port | Role |
|---------|-------|------|------|
| db | supabase/postgres:15.6.1.143 | 54322 | PostgreSQL |
| kong | kong:2.8.1 | 8000 | API gateway (public URL) |
| auth | supabase/gotrue:v2.158.1 | 9999 | Signup, login, JWT |
| rest | postgrest/postgrest:v12.2.3 | 3000 | Auto REST from Postgres |
| realtime | supabase/realtime:v2.30.34 | 4000 | WebSocket subscriptions |
| storage | supabase/storage-api:v1.10.1 | 5000 | File upload/download |
| studio | supabase/studio:20240729 | 3001 | Admin table browser |
| meta | supabase/postgres-meta:v0.83.2 | 8080 | DB metadata API |
| imgproxy | darthsim/imgproxy:v3.8.0 | 5001 | Image transformation |

Container names follow `docker-<service>-1` (e.g. `docker-db-1`).

## Local Dev Setup

Prereqs: Docker Desktop, Node 18+, Git. Windows → WSL2 or Git Bash (Docker Desktop needs WSL2 backend).

```bash
git clone https://github.com/amnayounuss/competitor-analysis.git
cd competitor-analysis && git checkout self-hosted-docker

cd docker && bash scripts/setup.sh   # generates .env, starts 9 services, migrations, storage bucket

cd .. && cp .env.local.example .env  # paste keys printed by setup.sh
npm install
npm run dev      # Next.js :3000
npm run worker   # worker, separate terminal
```

## Admin Schema (`public`)

| Table | PK | Purpose |
|-------|-----|---------|
| profiles | id (= auth.users.id) | User metadata; auto-created by signup trigger. `role` = 'admin' \| 'client'. |
| app_settings | id (always 1) | Singleton: GMB OAuth, SMTP, worker settings, signup toggle. |
| client_databases | user_id | Per-client connection. Key column: `schema_name`. |
| jobs | id (uuid) | Queue. queued → running → succeeded/failed/cancelled. |
| job_logs | id (bigserial) | Per-job log lines, streamed to UI via Realtime. |
| schedules | id (uuid) | Recurring monthly jobs (`day_of_month`, `next_run_at`). |
| notifications | id (bigserial) | In-app notifications. |

Migrations: `001_admin_schema` (base tables, RLS, triggers, realtime publication) · `002_admin_jobs_dates` (date_start, date_end, search_location) · `003_smtp_config` · `004_viewer_role` (viewer role + parent_user_id) · `005_anthropic_key` (per-client key) · `006_self_hosted` (schema_name column + `exec_sql()` RPC).

## Client Schema (per client)

| Table | Key columns | Purpose |
|-------|------------|---------|
| branches | job_id, place_id, brand, branch_name, store_name, stars, reviews_count, is_target | Target + competitor locations |
| reviews | branch_id (FK), brand, rating, text, reviewer_name, published_at | Individual reviews |
| analyses | job_id, brand, branch_count, avg_rating_period, star distribution | Per-brand summary stats |
| reports | job_id (unique), target_brand, excel_url, report_md_url | Generated file links |
| job_history | job_id (PK), target_brand, status, branches_total, reviews_total | Mirror of admin jobs for client dashboard |
| branch_analytics | job_id, branch_id, metrics, popular_times_grid (jsonb) | Mirrors Excel "Branch Wise Data" sheet |

Views: `branch_rankings` (rank by avg_rating + review count per job) · `popular_times_detail` (flattens 7×24 grid to one row per branch×day) · `job_summary` (per-job rollup).

Client migrations: `002_branch_analytics` (table + 3 views) · `003_store_name` · `004_branch_analytics_place_id` (dashboard dedups branches by `place_id`).

## Schema-per-Client Isolation

1. Signup → `provisionClientSchema(userId)`
2. Schema name = `client_` + first 8 chars of UUID, dashes removed
3. `exec_sql()` RPC: CREATE SCHEMA → tables → grants
4. `NOTIFY pgrst, 'reload config'` exposes the schema
5. `client_databases.schema_name` updated

```typescript
// lib/client-db.ts
const client = createClient(SUPABASE_URL, SERVICE_ROLE_KEY, {
  db: { schema: creds.schema_name },  // 'client_4ecc33f9'
});
client.from('branches').select('*')   // → SELECT * FROM client_4ecc33f9.branches
```

Zero query changes needed anywhere. `lib/client-db.ts` is dual-mode: self-hosted schema OR legacy cloud.

## API Routes

| Route | Methods | Purpose |
|-------|---------|---------|
| `/api/jobs` | GET, POST | List / create job |
| `/api/jobs/[id]` | GET | Detail + logs |
| `/api/jobs/[id]/cancel` | POST | Cancel running job |
| `/api/jobs/[id]/resend-email` | POST | Re-send report email |
| `/api/jobs/ai-summary` | POST | AI summary of results |
| `/api/client-db` | POST, PUT | Provision schema / test connection |
| `/api/branches` | GET | Query client branches |
| `/api/schedules` | GET, POST | List / create scheduled jobs |
| `/api/notifications` | GET | User notifications |
| `/api/team` | GET, POST | Manage viewers |
| `/api/admin/settings` | GET, PUT | Settings singleton |
| `/api/admin/users` | GET | All users (admin only) |
| `/api/admin/stats` | GET | System stats (admin only) |
| `/api/admin/test-email` | POST | Send SMTP/Resend test email |
| `/api/auth/callback` | GET | OAuth callback (GMB + Gmail) |
| `/api/auth/signout` | POST | Clear session |
| `/api/data-check` | GET | Verify client-schema data integrity |
| `/api/setup` | POST | First-run bootstrap |

## Job Pipeline — `lib/job-runner.ts`

Runs in the worker process (`npm run worker`).

| Stage | What happens | Source |
|-------|-------------|--------|
| A | Fetch target brand branches | GMB API (3 retries) → Puppeteer fallback |
| B | Enrich target branch ratings | Places API → Puppeteer fallback |
| C | Discover competitor branches | Places API → Puppeteer feed-scroll |
| AI | Verify competitors, drop false positives | Claude chain verification per brand |
| C2 | Competitor reviews, star distribution, popular times | Apify (date-windowed) |
| D | Popular times | Apify → Puppeteer hover fallback |
| E | Analyze, build Excel/Markdown, AI branch naming | Claude for name parsing |
| F | Push branches/reviews/analytics to client DB | client schema via PostgREST |
| G | Upload files | Storage `reports` bucket, path `schema/jobId/file` |
| H | Record report, email, mirror job_history | admin DB + Resend |

Worker polls `public.jobs` for `status = 'queued'` ordered by `queued_at`, one job at a time.

## How To: Add a Table

**Admin table (`public`)** — create `supabase/migrations/007_your_feature.sql` with a `public.`-prefixed CREATE TABLE, RLS enabled + policy, then:
```bash
docker exec -i docker-db-1 psql -U supabase_admin -d postgres < supabase/migrations/007_your_feature.sql
```

**Client table** — three places must stay in sync:
1. Add CREATE TABLE to `supabase/client-schema.sql` (bare table name, no prefix)
2. Create `supabase/client-migrations/004_your_feature.sql`
3. Register in `lib/provision-client-schema.ts`:
```typescript
const CLIENT_MIGRATIONS = [
  '002_branch_analytics.sql',
  '003_store_name.sql',
  '004_your_feature.sql',  // add here
];
```
4. Apply to existing schemas:
```bash
for schema in client_4ecc33f9 client_4ab678b7 client_1a36f301; do
  docker exec -i docker-db-1 psql -U supabase_admin -d postgres \
    -c "SET search_path TO ${schema};" \
    -f supabase/client-migrations/004_your_feature.sql
done
```

Client SQL uses bare table names — they resolve via `search_path`. Always `IF NOT EXISTS` / `IF EXISTS` for idempotency.

## How To: New Client Flow

Signup → `handle_new_user()` trigger creates profile → user visits `/connect-database` → `POST /api/client-db` → `provisionClientSchema(userId)` → schema + tables + views + indexes → PostgREST hot-reload → `client_databases` row saved → jobs now write to the isolated schema. No cloud Supabase involved; `supabase_url`/`service_role_key` point at the local/server instance.

## Environment Variables

App `.env`: `NEXT_PUBLIC_SUPABASE_URL` (http://localhost:8000) · `NEXT_PUBLIC_SUPABASE_ANON_KEY` · `SUPABASE_SERVICE_ROLE_KEY` · `ANTHROPIC_API_KEY` · `RESEND_API_KEY`

`docker/.env`: `POSTGRES_PASSWORD` · `JWT_SECRET` · `ANON_KEY` · `SERVICE_ROLE_KEY` (all auto-generated) · `API_EXTERNAL_URL` · `SITE_URL` · `POSTGRES_PORT` (54322) · `STUDIO_PORT` (3001)

## Server Deployment

```bash
sudo apt-get install -y docker-ce docker-ce-cli containerd.io docker-buildx-plugin docker-compose-plugin
sudo usermod -aG docker $USER && newgrp docker
git clone https://github.com/amnayounuss/competitor-analysis.git
cd competitor-analysis && git checkout self-hosted-docker
# scp docker/dumps/full_dump.sql from local first
cd docker && bash scripts/deploy-server.sh
```

Sync local → server (dump includes every `client_%` schema):
```bash
docker exec docker-db-1 pg_dump -U supabase_admin -d postgres --no-owner --no-acl \
  -n public -n auth -n storage -n extensions -n realtime \
  $(docker exec docker-db-1 psql -U supabase_admin -d postgres -tAc \
    "SELECT '-n ' || schema_name FROM information_schema.schemata WHERE schema_name LIKE 'client_%'" \
    | tr '\n' ' ') > docker/dumps/full_dump.sql

scp docker/dumps/full_dump.sql user@server:/path/docker/dumps/
# on server:
docker exec -i docker-db-1 psql -U supabase_admin -d postgres < docker/dumps/full_dump.sql
```

## Known Gotchas

**Auth password mismatch.** The Supabase Postgres image sets service-role passwords at build time; auth/storage/realtime may fail to connect on first boot (check `docker logs docker-auth-1`). `setup.sh` handles this, but manually:
```bash
PG_PASS=$(grep "^POSTGRES_PASSWORD=" .env | cut -d= -f2)
docker exec docker-db-1 psql -U supabase_admin -d postgres -c \
  "ALTER ROLE supabase_auth_admin WITH PASSWORD '$PG_PASS';
   ALTER ROLE authenticator WITH PASSWORD '$PG_PASS';
   ALTER ROLE supabase_storage_admin WITH PASSWORD '$PG_PASS';"
docker exec docker-db-1 psql -U supabase_admin -d postgres -c \
  "CREATE SCHEMA IF NOT EXISTS _realtime;
   GRANT ALL ON SCHEMA _realtime TO supabase_admin;"
docker compose restart auth storage realtime && sleep 5 && docker compose restart kong
```

**`_realtime` schema missing.** Realtime needs it: `CREATE SCHEMA IF NOT EXISTS _realtime;`

**Kong YAML template.** Kong uses `eval echo` to substitute env vars in `kong.yml`. Never put shell-special characters (`*`, `://`, `->`) in YAML comment fields — they get executed.

**Snap Docker (Ubuntu).** Stdout is swallowed. Wrap: `script -qc "docker ..." /dev/null 2>&1`.

**PostgREST schema registration.** Manually created schemas need:
```sql
ALTER ROLE authenticator SET pgrst.db_schemas = 'public,...,new_schema';
NOTIFY pgrst, 'reload config';
```
`provisionClientSchema` does this automatically.

**PostgREST schema cache is separate from its config.** `reload config` re-reads settings; foreign keys live in the *schema cache*. Without a `reload schema` the FKs of a newly created schema are missing from the cache, and every embedded select fails:
```
PGRST200: Could not find a relationship between 'branch_analytics' and 'branches'
```
The dashboard and job detail pages both run `.select('*, branches(stars, reviews_count)')`, so the whole query errors, `data` comes back null, and the UI renders job names with **no data** — for every client at once, even where rows exist. The FK is present in Postgres; only the cache is stale. Fix, and what `provisionClientSchema` now emits:
```sql
NOTIFY pgrst, 'reload schema';
```

**Single worker instance.** Multiple workers pick up the same queued jobs. PM2 with `instances: 1` in production.

**`NEXT_PUBLIC_*` is inlined at build time — even in server components.** `lib/supabase.ts` reads `process.env.NEXT_PUBLIC_SUPABASE_URL`, so after changing `.env` a `pm2 restart` is **not** enough: the old value stays compiled into `.next`, including `middleware.js` and API routes. Symptom of a stale build pointing at the previous Supabase: login succeeds against the wrong project, and the dashboard shows "Database Not Connected" while the DB is fine. Always `npm run build` after touching those vars, then verify:
```bash
grep -rl "<old-project-ref>" .next/server .next/static   # must be empty
```

**Kong gates all of `/storage/v1/` with key-auth.** Public bucket objects still 401 unless a separate keyless service exists. `docker/volumes/api/kong.yml` defines `storage-v1-public` for `/storage/v1/object/public/` with only the `cors` plugin, ahead of `storage-v1`. Kong reads this file at container start (its entrypoint `sed`s the keys in), so edits need `docker compose restart kong`, not a reload.

---

## Cloud → Self-Hosted Migration Gotchas

`docker/scripts/migrate-all.mjs` silently under-migrated on its first real run. All four causes are fixed, but the failure modes are worth knowing since they all reported success.

**Never paginate on a non-unique column.** The original `fetchAll` used `.range(offset, …)` + `.order('created_at')`. Batch-written rows share a timestamp (8995 reviews had **22** distinct `created_at` values), so tied rows came back in a different order per query — pages overlapped, rows in the gaps were never fetched, and the resulting duplicate-key errors were swallowed. ~2500 reviews were lost. Now: keyset pagination on the primary key (`.gt('id', last)`).

**Storage folders have `id: null`.** `storage.list('')` returns prefixes with a null id and real objects with an id. A `if (!folder.id) continue` skipped every job folder, copying **zero** files while printing success. Entries *with* an id are files; entries without are folders to descend into.

**A column present in cloud but missing locally loses the whole table.** Cloud's `branch_analytics` had `place_id`; `client-schema.sql` did not. The 412-row batch was rejected with `column place_id does not exist`, logged one WARN, and moved on. Fixed by `client-migrations/004_branch_analytics_place_id.sql`. When adding a client table, diff the columns both ways before migrating:
```bash
# cloud side
curl -s "$CLOUD/rest/v1/<table>?select=*&limit=1" -H "apikey: $KEY" \
  | python3 -c "import sys,json;print('\n'.join(sorted(json.load(sys.stdin)[0])))"
```

**Report URLs stay pointed at cloud.** Rows copied from cloud carry that project's public storage URLs. Migrating the files is not enough — `reports.excel_url` / `report_md_url` must be rewritten to self-hosted `getPublicUrl` values, or downloads die when cloud is shut off. `migrate-all.mjs` now does this and flags any report it could not repoint.

**Verify by counting both sides, not by reading the log.** The script now collects every shortfall into `PROBLEMS`, prints them at the end, and exits non-zero. Independent audit query:
```sql
SELECT (SELECT count(*) FROM <schema>.reviews)          AS reviews,
       (SELECT count(*) FROM <schema>.branch_analytics) AS analytics,
       (SELECT count(*) FROM storage.objects)           AS files;
```
Then confirm no cloud URLs survive:
```sql
SELECT count(*) FROM <schema>.reports WHERE excel_url LIKE '%supabase.co%';  -- want 0
```

**Password reset after migration.** Users migrated from cloud Supabase have no password hashes (the API migration can't transfer them) — the placeholder `$2a$10$` hashes look valid but match nothing, so every login fails with `invalid_grant`. Either have users reset, or set one directly:
```bash
curl -X PUT "$SELF_URL/auth/v1/admin/users/<user-id>" \
  -H "apikey: $SERVICE_ROLE_KEY" -H "Authorization: Bearer $SERVICE_ROLE_KEY" \
  -H "Content-Type: application/json" -d '{"password":"<new>"}'
```

**`app_settings.setup_completed` does not survive migration as `true`.** `middleware.ts` calls `is_setup_completed()` and redirects everything to `/setup` when it returns false — including `/login`, so existing users cannot get in. Don't run the setup wizard (it creates a new admin and demands GMB creds); just flip the flag:
```sql
UPDATE public.app_settings SET setup_completed = true WHERE id = 1;
```

**Client cloud credentials live in the cloud admin project.** Each client had their own Supabase project; the keys are in cloud `public.client_databases`. Provisioning overwrites that column with the self-hosted URL, so once migrated the cloud keys exist **only** in the old cloud project — grab them before shutting it down. Two clients here shared one cloud project, so a client schema mirroring another's data can be correct rather than a bug: check `client_databases.supabase_url` before "fixing" it.
