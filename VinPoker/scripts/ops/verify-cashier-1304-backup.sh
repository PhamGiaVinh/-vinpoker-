#!/usr/bin/env bash
set -euo pipefail

archive_dir="${1:-}"
if [[ -z "$archive_dir" ]]; then
  echo "Encrypted backup directory is required" >&2
  exit 1
fi

for required in cashier-1304-backup.tar.gz.age ciphertext.sha256 archive.sha256 metadata.txt; do
  test -f "$archive_dir/$required" || {
    echo "Missing backup artifact member: $required" >&2
    exit 1
  }
done

test -n "${CASHIER_BACKUP_AGE_IDENTITY:-}" || {
  echo "Stored backup identity is unavailable" >&2
  exit 1
}

test_root="$(mktemp -d -t cashier-backup-restore-XXXXXXXX)"
identity_path="$test_root/identity.txt"
plain_archive="$test_root/cashier-1304-backup.tar.gz"
restore_root="$test_root/restore"
firewall_chain="CASHIER_BACKUP"
bridge=""
network=""

cleanup() {
  supabase stop --workdir "$test_root" --no-backup >/dev/null 2>&1 || true
  if [[ -n "$bridge" ]]; then
    sudo iptables -w -D DOCKER-USER -i "$bridge" -j "$firewall_chain" >/dev/null 2>&1 || true
    sudo iptables -w -F "$firewall_chain" >/dev/null 2>&1 || true
    sudo iptables -w -X "$firewall_chain" >/dev/null 2>&1 || true
  fi
  rm -rf -- "$test_root"
}
trap cleanup EXIT

(cd "$archive_dir" && sha256sum --check --status ciphertext.sha256)

cd "$test_root"
supabase init >/dev/null
if grep -q 'orlesggcjamwuknxwcpk' supabase/config.toml; then
  echo "Refusing production project config in restore verifier" >&2
  exit 1
fi

exclude_services="imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector"
supabase start --exclude "$exclude_services" >"$test_root/start.log" 2>&1 || {
  echo "Disposable Supabase start failed" >&2
  tail -n 30 "$test_root/start.log" >&2
  exit 1
}

db_container="$(docker ps -q --filter "name=supabase_db_$(basename "$test_root")")"
test -n "$db_container" || {
  echo "Disposable database container was not found" >&2
  exit 1
}
network="$(docker inspect "$db_container" --format '{{json .NetworkSettings.Networks}}' |
  jq -er 'keys | if length == 1 then .[0] else error("expected one network") end')"
network_json="$(docker network inspect "$network")"
test "$(jq -r '.[0].EnableIPv6' <<<"$network_json")" = false
subnet="$(jq -r '.[0].IPAM.Config[0].Subnet' <<<"$network_json")"
gateway="$(jq -r '.[0].IPAM.Config[0].Gateway' <<<"$network_json")"
bridge="br-$(jq -r '.[0].Id[:12]' <<<"$network_json")"
[[ -n "$subnet" && -n "$gateway" && "$bridge" =~ ^br-[0-9a-f]{12}$ ]]

sudo iptables -w -N "$firewall_chain"
sudo iptables -w -A "$firewall_chain" -m conntrack --ctstate ESTABLISHED,RELATED -j RETURN
sudo iptables -w -A "$firewall_chain" -d "$gateway/32" -j REJECT
sudo iptables -w -A "$firewall_chain" -d "$subnet" -j RETURN
sudo iptables -w -A "$firewall_chain" -j REJECT
sudo iptables -w -I DOCKER-USER 1 -i "$bridge" -j "$firewall_chain"
sudo iptables -w -C DOCKER-USER -i "$bridge" -j "$firewall_chain"

if docker run --rm --network "$network" curlimages/curl:8.12.1 \
  --silent --show-error --max-time 5 https://example.com >/dev/null 2>&1; then
  echo "Disposable restore network still has outbound access" >&2
  exit 1
fi

docker exec "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
  -c "ALTER SYSTEM SET cron.launch_active_jobs = off" >/dev/null
docker restart "$db_container" >/dev/null
until docker exec "$db_container" pg_isready -U postgres -d postgres >/dev/null 2>&1; do sleep 1; done
test "$(docker exec "$db_container" psql -X -Atq -U postgres -d postgres -c 'SHOW cron.launch_active_jobs')" = off

umask 077
printf '%s\n' "$CASHIER_BACKUP_AGE_IDENTITY" >"$identity_path"
age --decrypt --identity "$identity_path" --output "$plain_archive" \
  "$archive_dir/cashier-1304-backup.tar.gz.age"
rm -f -- "$identity_path"
expected_archive_sha="$(awk 'NF == 2 && $2 == "cashier-1304-backup.tar.gz" {print $1}' \
  "$archive_dir/archive.sha256")"
actual_archive_sha="$(sha256sum "$plain_archive" | awk '{print $1}')"
test -n "$expected_archive_sha"
test "$actual_archive_sha" = "$expected_archive_sha"

mkdir -p "$restore_root"
if tar -tzf "$plain_archive" | grep -Eq '(^/|(^|/)\.\.(/|$))'; then
  echo "Backup archive contains an unsafe path" >&2
  exit 1
fi
tar -xzf "$plain_archive" -C "$restore_root"
rm -f -- "$plain_archive"

backup_root="$restore_root/cashier-1304-backup"
for required in roles.sql schema.sql migration-history.sql data.sql metadata.txt; do
  test -s "$backup_root/$required" || {
    echo "Decrypted backup member is missing or empty: $required" >&2
    exit 1
  }
done

for table in cashier_refund_requests cashier_buyin_movements cashier_till_shifts \
  tournament_registrations tournament_entries tournament_seats seat_draw_receipts; do
  grep -Eq "^COPY public\\.${table}[[:space:](]" "$backup_root/data.sql" || {
    echo "Data dump does not cover required table: $table" >&2
    exit 1
  }
done

for sql_file in roles.sql schema.sql migration-history.sql data.sql; do
  if ! docker exec -i "$db_container" psql -X -q -v ON_ERROR_STOP=1 -U postgres -d postgres \
    <"$backup_root/$sql_file" >"$test_root/${sql_file}.log" 2>&1; then
    echo "Restore failed for $sql_file" >&2
    tail -n 35 "$test_root/${sql_file}.log" >&2
    exit 1
  fi
done

restore_state="$(docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
  SELECT
    to_regprocedure('public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)') IS NOT NULL,
    to_regclass('public.cashier_refund_requests') IS NOT NULL,
    to_regclass('public.cashier_buyin_movements') IS NOT NULL,
    to_regclass('public.cashier_till_shifts') IS NOT NULL,
    to_regclass('public.tournament_registrations') IS NOT NULL,
    to_regclass('public.tournament_entries') IS NOT NULL,
    to_regclass('public.tournament_seats') IS NOT NULL,
    to_regclass('public.seat_draw_receipts') IS NOT NULL,
    has_function_privilege('anon','public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)','EXECUTE'),
    has_function_privilege('authenticated','public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)','EXECUTE');")"
if [[ "$restore_state" != 't|t|t|t|t|t|t|t|f|t' ]]; then
  echo "Restored Cashier schema/ACL contract failed ($restore_state)" >&2
  exit 1
fi

docker exec "$db_container" psql -X -Atq -v ON_ERROR_STOP=1 -U postgres -d postgres -c "
  SELECT 'RESTORE_COUNTS',
    (SELECT count(*) FROM public.cashier_refund_requests),
    (SELECT count(*) FROM public.cashier_buyin_movements),
    (SELECT count(*) FROM public.cashier_till_shifts),
    (SELECT count(*) FROM public.tournament_registrations),
    (SELECT count(*) FROM public.tournament_entries),
    (SELECT count(*) FROM public.tournament_seats),
    (SELECT count(*) FROM public.seat_draw_receipts);"
echo "RESTORE_VERIFICATION=PASS"
