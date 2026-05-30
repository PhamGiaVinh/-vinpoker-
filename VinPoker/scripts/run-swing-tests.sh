#!/bin/bash
# Run swing integration tests with auto-rotating credentials.
# Usage: ./scripts/run-swing-tests.sh

set -euo pipefail

echo "🔑 Getting fresh DB credentials..."
PGPASSWORD=$(supabase db dump --linked --data-only --dry-run --schema public --file /dev/null 2>&1 | grep -oP '(?<=PGPASSWORD=")[^"]+')

echo "🔑 Getting service role key..."
SERVICE_KEY_JSON=$(supabase secrets list --output json 2>/dev/null || echo "")
SERVICE_KEY=$(echo "$SERVICE_KEY_JSON" | grep -oP '"SUPABASE_SERVICE_ROLE_KEY"\s*:\s*"\K[^"]+' || echo "")

echo "🌱 Seeding test data..."
supabase db query --linked --file scripts/seed-swing-test-data.sql > /dev/null 2>&1

echo "🧪 Running tests..."
# Update password inline, then run
sed -i "s/password: \".*\"/password: \"$PGPASSWORD\"/" scripts/run-swing-tests.mjs
SUPABASE_SERVICE_ROLE_KEY="$SERVICE_KEY" node scripts/run-swing-tests.mjs

echo "✅ Done"
