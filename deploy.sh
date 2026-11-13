#!/usr/bin/env bash
# One-time setup and deploy for the Companimal social listening Worker.
# Needs: wrangler logged in (or CLOUDFLARE_API_TOKEN + CLOUDFLARE_ACCOUNT_ID set),
# and these env vars for secrets: DATAFORSEO_LOGIN, DATAFORSEO_PASSWORD, YOUTUBE_API_KEY, DASHBOARD_PASSWORD
set -euo pipefail
cd "$(dirname "$0")"
DB=companimal-social-listening
BUCKET=companimal-social-listening-archive

npm install --silent

# 1. D1 database (create once, patch its id into wrangler.toml)
if grep -q REPLACE_WITH_D1_ID wrangler.toml; then
  ID=$(npx wrangler d1 create "$DB" 2>&1 | grep -oE '[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}' | head -1 || true)
  if [ -z "$ID" ]; then ID=$(npx wrangler d1 info "$DB" --json | grep -oE '"uuid": *"[^"]+"' | grep -oE '[0-9a-f-]{36}'); fi
  sed -i.bak "s/REPLACE_WITH_D1_ID/$ID/" wrangler.toml && rm -f wrangler.toml.bak
  echo "D1 database id: $ID"
fi
npx wrangler d1 migrations apply "$DB" --remote

# 2. R2 archive, with raw posts expiring after 730 days (rollups and questions are kept in D1)
npx wrangler r2 bucket create "$BUCKET" 2>/dev/null || echo "R2 bucket exists"
npx wrangler r2 bucket lifecycle add "$BUCKET" expire-raw raw/ --expire-days 730 --force 2>/dev/null || echo "Lifecycle rule exists or needs setting in the dashboard"

# 3. Secrets
for S in DATAFORSEO_LOGIN DATAFORSEO_PASSWORD YOUTUBE_API_KEY SERPENT_API_KEY DASHBOARD_PASSWORD; do
  if [ -n "${!S:-}" ]; then printf '%s' "${!S}" | npx wrangler secret put "$S"; else echo "Skipping $S (not set)"; fi
done
openssl rand -hex 16 | npx wrangler secret put HASH_SALT

# 4. Deploy
npx wrangler deploy
echo "Deployed. Trigger the first run with:"
echo "  curl -u x:\$DASHBOARD_PASSWORD -X POST https://<worker-url>/api/run?job=sitemap"
echo "  curl -u x:\$DASHBOARD_PASSWORD -X POST https://<worker-url>/api/run?job=collect"
echo "  curl -u x:\$DASHBOARD_PASSWORD -X POST https://<worker-url>/api/run?job=paa"
