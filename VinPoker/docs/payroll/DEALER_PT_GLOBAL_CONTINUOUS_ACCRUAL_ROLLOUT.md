# Dealer PT Global Continuous Accrual Rollout

## Scope

`20270105000002_dealer_pt_wage_global_continuous_accrual.sql` extends the
already-live per-club PT wage policy. It adds a super-admin-only server RPC to
set every `approved` club to the same continuous-accrual policy from the
server-captured activation instant and remembers the default for clubs approved
later.

`20270105000003_dealer_pt_wage_rate_history.sql` records PT hourly rates at
their server-effective time. A future rate edit therefore affects only time
after that edit, never previously worked time or a paid receipt.

The migration is dark on apply. It does not change a club policy, a balance, or
a payment until `set_all_approved_dealer_pt_wage_accrual` is called by an
authenticated super admin with a non-empty audit reason.

## Financial Contract

- Enabling captures `effective_from = now()` on the server. Attendance before
  that boundary is not included in the newly derived unpaid balance.
- This removes only the legacy 24-hour cap for active part-time dealers.
- `dealer_pt_wage_payments` remains append-only. This rollout never updates,
  deletes, or creates a payout.
- A later payout recomputes on the server and writes its immutable policy
  snapshot, including the effective-dated rate segments used by a continuous
  balance. An idempotent retry returns its existing receipt.
- Already-paid payouts and unpaid time before the activation boundary are not
  backfilled by this policy. Any correction to those periods requires a
  separate append-only adjustment workflow.
- Existing paid rates stay exactly as written in their payout rows. Existing
  unpaid time remains outside the new policy; only a rate change after the
  activation boundary creates another forward rate segment.

## Controlled Rollout

1. Apply these exact migrations, in this order, after current-schema
   apply/reapply evidence:
   - `20270105000002_dealer_pt_wage_global_continuous_accrual.sql`
   - `20270105000003_dealer_pt_wage_rate_history.sql`
   Do not use `supabase db push`, `--include-all`, or historical replay.
2. Verify the global policy row is `future_club_enabled=false`, all direct
   policy/rate tables remain denied to `authenticated`, both new RPC signatures
   have `authenticated` execute but no `anon` execute, and every current PT
   dealer has a rate-history baseline.
3. With a TEST super-admin session, run the global RPC in a transaction and
   roll it back. Compare derived PT balances before and after without logging
   dealer names or IDs. Confirm a long open attendance is no longer capped and
   payment-row counts are unchanged.
4. Commit the same authenticated RPC only after owner approval. The one
   transaction enables every currently `approved` club and the future-club
   default, with audit rows for every changed club.
5. UAT one open PT dealer, one historical checked-out PT dealer, an
   idempotent payout retry, a post-activation rate change, and a newly approved
   TEST club. Monitor payment writes separately: policy enablement itself must
   create none.

## Emergency Rollback

Call `set_all_approved_dealer_pt_wage_accrual(false, <audit reason>)` through
the authenticated super-admin UI. It restores the 24-hour cap for current
approved clubs and disables automatic enablement for clubs approved later. It
does not alter an already written payout; any post-payment correction remains
append-only.
