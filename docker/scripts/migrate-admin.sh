#!/usr/bin/env bash
set -euo pipefail

# Migrate admin DB + auth users from Supabase Cloud to self-hosted.
#
# Usage:
#   export CLOUD_DB_URL="postgresql://postgres:[password]@db.[ref].supabase.co:5432/postgres"
#   export SELF_HOSTED_DB_URL="postgresql://supabase_admin:[password]@localhost:5432/postgres"
#   bash docker/scripts/migrate-admin.sh

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DUMP_DIR="$SCRIPT_DIR/../dumps"
mkdir -p "$DUMP_DIR"

if [[ -z "${CLOUD_DB_URL:-}" || -z "${SELF_HOSTED_DB_URL:-}" ]]; then
  echo "ERROR: Set CLOUD_DB_URL and SELF_HOSTED_DB_URL environment variables."
  echo ""
  echo "  export CLOUD_DB_URL='postgresql://postgres:PASSWORD@db.XXXXX.supabase.co:5432/postgres'"
  echo "  export SELF_HOSTED_DB_URL='postgresql://supabase_admin:PASSWORD@localhost:5432/postgres'"
  exit 1
fi

echo "═══ Admin DB Migration ═══"
echo ""

# ── 1. Dump admin tables ────────────────────────────────────
echo "→ Dumping admin tables from cloud..."
pg_dump --no-owner --no-acl --data-only \
  -t public.profiles \
  -t public.app_settings \
  -t public.client_databases \
  -t public.jobs \
  -t public.job_logs \
  -t public.schedules \
  -t public.notifications \
  "$CLOUD_DB_URL" > "$DUMP_DIR/admin_data.sql"
echo "  Saved to dumps/admin_data.sql"

# ── 2. Dump auth schema ─────────────────────────────────────
echo "→ Dumping auth users from cloud..."
pg_dump --no-owner --no-acl --data-only \
  -t auth.users \
  -t auth.identities \
  -t auth.sessions \
  -t auth.refresh_tokens \
  -t auth.mfa_factors \
  -t auth.mfa_challenges \
  "$CLOUD_DB_URL" > "$DUMP_DIR/auth_data.sql" 2>/dev/null || \
pg_dump --no-owner --no-acl --data-only \
  -t auth.users \
  -t auth.identities \
  "$CLOUD_DB_URL" > "$DUMP_DIR/auth_data.sql"
echo "  Saved to dumps/auth_data.sql"

# ── 3. Restore into self-hosted ──────────────────────────────
echo "→ Restoring admin data into self-hosted..."
psql "$SELF_HOSTED_DB_URL" -v ON_ERROR_STOP=0 < "$DUMP_DIR/admin_data.sql" 2>&1 | grep -v "already exists" || true
echo "  Admin data restored."

echo "→ Restoring auth data into self-hosted..."
psql "$SELF_HOSTED_DB_URL" -v ON_ERROR_STOP=0 < "$DUMP_DIR/auth_data.sql" 2>&1 | grep -v "already exists" || true
echo "  Auth data restored."

echo ""
echo "═══ Admin migration complete ═══"
echo ""
echo "Note: Users will need to re-login (JWT_SECRET changed)."
echo "      Passwords are bcrypt-hashed — they work as-is."
echo ""
echo "Next: run migrate-clients.mjs to migrate client data."
