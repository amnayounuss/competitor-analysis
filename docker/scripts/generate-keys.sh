#!/usr/bin/env bash
set -euo pipefail

# Generate JWT_SECRET, ANON_KEY, and SERVICE_ROLE_KEY for self-hosted Supabase.
# Usage: ./generate-keys.sh           — prints to stdout
#        ./generate-keys.sh --write   — updates ../docker/.env in place

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
ENV_FILE="$SCRIPT_DIR/../.env"

# Generate a random 64-char hex secret
JWT_SECRET=$(openssl rand -hex 32)

# 10-year expiry (seconds)
EXP=$(( $(date +%s) + 315360000 ))
IAT=$(date +%s)

# Helper: base64url encode (no padding)
b64url() {
  openssl base64 -A | tr '+/' '-_' | tr -d '='
}

# Build JWTs manually (HS256)
make_jwt() {
  local role="$1"
  local header='{"alg":"HS256","typ":"JWT"}'
  local payload="{\"role\":\"${role}\",\"iss\":\"supabase\",\"iat\":${IAT},\"exp\":${EXP}}"

  local h=$(printf '%s' "$header" | b64url)
  local p=$(printf '%s' "$payload" | b64url)
  local sig=$(printf '%s' "${h}.${p}" | openssl dgst -sha256 -hmac "$JWT_SECRET" -binary | b64url)

  echo "${h}.${p}.${sig}"
}

ANON_KEY=$(make_jwt "anon")
SERVICE_ROLE_KEY=$(make_jwt "service_role")

echo "─── Generated Supabase Keys ───"
echo ""
echo "JWT_SECRET=${JWT_SECRET}"
echo ""
echo "ANON_KEY=${ANON_KEY}"
echo ""
echo "SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}"
echo ""

if [[ "${1:-}" == "--write" ]]; then
  if [[ ! -f "$ENV_FILE" ]]; then
    cp "$SCRIPT_DIR/../.env.example" "$ENV_FILE"
  fi

  # Replace in .env file
  sed -i "s|^JWT_SECRET=.*|JWT_SECRET=${JWT_SECRET}|" "$ENV_FILE"
  sed -i "s|^ANON_KEY=.*|ANON_KEY=${ANON_KEY}|" "$ENV_FILE"
  sed -i "s|^SERVICE_ROLE_KEY=.*|SERVICE_ROLE_KEY=${SERVICE_ROLE_KEY}|" "$ENV_FILE"

  echo "Written to ${ENV_FILE}"
fi
