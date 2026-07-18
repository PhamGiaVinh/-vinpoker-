# Dealer Swing Phone Completion Runbook

## Release status

This change is **NOT_READY** for broad production enablement until every gate below has current evidence.

- CRITICAL/RED module: dealer state, attendance, payroll start, table close, and Telegram notification.
- Source flag `opsSwingPhoneCompletion` must remain `false` in the merge commit.
- Runtime master switch must remain disabled and its club allowlist empty after migration apply.
- The only TEST club for this rollout is HSOP: `22222222-2222-2222-2222-222222222222`.
- This PR must not apply a migration, deploy an Edge Function or frontend, enable a runtime gate, or merge itself.

## Controlled migration window

Owner approval is required before applying either additive migration to production.

1. Confirm the production migration inventory and that neither timestamp is present:
   - `20270102000000_operator_dealer_checkin.sql`
   - `20270102000001_close_dealer_tables_cas.sql`
2. Apply in that order during the approved maintenance window.
3. Verify the new RPC signatures, owners, and grants. `anon` must not execute them.
4. Verify `dealer_swing_phone_rollout.master_enabled=false`, `all_clubs_enabled=false`, and an empty allowlist.
5. Verify the scheduled-pool bridge configuration and its one-minute cron are still active. Do not change `process-swing` in this rollout.
6. Call each guarded RPC against HSOP while the runtime master is OFF and confirm `rollout_disabled` with no attendance, assignment, audit, or notification write.

Migration rollback is an owner-controlled schema operation. Disable the runtime master first, retain audit/request rows for incident analysis, then remove only the additive phone overloads and internal tables after confirming no consumer remains. Do not alter the legacy three-argument `close_dealer_tables` desktop signature.

## Dark deploy

1. Deploy the backward-compatible `telegram-swing-notifier` and the exact reviewed frontend bundle with the source flag still OFF.
2. Open the production bundle on a real phone as the HSOP owner/operator.
3. Confirm existing desktop check-in still uses its prior path.
4. Confirm phone completion controls remain hidden while the runtime master is OFF.
5. Confirm changing the selected club closes open sheets, clears selections, and cannot display a stale response from the prior club.

No client request may contain a Telegram token. Close commits before notification; a notification failure is warning-only and never rolls back a closed table.

## HSOP UAT enable

Enable only after the owner confirms the dark-deploy checks.

1. Set the runtime master ON.
2. Add only HSOP to the runtime allowlist.
3. Keep `all_clubs_enabled=false` and keep the source wide-rollout flag OFF.
4. Refresh the exact production bundle and confirm completion controls appear only for HSOP.
5. Perform one real TEST check-in:
   - scheduled early arrival records `checked_in_at` but no future payroll `check_in_time`;
   - the bridge promotes the dealer at the scheduled start and creates payroll/pool start then;
   - an unscheduled dealer requires an entry-specific reason and starts in the pool at the current time.
6. Perform one TEST close using dry-run plus CAS. Confirm a stale snapshot closes no table.
7. Perform one TEST two-table swap or multi-table cycle using reconcile dry-run plus CAS.
8. Confirm one Telegram close notification per operation ID, with no duplicate audit on replay.

## Initial monitoring

Monitor for at least 10 minutes and through the three TEST operations above.

- RPC outcomes: completion/partial/conflict/race-lost/rollout-disabled rates.
- Attendance: arrival and payroll start remain distinct; no future `check_in_time`.
- Assignments: no duplicate active dealer/table assignment and no unexpected release.
- Audit/request stores: idempotent replay does not add a second audit row.
- Edge logs: Telegram delivery or warning, correlated by operation ID.
- Cron/bridge: scheduled waiting dealer is promoted at the planned time.

Any missing evidence keeps the release **NOT_READY**.

## Source validation snapshot (2026-07-18)

This snapshot supports review of the source-only PR. It is not production rollout evidence.

- Current repository inventory: 521 migration SQL files, 512 timestamped files, and 24 pre-existing timestamp collision groups. Each new timestamp occurs exactly once. The earlier 510-file planning snapshot is stale.
- A same-task schema-only dump was restored into a disposable PostgreSQL 16 database. Both additive migrations applied cleanly in order and applied cleanly a second time with only expected idempotency notices.
- Check-in, close CAS, reconcile, and inverse-lock-order concurrency SQL suites passed against that disposable database.
- The 20 targeted Dealer Swing unit/component tests, scoped ESLint, scoped TypeScript graph check, Deno notifier check, production build, and both Playwright phone viewports passed.
- Full app `tsc -b` and direct app `tsc` did not finish within the local five-minute budget, so full-project typecheck is `NOT_MEASURED` rather than pass.
- Full Vitest remains red on unrelated baseline cases: the online-poker runtime flag expectation and time-dependent Series/PokerIQ snapshots. Dealer Swing targeted tests are green.

The PR therefore remains **NOT_READY** for enablement. CI and every live-layer gate must still be verified independently after owner review; scoped validation cannot be substituted for production evidence.

## Emergency disable

1. Set `dealer_swing_phone_rollout.master_enabled=false` immediately.
2. Verify direct guarded RPC calls return `rollout_disabled` before making any write.
3. Refresh or wait for the phone rollout poll; completion controls must disappear.
4. Keep desktop fallback available and do not wait for a PR or frontend deployment to stop phone writes.
5. Preserve operation IDs, request rows, audit rows, Edge logs, and the affected TEST records for investigation.

Frontend or Edge rollback can follow after the server write gate is confirmed OFF. Broad rollout remains blocked until the incident is understood and the full gate sequence is repeated.
