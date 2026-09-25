# Cashier #1304 — release preparation (no production apply)

This is a preparation record, not authority to deploy. Follow the workspace
`VBacker/05-RUNBOOKS/CONTROLLED_DB_APPLY.md` owner gate for any live write.

## Source and exact allowlist

- PR: `#1304`; reviewed head: `3ca25a197e263c3c95030a07e0fbc136d98eef77`.
- Sole intended DB change: `20270115000011_cashier_refund_without_floor_clearance.sql`.
- Source: `supabase/pending-migrations/20270115000011_cashier_refund_without_floor_clearance.sql`.
- SHA-256 of that file at the reviewed head:
  `B8703796F21706F13C0A2190436172BD167186D6242695F0C4829FE4A857E101`.
- Required live predecessor: `20270115000003_cashier_tour_money_v1` (tables,
  ledger, triggers and the original `cashier_complete_refund_v1`). No object
  from versions 06–10 is referenced by migration 11.
- Versions `20270115000006` through `20270115000010` are **excluded**. Never run
  whole-catalog `supabase db push` for this release: those versions are active
  files in the checkout but absent from live as of 2026-09-24. Do not mark
  them applied or silently skip them. If no reviewed exact-version mechanism
  is available, stop at the DB gate.
- The file remains pending. Promote exactly this file to the active migration
  catalog in a reviewed source change before a versioned apply. Recheck its
  SHA-256 and the complete live ledger immediately before applying.
- Edge source is unchanged from `main`; no Edge deployment is required.
- Merging `main` has produced Vercel production deployments in this repository.
  Keep the PR unmerged until frontend release is approved and coordinated.

## Read-only live precheck (record timestamp and results privately)

```sql
SELECT clock_timestamp() AS checked_at;
SELECT version, name FROM supabase_migrations.schema_migrations
WHERE version BETWEEN '20270115000003' AND '20270115000011'
ORDER BY version;
-- Require 03 with its exact name, require 11 absent, and require 06–10 absent.

SELECT to_regprocedure(
  'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)'
) IS NOT NULL AS rpc_exists,
md5(pg_get_functiondef(to_regprocedure(
  'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)'
))) AS prior_function_md5,
has_function_privilege('anon',
  'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)',
  'execute') AS anon_execute,
has_function_privilege('authenticated',
  'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)',
  'execute') AS cashier_role_execute;
-- Observed prior MD5 on 2026-09-24: b3c619f7cfb4c28580a4beada0c273e8.
-- Stop and re-review if this definition has changed.

SELECT 'refund_requests' AS object, count(*) AS rows,
  md5(coalesce(string_agg(id::text || ':' || status || ':' || amount::text,
    '|' ORDER BY id), '')) AS state_hash
FROM public.cashier_refund_requests
UNION ALL
SELECT 'movements', count(*),
  md5(coalesce(string_agg(id::text || ':' || direction || ':' || method ||
    ':' || purpose || ':' || amount::text || ':' || applied_amount::text,
    '|' ORDER BY id), ''))
FROM public.cashier_buyin_movements
UNION ALL
SELECT 'registrations', count(*),
  md5(coalesce(string_agg(id::text || ':' || status || ':' ||
    coalesce(total_pay::text, ''), '|' ORDER BY id), ''))
FROM public.tournament_registrations
UNION ALL
SELECT 'entries', count(*),
  md5(coalesce(string_agg(id::text || ':' || status || ':' ||
    coalesce(current_stack::text, ''), '|' ORDER BY id), ''))
FROM public.tournament_entries
UNION ALL
SELECT 'receipts', count(*),
  md5(coalesce(string_agg(id::text || ':' || status,
    '|' ORDER BY id), ''))
FROM public.seat_draw_receipts;
```

These hashes are change detectors, not a backup. If legitimate concurrent
activity changes them, investigate the affected rows; never erase that activity.

## Recovery gate

Before any apply, create and verify a fresh, restorable recovery point under
the controlled DB runbook. Record export start time, successful nonempty
output, restore method, and writes during export outside Git/chat/vault.
The scheduled physical backup alone is not fresh enough if writes followed it.
If a safe credential or recovery method is unavailable, do not apply.

For the #1304 release, use the owner-dispatched workflow
`.github/workflows/cashier-1304-backup-apply.yml` from an exact `main` SHA.
It persists only age-encrypted ciphertext, downloads that artifact again,
decrypts it with `CASHIER_BACKUP_AGE_IDENTITY` from the protected environment,
and restores it into an outbound-isolated disposable PostgreSQL 17 stack.
Migration 11 is eligible to run only after that restore job passes. The
artifact retention window is seven days; preserve its run ID, artifact ID,
snapshot timestamps and checksums in the release evidence.

## Selective versioned apply (prepared, not executed)

After the recovery gate and fresh read-only precheck pass, use a fresh temporary
Supabase project directory containing **only** the reviewed version-11 file.
Do not copy the repository's full `supabase/migrations` directory. Pin the PR
head at execution time against the reviewed GitHub SHA; stop if it differs.
Pin the target project to `orlesggcjamwuknxwcpk`. Before invoking the CLI,
require the source SHA-256 above, an empty staged migrations directory, and a
staged directory containing exactly that one filename. Confirm the live ledger
still has 03, lacks 11, and lacks 06–10. An unexpected history or a CLI plan
showing anything other than 11 is a stop condition, not a reason to use
`--include-all`, `migration repair`, or `db push`.

Use the CLI's versioned `supabase migration up --linked` from that isolated
directory only after secure credential verification. It must create the real
version-11 ledger entry itself; never insert or fake that row manually. Keep
the apply output and final SQL checksum in the private release evidence.
This mechanism is source-prepared but has **not** been exercised against live;
the controlled apply gate remains closed.

## When owner says `DB_PASSWORD_ROTATED`

1. Verify the newly rotated credential with a read-only probe and update the
   protected secret store if applicable; never reuse or print the old value.
2. Create and verify a fresh restorable recovery point, then repeat project,
   ledger, function-MD5, source-head, SHA-256, and one-file allowlist prechecks.
3. Run only the selective version-11 apply above. Check the function, ACL,
   ledger and business-state hashes; require 06–10 still absent.
4. Once DB and CI gates pass, merge #1304, verify the exact production Vercel
   source SHA, then perform read-only production smoke. Do not create a live
   refund or buy-in merely for this smoke test.

## Read-only postcheck after an owner-approved exact apply

Repeat the precheck ledger and business-state query. Require one new ledger row
`20270115000011` with name `cashier_refund_without_floor_clearance`, still no
06–10 rows, and no unexplained business-state changes. Also run:

```sql
SELECT p.prosecdef AS security_definer, p.proconfig AS function_settings,
  has_function_privilege('anon', p.oid, 'execute') AS anon_execute,
  has_function_privilege('authenticated', p.oid, 'execute') AS auth_execute,
  md5(pg_get_functiondef(p.oid)) AS applied_function_md5,
  position('v_reg.cashier_seating_error IS NOT NULL' IN
    pg_get_functiondef(p.oid)) > 0 AS waiting_state_guard_present
FROM pg_proc p
WHERE p.oid = to_regprocedure(
  'public.cashier_complete_refund_v1(uuid,bigint,bigint,text,text)');
-- Require security_definer=true, search_path=public,pg_temp,
-- anon_execute=false, auth_execute=true, and waiting_state_guard_present=true.
```

Do not make a production refund merely to smoke-test. Authenticated TEST UAT
and frontend-visible verification are separate release gates.

## Forward recovery if behavior fails

Stop Cashier refund actions. Preserve all refund requests, movements, chip and
receipt history. Review a *new* migration that restores the function body from
`20270115000003_cashier_tour_money_v1.sql`; do not edit that historical file or
revert money rows. Recheck the ledger, ACL and business-state hashes afterward.
Whole-database restore is only a separately approved last resort after assessing
payments/writes since the recovery point.
