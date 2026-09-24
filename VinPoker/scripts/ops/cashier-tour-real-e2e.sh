#!/usr/bin/env bash
set -euo pipefail
repo_root="$(pwd)"
schema_dir="${SCHEMA_ARTIFACT_DIRECTORY:-}"
if [[ -z "$schema_dir" || ! -f "$schema_dir/live-public-schema.sql" ||
      ! -f "$schema_dir/live-public-schema.sha256" ]]; then
  echo "Verified schema-only baseline artifact is required" >&2
  exit 1
fi
(cd "$schema_dir" && sha256sum --check --status live-public-schema.sha256)

# This job has no production secrets or linked project. No application SQL or
# handler is loaded until the outbound-network proof succeeds.
for forbidden in SUPABASE_ACCESS_TOKEN SUPABASE_DB_PASSWORD SEPAY_RECONCILE_SECRET VERCEL_TOKEN; do
  if [[ -n "${!forbidden:-}" ]]; then
    echo "Unexpected remote credential in isolated E2E environment" >&2
    exit 1
  fi
done

test_root="$(mktemp -d -t cashier-e2e-XXXXXXXX)"
network="cashier-e2e-${GITHUB_RUN_ID:-local}-${GITHUB_RUN_ATTEMPT:-1}"
bridge=""
firewall_chain="CASHIER_E2E"
cleanup() {
  supabase stop --workdir "$test_root" --no-backup >/dev/null 2>&1 || true
  if [[ -n "$bridge" ]]; then
    sudo iptables -w -D DOCKER-USER -i "$bridge" -j "$firewall_chain" >/dev/null 2>&1 || true
    sudo iptables -w -F "$firewall_chain" >/dev/null 2>&1 || true
    sudo iptables -w -X "$firewall_chain" >/dev/null 2>&1 || true
  fi
  docker network rm "$network" >/dev/null 2>&1 || true
  rm -rf -- "$test_root"
}
trap cleanup EXIT

cd "$test_root"
supabase init >/dev/null
if grep -q 'orlesggcjamwuknxwcpk' supabase/config.toml; then
  echo "Refusing production project config" >&2
  exit 1
fi

# Warm only the public package dependencies needed by the two real handlers.
# No application handler, schema, fixture or credential is present yet.
mkdir -p supabase/functions/edge-dependency-cache
cp "$repo_root/supabase/pending-tests/edge-dependency-cache/index.ts" \
  supabase/functions/edge-dependency-cache/index.ts
printf '\n[functions.edge-dependency-cache]\nverify_jwt = false\n' >>supabase/config.toml

# The temporary project has no application migrations or function source.
# This first start only downloads/prepares the pinned CLI service images.
exclude_services="imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector"
df -h / | tail -n 1
set +e
supabase start --exclude "$exclude_services" >"$test_root/prepare.log" 2>&1
prepare_rc=$?
set -e
if (( prepare_rc != 0 )) || ! supabase status --output json >"$test_root/prepare-status.json" 2>"$test_root/prepare-status.err"; then
  echo "Empty Supabase start/status failed (start exit $prepare_rc)" >&2
  tail -n 25 "$test_root/prepare.log" >&2
  docker ps -a --format 'Container startup: {{.Names}} {{.Status}}' >&2
  df -h / | tail -n 1 >&2
  docker system df >&2
  exit 1
fi
dependency_status="$(curl --silent --show-error --output /dev/null --write-out '%{http_code}' \
  --max-time 120 --request POST \
  http://127.0.0.1:54321/functions/v1/edge-dependency-cache)"
if [[ "$dependency_status" != 204 ]]; then
  echo "Edge dependency warm-up failed (HTTP $dependency_status)" >&2
  docker logs "$(docker ps -q --filter 'name=supabase_edge_runtime_')" --tail 40 >&2
  exit 1
fi
rm -rf -- supabase/functions/edge-dependency-cache
prepare_edge="$(docker ps -q --filter 'name=supabase_edge_runtime_')"
if [[ -z "$prepare_edge" ]]; then
  echo "Preparation stack has no Edge runtime to cache" >&2
  exit 1
fi
docker inspect "$prepare_edge" --format '{{json .Mounts}}' |
  jq -c 'map({Type,Destination})'
docker exec "$prepare_edge" sh -c 'du -sh /root/.cache/deno /home/deno/.cache/deno 2>/dev/null || true'
edge_source_image="$(docker inspect "$prepare_edge" --format '{{.Config.Image}}')"
edge_cache_image="cashier-edge-prepared:${GITHUB_RUN_ID:-local}"
docker commit "$prepare_edge" "$edge_cache_image" >/dev/null
docker image tag "$edge_cache_image" "$edge_source_image"
supabase stop --no-backup >/dev/null 2>&1
docker pull mcr.microsoft.com/playwright:v1.60.0-noble >/dev/null

docker network create --driver bridge \
  -o com.docker.network.bridge.host_binding_ipv4=127.0.0.1 "$network" >/dev/null
network_json="$(docker network inspect "$network")"
if [[ "$(jq -r '.[0].EnableIPv6' <<<"$network_json")" != "false" ]]; then
  echo "Unexpected IPv6 on Cashier E2E bridge" >&2
  exit 1
fi
subnet="$(jq -r '.[0].IPAM.Config[0].Subnet' <<<"$network_json")"
gateway="$(jq -r '.[0].IPAM.Config[0].Gateway' <<<"$network_json")"
bridge="br-$(jq -r '.[0].Id[:12]' <<<"$network_json")"
if [[ -z "$subnet" || -z "$gateway" || ! "$bridge" =~ ^br-[0-9a-f]{12}$ ]]; then
  echo "Could not resolve exact test bridge/subnet" >&2
  exit 1
fi
sudo iptables -w -N "$firewall_chain"
sudo iptables -w -A "$firewall_chain" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
sudo iptables -w -A "$firewall_chain" -d "$gateway/32" -j REJECT
sudo iptables -w -A "$firewall_chain" -d "$subnet" -j RETURN
sudo iptables -w -A "$firewall_chain" -j REJECT
sudo iptables -w -I DOCKER-USER 1 -i "$bridge" -j "$firewall_chain"
sudo iptables -w -C DOCKER-USER -i "$bridge" -j "$firewall_chain"

set +e
supabase start --network-id "$network" \
  --exclude "$exclude_services" \
  >"$test_root/isolated-start.log" 2>&1
isolated_rc=$?
set -e
if (( isolated_rc != 0 )) || ! supabase status --output json >"$test_root/isolated-status.json" 2>"$test_root/isolated-status.err"; then
  echo "Isolated Supabase start/status failed (start exit $isolated_rc)" >&2
  tail -n 25 "$test_root/isolated-start.log" >&2
  docker ps -a --filter 'name=supabase_db_' --format 'DB startup: {{.Status}}' >&2
  exit 1
fi

mapfile -t containers < <(docker ps -q --filter "network=$network")
if (( ${#containers[@]} < 5 )); then
  echo "Expected DB, Auth, API and Edge services on isolated network" >&2
  exit 1
fi
for container in "${containers[@]}"; do
  docker inspect "$container" --format '{{json .NetworkSettings.Networks}}' |
    jq -e --arg name "$network" 'keys == [$name]' >/dev/null || {
      echo "Service has another network attached" >&2
      exit 1
    }
  docker inspect "$container" --format '{{json .Config.Env}}' |
    jq -e 'all(.[]; test("^(HTTP_PROXY|HTTPS_PROXY|ALL_PROXY)=") | not)' >/dev/null || {
      echo "Service has an outbound proxy configured" >&2
      exit 1
    }
done

db_container="$(docker ps -q --filter "network=$network" --filter 'name=supabase_db_')"
edge_container="$(docker ps -q --filter "network=$network" --filter 'name=supabase_edge_runtime_')"
gateway_container="$(docker ps --filter "network=$network" --format '{{.Names}}' | grep -E '^supabase_(kong|envoy)_' | head -n 1)"
if [[ -z "$db_container" || -z "$edge_container" || -z "$gateway_container" ]]; then
  echo "Could not identify local DB, Edge and API gateway services" >&2
  exit 1
fi

probe_external_denied() {
  local context="$1" label="$2" status
  status="$(docker run --rm --network "container:$context" \
    mcr.microsoft.com/playwright:v1.60.0-noble \
    node -e 'fetch("http://example.com", {signal: AbortSignal.timeout(6000)}).then(r => console.log(r.status)).catch(() => console.log("blocked"))')"
  if [[ "$status" != "blocked" ]]; then
    echo "$label reached an external HTTP server (status $status)" >&2
    exit 1
  fi
  status="$(docker run --rm --network "container:$context" \
    mcr.microsoft.com/playwright:v1.60.0-noble \
    node -e 'fetch("http://1.1.1.1", {signal: AbortSignal.timeout(6000)}).then(r => console.log(r.status)).catch(() => console.log("blocked"))')"
  if [[ "$status" != "blocked" ]]; then
    echo "$label reached a direct external IP (status $status)" >&2
    exit 1
  fi
}
probe_external_denied "$db_container" DB
probe_external_denied "$edge_container" Edge

# Browser/app context is a separate disposable container on the same network,
# with no Docker socket or host networking.
browser_probe="$(docker run -d --rm --network "$network" \
  mcr.microsoft.com/playwright:v1.60.0-noble sleep 90)"
probe_external_denied "$browser_probe" Browser
docker exec "$browser_probe" node -e \
  'fetch(`http://${process.argv[1]}:8000/auth/v1/health`).then(r => {if (!r.ok) process.exit(1)}).catch(() => process.exit(1))' \
  "$gateway_container" || {
    echo "Isolated browser cannot reach local Auth/API" >&2
    exit 1
  }
docker stop "$browser_probe" >/dev/null

docker exec "$db_container" sh -c 'test -n "$POSTGRES_PASSWORD" &&
  PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 -U supabase_admin -d postgres \
    -c "CREATE EXTENSION IF NOT EXISTS pg_cron WITH SCHEMA extensions" \
    -c "ALTER SYSTEM SET cron.launch_active_jobs = off" \
    -c "SELECT pg_reload_conf()"' >/dev/null
if [[ "$(docker exec "$db_container" psql -X -Atq -U postgres -d postgres -c 'SHOW cron.launch_active_jobs')" != 'off' ]]; then
  echo "Could not disable disposable DB cron jobs" >&2
  exit 1
fi
docker exec "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" psql -X -q -v ON_ERROR_STOP=1 \
  -U supabase_admin -d postgres -c "CREATE EXTENSION IF NOT EXISTS pg_net WITH SCHEMA extensions"' >/dev/null

pg_net_request() {
  local url="$1" request_id response attempt
  request_id="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
    -c "SELECT net.http_get(url := '$url', timeout_milliseconds := 3000)")"
  if [[ ! "$request_id" =~ ^[0-9]+$ ]]; then
    echo "pg_net did not enqueue a request" >&2
    exit 1
  fi
  for attempt in {1..20}; do
    response="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
      -c "SELECT coalesce(status_code::text, 'none') || '|' || coalesce(error_msg, '') FROM net._http_response WHERE id = $request_id")"
    if [[ -n "$response" ]]; then
      printf '%s' "$response"
      return
    fi
    sleep 1
  done
  echo "pg_net request $request_id had no completed response" >&2
  exit 1
}
internal_result="$(pg_net_request "http://$gateway_container:8000/auth/v1/health")"
if [[ ! "$internal_result" =~ ^2[0-9][0-9]\| ]]; then
  echo "pg_net could not reach local Auth ($internal_result)" >&2
  exit 1
fi
for target in 'http://example.com' 'http://1.1.1.1'; do
  external_result="$(pg_net_request "$target")"
  if [[ ! "$external_result" =~ ^none\|.+ ]]; then
    echo "pg_net external result is not a proved network denial ($external_result)" >&2
    exit 1
  fi
done
echo "ISOLATION_PROOF: DB/pg_net/Edge/browser outbound denied; local Auth reachable; cron off"

# Only after the network proof: restore the owner-captured current public and
# storage schema into the real local Supabase stack. Historical migrations are
# not replayable from zero; no Auth/API/Edge service or RLS rule is stubbed.
# The empty local stack ships its own Storage schema. Replace only that schema
# on this disposable, network-isolated database so the captured live definition
# can be restored without duplicate built-in types such as storage.buckettype.
storage_rows="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT (SELECT count(*) FROM storage.buckets), (SELECT count(*) FROM storage.objects)")"
if [[ "$storage_rows" != '0|0' ]]; then
  echo "Disposable Storage schema is not empty; refusing baseline replacement" >&2
  exit 1
fi
docker exec "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -q -v ON_ERROR_STOP=1 \
  -U supabase_admin -d postgres -c "DROP SCHEMA storage CASCADE"' \
  >"$test_root/storage-replace.log" 2>&1
# The live catalog places pg_trgm operators in public, while a fresh local
# Supabase project may place that extension elsewhere (or omit it).
pg_trgm_schema="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT n.nspname FROM pg_extension e JOIN pg_namespace n ON n.oid=e.extnamespace WHERE e.extname='pg_trgm'")"
if [[ -z "$pg_trgm_schema" ]]; then
  docker exec "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -q -v ON_ERROR_STOP=1 \
    -U supabase_admin -d postgres -c "CREATE EXTENSION pg_trgm WITH SCHEMA public"' >/dev/null
elif [[ "$pg_trgm_schema" != public ]]; then
  docker exec "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -q -v ON_ERROR_STOP=1 \
    -U supabase_admin -d postgres -c "ALTER EXTENSION pg_trgm SET SCHEMA public"' >/dev/null
fi
set +e
docker exec -i "$db_container" sh -c 'PGPASSWORD="$POSTGRES_PASSWORD" exec psql -X -q -v ON_ERROR_STOP=1 \
  -U supabase_admin -d postgres' \
  <"$schema_dir/live-public-schema.sql" >"$test_root/schema-restore.log" 2>&1
restore_rc=$?
set -e
if (( restore_rc != 0 )); then
  echo "Sanitized current-schema restore failed on isolated Supabase (exit $restore_rc)" >&2
  tail -n 35 "$test_root/schema-restore.log" >&2
  exit 1
fi
baseline_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT to_regclass('public.tournament_registrations') IS NOT NULL,
    to_regclass('public.cashier_buyin_movements') IS NULL")"
if [[ "$baseline_state" != 't|t' ]]; then
  echo "Captured baseline is incomplete or already has the Cashier migration" >&2
  exit 1
fi
cashier_migration='20270115000003_cashier_tour_money_v1.sql'
set +e
timeout 10m docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  <"$repo_root/supabase/migrations/$cashier_migration" >"$test_root/migration.log" 2>&1
migration_rc=$?
set -e
if (( migration_rc != 0 )); then
  echo "Exact Cashier migration failed on isolated current-schema baseline (exit $migration_rc)" >&2
  tail -n 45 "$test_root/migration.log" >&2
  exit 1
fi
applied_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "SELECT to_regclass('public.cashier_buyin_movements') IS NOT NULL,
    to_regprocedure('public.cashier_create_app_registration_v1(uuid,uuid)') IS NOT NULL,
    has_function_privilege('anon','public.cashier_create_app_registration_v1(uuid,uuid)','EXECUTE'),
    has_function_privilege('service_role','public.cashier_create_app_registration_v1(uuid,uuid)','EXECUTE'),
    (SELECT count(*) FROM public.cashier_tour_settings WHERE enabled)")"
if [[ "$applied_state" != 't|t|f|t|0' ]]; then
  echo "Cashier schema/ACL/default-off postcondition failed ($applied_state)" >&2
  exit 1
fi
if [[ "$(docker exec "$db_container" psql -X -Atq -U postgres -d postgres -c 'SHOW cron.launch_active_jobs')" != 'off' ]]; then
  echo "Disposable cron guard changed during migration" >&2
  exit 1
fi
echo "SCHEMA_PROOF: captured current schema restored; exact Cashier SQL applied; RPC ACL and default-off verified; cron remains off"
set +e
timeout 10m docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  <"$repo_root/supabase/pending-tests/cashier_tour_money_v1.sql" \
  >"$test_root/cashier-money-test.log" 2>&1
money_test_rc=$?
set -e
if (( money_test_rc != 0 )); then
  echo "Cashier money/seat rollback-only test failed on captured schema (exit $money_test_rc)" >&2
  tail -n 45 "$test_root/cashier-money-test.log" >&2
  exit 1
fi
echo "MONEY_PROOF: Cashier money/seat rollback-only SQL assertions passed on captured schema"
echo "E2E_NOT_READY: synthetic Auth/Edge/browser business assertions are not installed yet" >&2
exit 1
