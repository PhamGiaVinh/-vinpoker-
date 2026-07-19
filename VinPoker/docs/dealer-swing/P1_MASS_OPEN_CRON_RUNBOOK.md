# Dealer Swing P1 Mass-Open and Cron Runbook

## Release status

This CRITICAL/RED change remains **NOT_READY** until every production gate below has current evidence.

- Source-only PR: no migration apply, Edge/frontend deploy, merge, or flag enable is performed by the PR author.
- Runtime rollout starts with `enabled=false`, `all_clubs_enabled=false`, and an empty club allowlist.
- The only TEST club approved for the first canary is HSOP: `22222222-2222-2222-2222-222222222222`.
- Existing assignments are preserved. Do not reset the 19 staffed tables from the incident.

## Controlled migration window

Owner approval is required for each production mutation.

1. Verify the live migration ledger and confirm both timestamps are absent:
   - `20270102000002_process_swing_cron_dispatch_observer.sql`
   - `20270102000003_dealer_open_operations.sql`
2. Apply the cron dispatch/observer migration first.
3. Confirm `process-swing` and `process-swing-observer` are separate one-minute jobs.
4. Confirm dispatch creates a new `process_swing_cron_runs.request_id` each minute even if observer collection times out.
5. Apply the durable operation migration.
6. Verify `operator_open_dealer_tables` and `get_dealer_open_operation` signatures, owners, and grants. `anon` must not execute either RPC.
7. Verify the runtime rollout row is still OFF with an empty allowlist.
8. Verify closing a TEST table clears `opened_at` and `dealer_open_operation_id`.

The new `process-swing` source reads the operation marker columns, so migration `20270102000003` must be live before deploying that Edge bundle.

## Dark deploy

1. Deploy the reviewed `mass-assign` and `process-swing` Edge bundle only after both migrations are verified live.
2. Deploy the exact reviewed frontend bundle while the runtime master remains OFF.
3. Confirm the add-table confirmation is disabled for the TEST club and a direct guarded RPC returns `rollout_disabled` without writes.
4. Confirm legacy `mass-assign` callers still receive the prior response contract.
5. Confirm normal cron dispatch remains healthy for at least five consecutive ticks before enabling a canary.

## HSOP canary

Owner approval is required before changing the runtime gate.

1. Set the runtime master ON and allowlist only HSOP. Keep `all_clubs_enabled=false`.
2. Select the exact 30 incident tables. The 19 tables already holding a dealer must remain untouched and count as complete.
3. Start one mass-open operation and verify progress reports `assigned/requested` from server state.
4. If eligible dealers are insufficient, verify the operation remains `waiting_for_dealer`; close the browser and confirm cron continues it.
5. Add an eligible TEST dealer and verify a later cron tick fills one pending target without assigning any dealer or table twice.
6. Close one pending TEST table through the standard close workflow and verify its marker is removed immediately.
7. Confirm a marker older than 24 hours is not eligible for auto-fill.

Monitor the canary for at least 15 minutes and through one real continuation tick:

- operation status, requested, assigned, and remaining;
- assignment conflict outcomes and CAS retries;
- duplicate active dealer/table assignments;
- cron dispatch cadence independent of observer failures;
- `preflight_query_error`, `invalid_preassign`, and `replan_outcome` diagnostics;
- Telegram and audit records correlated to the operation, without duplicate assignment notifications.

## Emergency disable

1. Set `dealer_mass_open_rollout.enabled=false`. This is the immediate server-side write stop and does not depend on a frontend deployment.
2. Refresh the client and confirm mass-open confirmation is disabled.
3. Preserve operation, target, assignment, audit, cron, and Edge evidence for investigation.
4. The observer job may be unscheduled independently if it causes load. Do not stop the business dispatch job merely because response observation is unhealthy.
5. Do not delete operation rows or reset existing assignments during incident response.

Any missing live signature, grant, default-OFF gate, dispatch cadence, TEST-club result, or 15-minute monitoring evidence keeps rollout **NOT_READY**.

## Local validation snapshot

- Final source inventory: 526 migration files on `origin/main`, 528 on this branch, and 26 pre-existing timestamp collision groups; both new timestamps are unique.
- The current production schema dump restored cleanly to the matching Supabase PostgreSQL 17 image; both migrations and their second apply passed.
- PostgreSQL 16 compatibility used the same current application schema. PG17-only `MAINTAIN` grants were omitted, and `pg_net`/Vault were represented by the minimum test stubs because Supabase publishes no PostgreSQL 16 image. Both migrations, second apply, SQL suites, and inverse lock-order concurrency passed.
- This local evidence is not proof that migrations, Edge code, frontend code, or flags are live.
