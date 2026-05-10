# Anoosh Analysis SaaS — BYO Supabase Edition

Multi-tenant Google Reviews analysis where **each client connects their own Supabase**. You only host the app.

---

## Architecture

```
┌──────────────────────┐     ┌──────────────────────────────┐
│  Your Supabase       │     │  Each client's Supabase      │
│  (operational)       │     │  (their business data)       │
│                      │     │                              │
│  • profiles          │     │  • branches                  │
│  • app_settings      │     │  • reviews                   │
│  • client_databases  │ ──▶ │  • analyses                  │
│  • jobs (queue)      │     │  • reports                   │
│  • job_logs          │     │  • job_history               │
│  • schedules         │     │  • storage bucket: reports   │
│  • notifications     │     │                              │
└──────────────────────┘     └──────────────────────────────┘
        ▲                                ▲
        │                                │
        │      ┌─────────────────┐       │
        └──────│  Worker process │───────┘
               │  (single proc)  │
               └─────────────────┘
                       │
                       ▼
                  Gmail SMTP
                  (your account)
```

---

## How users experience it

### Day 1 — Onboarding (one time, ~10 min)
1. Sign up at your app
2. Auto-redirected to **`/connect-database`**
3. Open Supabase, create a project
4. Visit `/connect-database/schema` — copy the SQL
5. Paste in Supabase SQL editor → Run (creates tables + storage bucket)
6. Get URL + service key from Settings → API
7. Paste in form → "Test connection" → "Save"

### Day 1+ — Every analysis (1 min)
1. Go to `/dashboard`
2. Fill form: target, competitors, refresh token, email
3. Optionally tick **"Run monthly"** — system auto-creates a schedule
4. Submit → live progress → email arrives + data in their Supabase

### Monthly auto-runs
- Scheduler scans every 60s
- On the 1st of each month at 9 AM UTC, due schedules become jobs
- Same flow as manual jobs, all transparent

---

## Setup (you, the operator)

### 1. Create your admin Supabase
- supabase.com → New project
- SQL Editor → paste `supabase/migrations/001_admin_schema.sql` → Run
- Settings → API → copy URL + anon key + service key

### 2. Set 3 env vars
```bash
NEXT_PUBLIC_SUPABASE_URL=https://YOUR_ADMIN.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=eyJ...
SUPABASE_SERVICE_ROLE_KEY=eyJ...
```

### 3. Install + run
```bash
npm install
npm run dev          # web
npm run worker       # worker + scheduler (separate terminal)
```

### 4. First-time wizard
Open `http://localhost:3000` → auto-redirect to `/setup`:
- Step 1: create your admin user account
- Step 2: Gmail App Password
- Step 3: Google OAuth credentials
- Step 4: preferences → Finish

### 5. Login as admin → done
You can now manage everything from `/admin`. Clients can sign up at `/signup`.

---

## Key components

### `lib/client-db.ts`
Connects to a client's Supabase on demand using their saved credentials.
- `getClientDbCreds(userId)` — fetch from admin DB
- `clientDbClient(creds)` — build Supabase client
- `testClientDb(creds)` — validates URL+key+schema

### `lib/job-runner.ts`
The dual-DB orchestrator:
1. Validate client DB connection
2. Run scrapers (your existing JS, untouched)
3. Push branches/reviews/analyses → **client DB**
4. Upload Excel + Markdown → **client Storage bucket**
5. Send Gmail with attachments
6. Update jobs row + insert notification → admin DB

### `lib/scheduler.ts`
Polls schedules table every 60s, creates jobs from due rows, advances `next_run_at` to next month.

### `lib/notifications.ts`
Helper to insert in-app notifications. Shown in the bell icon header.

---

## Routes

### Public
- `/setup` — one-time admin wizard (locked after completion)
- `/login`, `/signup`

### Auth-required (clients)
- `/connect-database` — onboarding form
- `/connect-database/schema` — SQL to copy
- `/dashboard` — submit jobs + history (blocks until DB connected)
- `/jobs/[id]` — live progress
- `/schedules` — manage monthly schedules

### Admin only
- `/admin` — Gmail/OAuth/users/worker tabs

### API
- `POST /api/client-db/test` — validate without saving
- `PUT  /api/client-db` — save creds (validates first)
- `GET  /api/client-db` — current connection status
- `POST /api/jobs` — submit (blocks if DB not connected)
- `GET  /api/jobs` — list user's jobs
- `POST /api/schedules` — create monthly schedule
- `DELETE /api/schedules?id=...` — remove
- `GET  /api/notifications` — list
- `PATCH /api/notifications` — mark read

---

## What goes where

### Admin DB (yours)
- Auth (`auth.users`, `profiles`)
- Your operational settings (`app_settings`)
- Client DB credentials (`client_databases`)
- Job queue + status (`jobs`)
- Live logs (`job_logs`) — kept here so you can debug failed jobs
- Schedules (`schedules`)
- Notifications (`notifications`)

### Client DB (theirs)
- Scraped branch data (`branches`)
- Scraped reviews (`reviews`)
- Computed analyses (`analyses`)
- Report file URLs (`reports`)
- Per-job summary mirror (`job_history`)
- Excel + Markdown files (Storage bucket `reports`)

### Email
- Sent from your single Gmail (App Password)
- Attaches Excel + Markdown
- Triggers a notification in admin DB → realtime bell icon

---

## Notification kinds

| Kind | When |
|------|------|
| `job_started` | Worker claims the job |
| `job_succeeded` | All stages done |
| `job_failed` | Any fatal error |
| `email_sent` | Gmail delivery confirmed |

Bell icon shows unread count, click → dropdown → click any → opens job page.

---

## Common operations

| Need to... | How |
|------------|-----|
| Reconnect client DB | `/connect-database` (overwrites previous) |
| Disable a schedule | `/schedules` → delete |
| Mark notifications read | Click bell → "Mark all read" |
| Change Gmail | `/admin` → Gmail tab |
| Add admin | `/admin` → Users → "+ Add user" with admin checkbox |
| Reset client DB validation | `/connect-database` → Test connection again |

---

## Troubleshooting

**"Client DB unreachable"** at job start
→ Check client's Supabase isn't paused (free tier pauses after 1 week of inactivity). They can wake it from their dashboard, then "Test connection" again.

**"Schema not ready"**
→ Client didn't run `client-schema.sql`. Send them to `/connect-database/schema`.

**"Service role key was rejected"**
→ Client pasted the anon key instead of service_role. Service role is at the bottom of Settings → API.

**Schedules not running**
→ Worker process isn't running. `npm run worker` must be a separate process from `npm run dev`.

**File upload to client storage fails**
→ Storage bucket `reports` doesn't exist. The schema SQL creates it; if removed, run schema again.

---

## File structure

```
app/
├── connect-database/         (BYO onboarding)
│   ├── page.tsx
│   ├── connect-form.tsx
│   └── schema/page.tsx       (one-click copy SQL)
├── schedules/                (monthly schedule manager)
├── dashboard/
│   ├── new-job-form.tsx      (with "Run monthly" toggle)
│   └── notification-bell.tsx (realtime unread count)
├── api/
│   ├── client-db/route.ts    (test + save)
│   ├── schedules/route.ts
│   ├── notifications/route.ts
│   └── jobs/...              (existing, requires client DB)
└── ...

lib/
├── client-db.ts              ⭐ per-client Supabase factory
├── job-runner.ts             ⭐ dual-DB orchestrator
├── scheduler.ts              ⭐ monthly auto-trigger
├── notifications.ts          (in-app alerts)
└── ...

supabase/
├── migrations/001_admin_schema.sql    (yours)
└── client-schema.sql                  (each client runs this)

worker/index.ts               (worker loop + scheduler in same process)
```
