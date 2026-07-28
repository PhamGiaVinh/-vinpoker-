# Dealer PT Global Continuous Accrual v2 Rollout

## Scope

`20270106000001_dealer_pt_wage_global_continuous_accrual_v2.sql` is the sole
forward migration for global PT continuous accrual. It supersedes, but never
replays or edits, the historical source-only files:

- `20270105000002_dealer_pt_wage_global_continuous_accrual.sql`
- `20270105000003_dealer_pt_wage_rate_history.sql`

The v2 migration requires the live `20270105000001` baseline and atomically
creates the global control, effective-dated rate history, immutable payout
snapshot contract, readiness guard, and authenticated global mutation grant.
It is dark on apply: no club policy is enabled, no payout is created, and the
future-club default remains `false`.

## Financial Contract

- Enabling captures `effective_from = now()` on the server. Attendance before
  that boundary is never included by the newly enabled continuous policy.
- This removes only the legacy 24-hour cap for active part-time dealers after
  the server boundary. Capped mode remains capped per attendance.
- Every unpaid interval in both modes is valued from server-recorded rate and
  PT-eligibility segments. A later rate change applies only after its recorded
  `effective_from`; disabling continuous mode cannot reprice prior unpaid time.
- Full-time intervals never become PT wages. A transition to part-time starts a
  forward rate-history boundary; a later return to part-time starts another.
- `dealer_pt_wage_payments` remains append-only. This rollout never updates,
  deletes, creates, or backfills a payout.
- A later payout recomputes on the server and writes an immutable policy
  snapshot with attendance, exact segment boundaries, rate, elapsed seconds,
  and amount contribution. An idempotent retry returns the existing receipt.

## Controlled Rollout

1. Run the protected disposable PostgreSQL 16 and 17 workflow against the
   checksummed current public-schema artifact. It proves the pre-v2 baseline
   has no global mutation path, then proves the exact request succeeds after
   v2. It also runs lifecycle, ACL, idempotency, immutable-payout, and
   concurrency SQL suites.
2. Use the protected manual workflow
   `.github/workflows/dealer-pt-wage-global-continuous-accrual-apply.yml`.
   It has no operator-selectable source SHA: it checks out the exact payroll
   merge `c3457d4cbd1c0b7f54917f629d15efef3637f5b9` and runs a read-only
   preflight before its separately confirmed apply mode. The runner sends only
   the named v2 migration through the Management API; it never uses broad CLI
   migration commands.
3. Apply exactly:
   `20270106000001_dealer_pt_wage_global_continuous_accrual_v2.sql`.
   Do not use `supabase db push`, `--include-all`, historical replay, or either
   superseded `00002`/`00003` file.
4. Verify the global policy row has `future_club_enabled=false`, all direct
   policy/rate tables remain denied to `authenticated`, both global RPC
   signatures have authenticated execute but no anon execute, and every active
   PT dealer has a rate-history baseline.
5. With a TEST super-admin session, call the global RPC inside a transaction
   and roll it back. Compare derived PT balances without logging dealer names
   or IDs. Confirm a long open attendance is no longer capped and payment-row
   counts are unchanged.
6. Commit the same authenticated RPC only after owner approval. The one
   transaction enables every currently approved club and the future-club
   default, with audit rows for every changed club.
7. UAT one open PT dealer, one historical checked-out PT dealer, an idempotent
   payout retry, a post-activation rate change, and a newly approved TEST club.
   Monitor payment writes separately: policy enablement itself must create none.

## Emergency Rollback

Call `set_all_approved_dealer_pt_wage_accrual(false, <audit reason>)` through
the authenticated super-admin path. It restores the 24-hour cap for current
approved clubs and disables automatic enablement for clubs approved later. It
does not alter an already written payout; any correction remains append-only.
