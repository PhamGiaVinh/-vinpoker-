# Floor/Tracker V3 — common release handoff (source only)

Status: `FLOOR_RELEASE_IN_PROGRESS`. This document records the bounded Floor/Tracker release; production steps still require their own receipts and preflight.

## Frozen inputs

- Floor PR [#1306](https://github.com/PhamGiaVinh/-vinpoker-/pull/1306), reviewed HEAD `45a793c0b6422734a0af4a081e349af7581ceec1`, merged as `25e4ab5f87bf9522e33c8d1e312be3c5d9b4ff18` on 2026-09-25. Pin the final release SHA after integrating the controlled deploy path and activation.
- Focused source review: no new P0/P1 in migration lineage, 8/9-max capacity, locked/reserved seats, active-hand guard, idempotency, caller/club checks, legacy hand compatibility or pending-move lifecycle. Four targeted Vitest files: 20/20 PASS. Disposable PostgreSQL and catalog/promotion CI on the frozen PR head: PASS. Preview browser evidence is pending Vercel build capacity, not an engineering failure.
- GitHub main has no branch-protection required-status-check rule or active repository ruleset for `Vercel – target-source` (checked 2026-09-25). That rate-limited Preview was not a required merge check; #1306 has merged.
- A merge to `main` starts `.github/workflows/vbackerworkflowmain.yml` on `push`, but its Edge and frontend deployment jobs require `workflow_dispatch`; source merge alone does not apply DB, deploy Edge or deploy frontend. Recheck the workflow before merging. Do not use merge as a production launch.
- Existing Edge candidate source: `VinPoker/supabase/functions/tournament-live-update/index.ts`, last changed by commit `b69085f1cf596b27a1413359b7d58d37fc432cb6`; Git blob `1a4475f7435cda889b74092544cc90486da1cbf7`, file SHA-256 `4A6EFCF751A5CF088D3D19393871DDBCFB257EC8A3761C262853A35D0ACE3280`. This blob is identical in #1306 and current `main`. It routes V3 `start_hand` to `start_tracker_hand_v3` with tournament-table/session/epoch and retains legacy `start_hand`; `record_hand` retains the existing call signature, with its V3/legacy identity handling supplied by migration 00009. Production `tournament-live-update` is ACTIVE v58, not this candidate. Do not deploy it until the common DB gate has passed.
- Frontend gate: `floorDeferredTrackerMoveV1=false` in `src/lib/featureFlags.ts`. It is visibility only, not RPC authorization. The exact common-release integration/frontend SHA must be pinned after source integration; neither the PR head nor an unreviewed moving `main` is a frontend deployment target.

## Exact DB chain and order

Live read-only probe on 2026-09-25 returned `20270115000005 = tracker_dealer_floor_operational_alerts`; versions 00006–00010 were absent and `floor_queue_tracker_move_v1` did not exist. Supabase CLI 2.101.0 `db push --linked --dry-run` exited 0 and listed **only** the following five files, in order, without `--include-all`:

| Order | Active migration file | SHA-256 | Runtime dependency / forward-fix note |
| --- | --- | --- | --- |
| 1 | `20270115000006_floor_roster_actions_repair.sql` | `0A6CF4C3809935692CD6607C299583ED7CE7E3E4F6E345768BB68467D73AEA81` | Repairs canonical Floor roster actions; if behavior fails, leave flag OFF and use a reviewed forward migration. |
| 2 | `20270115000007_floor_break_eligible_destinations.sql` | `168689A46399D7BE1460DA9172F7550BD523612BDF4234080663DDB4FAE83D3E` | 8/9-max capacity excludes active hands, locked seats and reservations; requires 00006 and Floor V3 tables. Forward-fix rather than rewriting this migration. |
| 3 | `20270115000008_floor_deferred_tracker_move_v1.sql` | `964C8ED94726089CF0E63D6CB59364C65E256D0AA7ED7995E0CFBA335260F38E` | Queue, reservation guard and post-terminal apply; requires 00007. Queue mutation EXECUTE remains revoked from `authenticated` after this migration. Existing audit/read paths remain available. |
| 4 | `20270115000009_tracker_record_hand_v3_identity.sql` | `BA77B23E3213882830A297A6127ED34AF71DBEC894A7CDF163CCA097FD09AD7A` | `record_hand` resolves explicit V3 hand/session/seat identity and preserves legacy path; requires 00008. Keep old Edge/flag gated until candidate Edge deploy. |
| 5 | `20270115000010_tracker_v3_hand_start_context.sql` | `ED3B2EF3AFE2951D2F7D05E6B7E4F27C80328319310CCE58AA414EBA195F0094` | Adds caller-bound V3 hand-input table scope/start RPC with session + control epoch; requires 00009 and V3-compatible Edge. |

The 00007 and 00008 hashes above were corrected after recomputing the active files on 2026-09-25. Their Git blobs are identical in reviewed #1306 HEAD `45a793c0...` and merge commit `25e4ab5f...`; the previous handoff hashes were stale, not a source change.

The original versions and byte-preserved source are in `supabase/migration-archive/never-apply/` and mapped by `floor-v3-catalog-reconciliation.manifest.json`; never restore them to the active catalog or edit them in place. No business rows are rewritten by 00009/00010. After live transactions, a whole-database restore is not a normal rollback: close mutation, keep audit/read paths, investigate and use an owner-reviewed forward fix.

### Owner-gated preflight (read only)

1. Confirm fresh, restorable recovery point and its snapshot/start time under the canonical `VBacker/05-RUNBOOKS/CONTROLLED_DB_APPLY.md`. Confirm exact owner authorization for the five-file DB apply. No old daily backup substitutes for a fresh recovery point if writes occurred.
2. Recompute all five SHA-256 hashes from the exact release checkout; require equality with the table above. Run `npm run check:migration-catalog` and `npm run check:migration-promotion -- --static`. The non-static promotion check requires an explicit live-ledger input; do not treat its missing-input failure as a catalog failure.
3. Query ledger and RPC state (no business rows):

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version BETWEEN '20270115000005' AND '20270115000010'
ORDER BY version;
-- Exactly 00005 = tracker_dealer_floor_operational_alerts; no 00006–00010.

SELECT to_regprocedure('public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)') AS queue_rpc;
-- NULL before DB apply.
```

4. Run `supabase db push --linked --dry-run` using the reviewed checkout. Require the output to list **exactly** 00006, 00007, 00008, 00009, 00010 and no other migration. Stop on any drift, reused version, different name, checksum or extra file. Do not use `--include-all`, migration repair or manual ledger edits.

### Common-release DB apply and postcheck (not executed here)

Only after the recovery point and owner gate: run the canonical versioned CLI apply **without** `--include-all`, and only if the immediately preceding dry-run lists exactly the five files above. Stop on any change. After apply, verify:

```sql
SELECT version, name
FROM supabase_migrations.schema_migrations
WHERE version BETWEEN '20270115000005' AND '20270115000010'
ORDER BY version;
-- Exactly six rows: existing Operational Alerts 00005 plus ordered 00006–00010.

SELECT
  to_regprocedure('public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)') IS NOT NULL AS queue_exists,
  to_regprocedure('public.start_tracker_hand_v3(uuid,uuid,uuid,bigint,integer,timestamptz,uuid,integer)') IS NOT NULL AS v3_start_exists,
  to_regprocedure('public.record_hand(uuid,uuid,integer,timestamptz,jsonb,jsonb,jsonb,jsonb,integer,uuid)') IS NOT NULL AS record_hand_exists;

SELECT
  has_function_privilege('authenticated', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE') AS queue_authenticated_open,
  has_function_privilege('anon', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE') AS queue_anon_open,
  has_function_privilege('service_role', 'public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)', 'EXECUTE') AS queue_service_role_open;
-- All three queue values must be false before common-release activation.
```

Verify queue table RLS, pending unique indexes, seat-reservation trigger and exact RPC signatures against the migration contract tests. A ledger row alone is insufficient. Keep the frontend flag OFF and queue grant closed until Edge and frontend smoke pass.

## Edge and server activation

1. After DB postcheck, deploy only the pinned `tournament-live-update` candidate using the explicit `deploy_tournament_live_update` workflow input under the existing protected critical environment. This selection is being added in #1309; it is not live until that PR merges. Pin the source blob above, verify `deno check` and targeted tests, then record deployment version/receipt.
2. Read-only/TEST smoke: legacy hand path still succeeds; V3 start binds the exact tournament, assignment, session and epoch; stale epoch or wrong assignment/session fails closed; a queued entrant is absent from the running hand, moves once at terminal state and appears in the next hand; retries do not duplicate hand, move or seat. Do not run write smoke against real business data.
3. The activation SQL is staged at `supabase/pending-migrations/20270115000012_floor_tracker_move_activation_v1.sql`, outside the active catalog. Version 00011 is already allocated to a separate Cashier pending migration and must not be reused. Promote only after the five-file apply and Edge verification; review the exact diff before applying:

```sql
BEGIN;
REVOKE ALL ON FUNCTION public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.floor_queue_tracker_move_v1(uuid,uuid,integer,bigint,bigint,uuid)
  TO authenticated;
COMMIT;
```

The function itself uses `auth.uid()`, derives tournament/club on the server, and checks Floor operator scope, source/destination session and revisions. The browser never receives a service-role key. After activation, verify `authenticated=true`, `anon=false`, `service_role=false` with `has_function_privilege`; also exercise an unauthorized actor and cross-club caller in TEST. The frontend flag alone never opens the RPC.

## Common release sequence and kill switch

Recovery point → exact DB 00006–00010 apply → DB/ACL postcheck (queue closed) → pinned Edge candidate deploy/receipt → Edge smoke → separately reviewed queue grant → exact frontend artifact with `floorDeferredTrackerMoveV1=true` deploy/receipt → Centerpoint authenticated UAT. Grant before the flag-enabled artifact prevents the UI from advertising an unavailable action. Source merge is not activation.

If any live signal fails: **(1)** revoke queue EXECUTE from `authenticated` (retain anon/service-role denial), **(2)** disable `floorDeferredTrackerMoveV1`, **(3)** keep audit/read paths available and assess a forward fix. Do not use routine whole-DB restore after new business writes.

External common-release dependencies: a controlled deployment path for the pinned `tournament-live-update` Edge candidate, the release owner’s recovery point/DB approval, the separately reviewed activation migration, the exact integrated frontend SHA and owner UAT. TV, Chip Master, multi-day, payout, Satellite, dealer bagging and Cashier ticket redemption are outside this Floor slice.
