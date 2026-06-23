# Salary-B1 — PT Wage Backend: golden-diff & apply plan (source-only)

**Status:** source-only, NOT applied. Apply is a separate owner-gated controlled op.
Objects (migrations `20261028000000` + `20261028000001`):
- table `dealer_pt_wage_payments` (immutable ledger) + 2 RLS SELECT policies (operator + dealer-self)
- `_pt_wage_balance(uuid)` (private helper; derived balance)
- `get_my_pt_wage(uuid)` (dealer self; ownership-checked)
- `get_club_pt_wages(uuid)` (operator read)
- `pay_part_time_balance(uuid,text,text,text,text)` (operator pay + reset; actor=auth.uid())
- `get_club_finance_summary` v4 (CREATE OR REPLACE; adds PT payouts to cost)

## Must-pass golden diff (before any apply)
1. **Finance summary no-op when no PT payouts.** On a known club + range with zero rows in
   `dealer_pt_wage_payments`, v4 output == v3 output **byte-identical except** the new
   `cost.ptWagePaid` = 0 (and `cost.payrollNet` unchanged because pt_pay sum = 0). Verify via a
   BEGIN…ROLLBACK twin (define v3 and v4 in two schemas / compare `pg_get_functiondef` outputs
   against the same inputs). revenue / net / perClub / trend identical.
2. **Finance summary with a PT payout.** Insert one ledger row (in a rolled-back tx), confirm
   `cost.ptWagePaid` = amount, `cost.payrollNet` += amount, `net` -= amount, and the matching
   month in `trend.cost` and the club in `perClub.cost` each += amount. Cash basis = `paid_at`.

## pay_part_time_balance — required behaviours (test at apply)
- **Actor = auth.uid()** — no `p_paid_by` param; ledger `paid_by/created_by` = caller.
- **Authz** — super_admin / club_admin / club owner / club cashier of the dealer's club only;
  a non-authorized user → `42501`. PT-only (`employment_type='part_time'`).
- **Double-pay race** — two concurrent calls: `pg_advisory_xact_lock('pt_wage:'||dealer)` serializes
  them; exactly **one** ledger row + one reset; the second sees balance 0 (or the idempotent row).
- **Idempotency** — same `(dealer_id, idempotency_key)` retried → returns the prior payout
  (`idempotent:true`), no second insert, no second reset (`UNIQUE(dealer_id, idempotency_key)`).
- **Reject ≤ 0** — balance 0 → `P0001` ("Số dư bằng 0…"), no row written.
- **Server recompute** — amount is computed by `_pt_wage_balance` at call instant; any client
  amount is ignored (there is no client amount param).
- **Audit** — one `payroll_audit_log` row per payout (action INSERT, club_id set, reason).
- **Reset anchor** — `covered_to = now()`; next balance accrues from there. Mid-shift pay
  (check-in 18:00, pay 21:00, shift still open) → next balance counts from 21:00, not 18:00.

## Dealer self-read — required behaviours
- `get_my_pt_wage(p_dealer_id)` returns data ONLY when `dealers.user_id = auth.uid()` for that
  `p_dealer_id`; cross-dealer / anon → `42501`. `calculate_dealer_payroll` is never exposed.
- RLS: a plain `authenticated` dealer can SELECT only their own `dealer_pt_wage_payments` rows;
  cross-dealer + anon denied; operator policy unaffected.

## Balance math (mirror of payroll worked-minutes)
Per attendance row since the anchor: `min(coalesce(check_out, now), now) − max(check_in, anchor)`,
clamped ≥0 and ≤ 24h/shift; × rate/60 (rate floored at 50,000đ/h). **Divergence from monthly
payroll, intentional:** the current OPEN shift accrues to `now()` (live tick) instead of the P2
standard-hours cap — bounded by the 24h/shift cap.
**Known golden-diff item:** break-deduction parity. Monthly payroll deducts unpaid breaks for
clubs in `unpaid_break_with_grace` / `unpaid_break_full` mode; this first B1 balance does NOT.
All live clubs are `paid_break` (no deduction) so it is a no-op today — but before enabling PT pay
for a club in an unpaid_break mode, add the same break clamp/merge/grace to `_pt_wage_balance`
and re-verify.

## Apply runbook (owner-gated)
Management API controlled op: create table + policies + functions → verify
`pg_get_functiondef` / grants (`authenticated` only; `_pt_wage_balance` revoked from all roles) /
SECURITY DEFINER / `search_path=public` / RLS enabled → run golden diff (1) and (2) →
regen `types.ts` (separate PR) → only then wire Salary-C/D UI. **NO `supabase db push`, NO
deploy_db, NO schema_migrations edit.** Flags stay OFF until UAT. Rollback: drop the new
functions/table and CREATE OR REPLACE `get_club_finance_summary` back to the v3 (20260916000000) body.
