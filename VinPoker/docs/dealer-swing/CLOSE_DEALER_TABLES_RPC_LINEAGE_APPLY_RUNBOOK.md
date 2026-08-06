# Close Dealer Tables RPC Lineage — Phase 1 Apply Runbook

## Scope and safety

- This is a CRITICAL Dealer Swing change: table state, dealer assignment, attendance, audit rows, and notifications are affected by the guarded RPC.
- Migration: `20270107000002_close_dealer_tables_rpc_lineage_v1.sql`.
- This runbook does **not** repair historical migration ledger rows and does not apply `20261224000000` or `20270102000001` retroactively.
- Phase 1 keeps both existing `close_dealer_tables` overloads. It adds `close_dealer_tables_phone_v1` and moves only the phone client to that name.
- No production apply, flag enablement, frontend deployment, or runtime change is authorized by merging the source PR.

## Why Phase 1 is required

The live phone rollout is configured for an allowlisted club. Even with no recorded close request at the audit cutoff, that is not proof that the six-argument overloaded contract can be removed. The old guarded overload remains until a separate Phase 2 proves that no deployed client or external caller can reach it.

## Owner-gated preflight

During an approved maintenance window, collect read-only evidence without exposing club IDs or request payloads:

1. Confirm `20261224000000` and `20270102000001` are still absent from the migration ledger; do not repair them.
2. Confirm both existing overloads and the new `close_dealer_tables_phone_v1(uuid,uuid,uuid,uuid[],jsonb,boolean)` target signature are present only after the controlled migration apply.
3. Capture function owner, grants, `SECURITY DEFINER`, `search_path`, normalized definition hash, RLS state, and aggregate request counts.
4. Disable the phone runtime master and clear its allowlist before apply. Verify guarded phone calls fail with `rollout_disabled` and write no request, audit, attendance, assignment, or table row.
5. Confirm the desktop three-argument close flow remains separately available.

## Controlled Phase 1 apply

1. Apply only the exact reviewed migration through the owner-approved database workflow.
2. Verify the migration receipt and exact source SHA before any frontend deployment.
3. Verify the new v1 function is `SECURITY DEFINER` with `search_path = pg_catalog, public, extensions`; `authenticated` can execute it and `anon` cannot.
4. Verify `dealer_phone_close_requests` remains RLS-protected and unreadable/unwritable by `authenticated`.
5. Verify both existing overloads remain. This is expected in Phase 1; generated types remain globally blocked until Phase 2 and other lineage clusters are resolved.

## Frontend and TEST UAT gate

1. Deploy the reviewed frontend separately with the source phone flag still OFF.
2. Enable only the owner-approved TEST club through the runtime gate, then confirm the phone sheet calls `close_dealer_tables_phone_v1` for dry-run and apply.
3. Prove stale expected state closes no table.
4. Prove replay returns the stored response and changed replay conflicts.
5. Prove a non-authorized actor, cross-club table, duplicate IDs, and oversized batch fail closed.
6. Confirm the desktop caller still invokes the three-argument `close_dealer_tables` contract.
7. Disable the runtime gate again and retain request/audit evidence for review.

## Rollback

1. Disable the phone runtime master first and verify the server returns `rollout_disabled`.
2. Deploy the prior frontend only if the current bundle calls `close_dealer_tables_phone_v1`.
3. Revoke `authenticated` execute from and drop only `public.close_dealer_tables_phone_v1(uuid,uuid,uuid,uuid[],jsonb,boolean)` as a forward, owner-controlled action.
4. Preserve `dealer_phone_close_requests`, audit rows, the three-argument desktop RPC, and the six-argument compatibility overload.
5. Do not repair migration history or delete operational history.

## Phase 2 entry criteria

- Evidence that no deployed phone client, script, or external caller invokes the six-argument overloaded `close_dealer_tables` name.
- Authenticated TEST UAT of the v1 RPC after the exact frontend deployment.
- Owner approval for a separate migration that drops only the six-argument compatibility overload.
- New official generated-type fixture showing distinct desktop and phone RPC entries before any global type sync.
