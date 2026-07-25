# Dealer PT Standby Accrual Rollout

## Scope

This rollout affects only active **part-time dealers**. It pays the time from
dealer check-in to check-out, including time waiting in the dealer pool. It
does not change full-time dealer payroll or staff payroll, which use separate
contracts and require their own evidence.

The default remains the legacy 24-hour cap. The owner must explicitly enable
the policy per club after the migration, preflight, and TEST-club UAT pass.

## Financial Rules

- No saved payout is recalculated, edited, or deleted.
- A policy with `effective_from = NULL` covers all unpaid attendance from the
  latest non-voided payout's `covered_to` onward. This is the controlled option
  for correcting a long-running open attendance such as the current test.
- A non-null `effective_from` only covers unpaid time from that timestamp.
- `pay_part_time_balance` remains the only payment writer. It recomputes the
  amount server-side, holds the club-policy and dealer locks, and returns the
  existing receipt on an idempotent replay.
- New payouts keep an immutable `accrual_policy_snapshot`. Legacy payout rows
  remain untouched and have a NULL snapshot rather than being reinterpreted.

## Controlled Apply

1. Owner confirms the PR merge SHA and keeps frontend/feature settings unchanged.
2. Capture the current definitions, ACLs, policy-table absence, and a count of
   active PT dealer attendance per club. Do not check dealers out as part of
   this rollout.
3. Restore the current schema to a disposable PostgreSQL database. Apply only
   `20270105000001_dealer_pt_standby_accrual_policy.sql`, apply it a second time,
   then run `supabase/tests/dealer_pt_standby_accrual_policy.sql`.
4. In the owner-controlled database window, apply that one exact migration.
   Do not use `supabase db push`, `--include-all`, migration replay, or a reset.
5. Verify the four RPC signatures, `authenticated`/`anon` grants, direct table
   denial, default-off policy state, and that no existing payment changed.
6. Perform a TEST-club dry run in a transaction: insert or update the policy,
   read the before/after derived balance, and roll back. The comparison must
   match the selected effective boundary before any commit.
7. Owner enables the policy for one TEST club through
   `set_dealer_pt_wage_accrual_policy`, with a non-empty reason. Use
   `effective_from = NULL` only after confirming the owner intends to include
   every unpaid minute since the last payout anchor.
8. UAT one open dealer, one checked-out dealer, a payout/retry, and the dealer
   salary screen. Confirm that the balance ticks after refresh, check-out stops
   accrual, no prior payment changes, and a retry cannot pay twice.
9. Review the same evidence for every production club before enabling it. The
   policy is per club; there is no global hidden switch.

## Rollback

Call `set_dealer_pt_wage_accrual_policy` with `false`, `NULL`, and an audit
reason. This immediately restores the 24-hour cap for future balance reads.
It does not modify payments already written. A financial correction after a
payment must be a separate append-only adjustment workflow.

## Production Evidence Required

- Exact migration checksum and a successful current-schema apply/reapply.
- ACL/RLS proof for the policy table and all five PT wage RPCs.
- Per-club before/after balance golden diff with no raw personal data in logs.
- One TEST-club live UAT, including a payment idempotency replay.
- Owner approval before each production-club enablement.
