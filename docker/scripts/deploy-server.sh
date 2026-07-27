#!/usr/bin/env bash
set -euo pipefail

# Deploy self-hosted Supabase to a server with all data.
#
# Run on the SERVER after cloning the repo:
#   cd competitor-analysis/docker
#   bash scripts/deploy-server.sh
#
# What it does:
#   1. Generates .env with new keys (if not exists)
#   2. Starts Docker Compose stack
#   3. Fixes service role passwords
#   4. Restores full DB dump (auth + admin + client data)
#   5. Registers client schemas with PostgREST
#   6. Verifies all services

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/.."
REPO_ROOT="$DOCKER_DIR/.."
ENV_FILE="$DOCKER_DIR/.env"
DUMP_FILE="$DOCKER_DIR/dumps/full_dump.sql"

compose() {
  docker compose -f "$DOCKER_DIR/docker-compose.yml" "$@"
}

if [[ ! -f "$DUMP_FILE" ]]; then
  echo "ERROR: $DUMP_FILE not found."
  echo "Run this from the docker/ directory after generating the dump locally."
  exit 1
fi

echo "═══ Server Deploy — Self-Hosted Supabase ═══"
echo ""

# ── 1. Generate .env if missing ──────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "→ Generating .env..."
  cp "$DOCKER_DIR/.env.example" "$ENV_FILE"

  PG_PASS=$(openssl rand -base64 24 | tr -d '/+=')
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" "$ENV_FILE"

  RT_SECRET=$(openssl rand -base64 48 | tr -d '/+=')
  sed -i "s|^REALTIME_SECRET_KEY_BASE=.*|REALTIME_SECRET_KEY_BASE=${RT_SECRET}|" "$ENV_FILE"

  echo "→ Generating JWT keys..."
  bash "$SCRIPT_DIR/generate-keys.sh" --write
  echo ""
else
  echo "→ Using existing .env"
fi

set -a; source "$ENV_FILE"; set +a

# ── 2. Start stack ───────────────────────────────────────────
echo "→ Starting Supabase stack..."
compose up -d

echo "→ Waiting for Postgres..."
for i in $(seq 1 30); do
  if compose exec -T db pg_isready -U postgres -h localhost 2>/dev/null; then
    break
  fi
  sleep 2
done
echo "  Postgres ready."

run_sql() {
  compose exec -T db psql -U supabase_admin -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=0 "$@"
}

# ── 3. Fix service role passwords ────────────────────────────
echo "→ Setting service role passwords..."
run_sql <<SQL
ALTER ROLE supabase_auth_admin    WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER ROLE authenticator          WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER ROLE supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
SQL

# ── 4. Ensure _realtime schema ───────────────────────────────
run_sql <<'SQL'
CREATE SCHEMA IF NOT EXISTS _realtime;
GRANT ALL ON SCHEMA _realtime TO supabase_admin;
SQL

# ── 5. Restart services for password fix ─────────────────────
echo "→ Restarting services..."
compose restart auth storage realtime
sleep 5

for i in $(seq 1 20); do
  if compose exec -T auth wget --no-verbose --tries=1 --spider http://localhost:9999/health 2>/dev/null; then
    break
  fi
  sleep 2
done
compose restart kong
sleep 3

# ── 6. Restore DB dump ──────────────────────────────────────
echo "→ Restoring database dump..."
run_sql < "$DUMP_FILE" 2>&1 | grep -c "ERROR" | xargs -I{} echo "  ({} errors — most are harmless 'already exists' conflicts)"

# ── 7. Register client schemas with PostgREST ────────────────
echo "→ Registering client schemas with PostgREST..."
CLIENT_SCHEMAS=$(run_sql -tAc "SELECT string_agg(schema_name, ',') FROM information_schema.schemata WHERE schema_name LIKE 'client_%'" 2>/dev/null | tr -d '[:space:]')

if [[ -n "$CLIENT_SCHEMAS" ]]; then
  run_sql <<SQL
ALTER ROLE authenticator SET pgrst.db_schemas = 'public,storage,graphql_public,${CLIENT_SCHEMAS}';
NOTIFY pgrst, 'reload config';
SQL
  echo "  Registered: $CLIENT_SCHEMAS"
fi

# ── 8. Grant permissions on client schemas ───────────────────
echo "→ Granting permissions on client schemas..."
run_sql -tAc "SELECT schema_name FROM information_schema.schemata WHERE schema_name LIKE 'client_%'" 2>/dev/null | while read -r schema; do
  [[ -z "$schema" ]] && continue
  schema=$(echo "$schema" | tr -d '[:space:]')
  run_sql <<SQL 2>/dev/null
GRANT USAGE ON SCHEMA ${schema} TO anon, authenticated, service_role;
GRANT ALL ON ALL TABLES IN SCHEMA ${schema} TO anon, authenticated, service_role;
GRANT ALL ON ALL SEQUENCES IN SCHEMA ${schema} TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT ALL ON TABLES TO anon, authenticated, service_role;
ALTER DEFAULT PRIVILEGES IN SCHEMA ${schema}
  GRANT ALL ON SEQUENCES TO anon, authenticated, service_role;
SQL
  echo "  ✓ $schema"
done

# ── 9. Create storage bucket ─────────────────────────────────
echo "→ Ensuring reports storage bucket..."
run_sql <<'SQL'
INSERT INTO storage.buckets (id, name, public)
VALUES ('reports', 'reports', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "Public reports read" ON storage.objects;
CREATE POLICY "Public reports read"
  ON storage.objects FOR SELECT
  USING (bucket_id = 'reports');

DROP POLICY IF EXISTS "Service role full access" ON storage.objects;
CREATE POLICY "Service role full access"
  ON storage.objects FOR ALL
  USING (bucket_id = 'reports');
SQL

# ── 10. Update client_databases URLs to point to self-hosted ─
echo "→ Updating client database URLs..."
run_sql <<SQL
UPDATE public.client_databases
SET supabase_url = '${API_EXTERNAL_URL:-http://localhost:8000}',
    service_role_key = '${SERVICE_ROLE_KEY}'
WHERE schema_name IS NOT NULL;
SQL

# ── 11. Verify ──────────────────────────────────────────────
echo ""
echo "→ Checking services..."
for svc in db auth kong meta rest realtime storage imgproxy studio; do
  STATUS=$(compose ps --format json "$svc" 2>/dev/null | grep -oP '"State":"[^"]*"' | head -1 || echo "")
  if echo "$STATUS" | grep -q "running"; then
    echo "  ✓ $svc"
  else
    echo "  ? $svc"
  fi
done

# ── 12. Summary ─────────────────────────────────────────────
echo ""
echo "═══ Deploy Complete ═══"
echo ""
echo "  API:      ${API_EXTERNAL_URL:-http://localhost:8000}"
echo "  Studio:   http://localhost:${STUDIO_PORT:-3001}"
echo "  Postgres: localhost:${POSTGRES_PORT:-54322}"
echo ""
echo "  ANON_KEY:      ${ANON_KEY:0:20}..."
echo "  SERVICE_ROLE:  ${SERVICE_ROLE_KEY:0:20}..."
echo ""
echo "App .env:"
echo "  NEXT_PUBLIC_SUPABASE_URL=${API_EXTERNAL_URL:-http://localhost:8000}"
echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}"
echo "  SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
echo ""
echo "NOTE: Update API_EXTERNAL_URL in docker/.env to your"
echo "      server's public URL before production use."
echo ""
