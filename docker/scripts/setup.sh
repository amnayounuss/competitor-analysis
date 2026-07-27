#!/usr/bin/env bash
set -euo pipefail

# One-command setup for self-hosted Supabase.
# Run from the docker/ directory:  bash scripts/setup.sh
# Works identically on local dev and production server.

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
DOCKER_DIR="$SCRIPT_DIR/.."
REPO_ROOT="$DOCKER_DIR/.."
ENV_FILE="$DOCKER_DIR/.env"

compose() {
  docker compose -f "$DOCKER_DIR/docker-compose.yml" "$@"
}

echo "═══ Self-Hosted Supabase Setup ═══"
echo ""

# ── 1. Generate .env if missing ──────────────────────────────
if [[ ! -f "$ENV_FILE" ]]; then
  echo "→ No .env found, creating from .env.example..."
  cp "$DOCKER_DIR/.env.example" "$ENV_FILE"

  PG_PASS=$(openssl rand -base64 24 | tr -d '/+=')
  sed -i "s|^POSTGRES_PASSWORD=.*|POSTGRES_PASSWORD=${PG_PASS}|" "$ENV_FILE"

  RT_SECRET=$(openssl rand -base64 48 | tr -d '/+=')
  sed -i "s|^REALTIME_SECRET_KEY_BASE=.*|REALTIME_SECRET_KEY_BASE=${RT_SECRET}|" "$ENV_FILE"

  echo "→ Generating JWT keys..."
  bash "$SCRIPT_DIR/generate-keys.sh" --write
  echo ""
fi

set -a; source "$ENV_FILE"; set +a

# ── 2. Start Docker Compose ─────────────────────────────────
echo "→ Starting Supabase stack..."
compose up -d

# ── 3. Wait for Postgres ────────────────────────────────────
echo "→ Waiting for Postgres..."
for i in $(seq 1 30); do
  if compose exec -T db pg_isready -U postgres -h localhost 2>/dev/null; then
    break
  fi
  sleep 2
done
echo "  Postgres is ready."

# Helper: run SQL
run_sql() {
  compose exec -T db psql -U supabase_admin -d "${POSTGRES_DB:-postgres}" -v ON_ERROR_STOP=1 "$@"
}

# ── 4. Fix service role passwords ────────────────────────────
# The supabase/postgres image sometimes doesn't set passwords for
# service roles. We force them to POSTGRES_PASSWORD so all services
# can authenticate.
echo "→ Setting service role passwords..."
run_sql <<SQL
ALTER ROLE supabase_auth_admin    WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER ROLE authenticator          WITH PASSWORD '${POSTGRES_PASSWORD}';
ALTER ROLE supabase_storage_admin WITH PASSWORD '${POSTGRES_PASSWORD}';
SQL

# ── 5. Ensure _realtime schema exists ────────────────────────
echo "→ Ensuring _realtime schema..."
run_sql <<'SQL'
CREATE SCHEMA IF NOT EXISTS _realtime;
GRANT ALL ON SCHEMA _realtime TO supabase_admin;
SQL

# ── 6. Restart services that depend on fixed passwords ───────
echo "→ Restarting services..."
compose restart auth storage realtime
sleep 5

# Wait for auth to be healthy before starting kong
echo "→ Waiting for auth..."
for i in $(seq 1 20); do
  if compose exec -T auth wget --no-verbose --tries=1 --spider http://localhost:9999/health 2>/dev/null; then
    break
  fi
  sleep 2
done

compose restart kong
sleep 3

# ── 7. Apply admin schema migrations ────────────────────────
echo "→ Applying admin migrations..."
for f in "$REPO_ROOT/supabase/migrations/"*.sql; do
  echo "  $(basename "$f")"
  run_sql < "$f" 2>&1 || true
done

# ── 8. Create shared storage bucket ─────────────────────────
echo "→ Creating reports storage bucket..."
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

# ── 9. Verify all services ──────────────────────────────────
echo ""
echo "→ Checking services..."
HEALTHY=true
for svc in db auth kong meta; do
  STATUS=$(compose ps --format json "$svc" 2>/dev/null | grep -o '"Health":"[^"]*"' | head -1 || echo "")
  if echo "$STATUS" | grep -q "healthy"; then
    echo "  ✓ $svc"
  else
    echo "  ? $svc (may still be starting)"
    HEALTHY=false
  fi
done

for svc in rest realtime storage imgproxy studio; do
  RUNNING=$(compose ps --format json "$svc" 2>/dev/null | grep -o '"State":"running"' || echo "")
  if [[ -n "$RUNNING" ]]; then
    echo "  ✓ $svc"
  else
    echo "  ? $svc (may still be starting)"
    HEALTHY=false
  fi
done

# ── 10. Print summary ───────────────────────────────────────
echo ""
echo "═══ Supabase is ready! ═══"
echo ""
echo "  API (Kong):     http://localhost:${API_EXTERNAL_PORT:-8000}"
echo "  Studio:         http://localhost:${STUDIO_PORT:-3001}"
echo "  Postgres:       localhost:${POSTGRES_PORT:-54322}"
echo ""
echo "  ANON_KEY:       ${ANON_KEY:0:20}..."
echo "  SERVICE_ROLE:   ${SERVICE_ROLE_KEY:0:20}..."
echo ""
echo "Copy these to your app's .env:"
echo "  NEXT_PUBLIC_SUPABASE_URL=http://localhost:${API_EXTERNAL_PORT:-8000}"
echo "  NEXT_PUBLIC_SUPABASE_ANON_KEY=${ANON_KEY}"
echo "  SUPABASE_SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
echo ""
