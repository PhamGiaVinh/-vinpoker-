# Salary-B0 — PT Wage Payout × Finance Integration Audit (read-only)

**Status:** reviewed — decision locked (Option B). **Docs-only**, no code/migration/RPC.
**Date:** 2026-06-23. **Source of truth:** `origin/main` (read-only inspection).
**Purpose:** decide exactly how an ad-hoc **part-time wage payout** ("pay the accrued PT
balance, then reset to 0") is recorded so it is **visible in the Owner Finance Dashboard**,
and map the dealer self-read surface — before any backend (Salary-B1) is written.

This gates Salary-B1. It does **not** authorize any migration, RPC, or live apply.

---

## 1. Findings (origin/main)

### 1.1 `payment_records` cannot hold an ad-hoc PT payout
`payment_records` (mig `20260819000005_payroll_payment_lifecycle_pl1.sql`):
- `period_id UUID **NOT NULL** REFERENCES payroll_periods(id)`
- unique constraint `uq_payment_records_period` → **one record per monthly period**.

A PT live-wage payout is **not** tied to a monthly `payroll_periods` row, so it cannot be
inserted into `payment_records` without making `period_id` nullable + breaking the
one-record-per-period invariant and refactoring the live lifecycle RPCs. **Rejected.**

### 1.2 Payment-lifecycle RPCs are period-bound
`prepare_payroll_payment` / `mark_payroll_paid` / `reconcile_payroll_payment` all take
`p_period_id` and drive `payroll_periods.status` (locked → payment_prepared → paid →
reconciled) + the single `payment_records` row. Not reusable for an ad-hoc per-dealer PT
payout without generalizing the period requirement. **Do not modify them.**

### 1.3 What the Owner Finance Dashboard actually sums
`get_club_finance_summary` (mig `20260826000000`, later v3 for service fee):
- payroll **cost** = `SUM(dealer_payroll.net_pay_vnd)` (+ gross + adjustments) aggregated by
  `payroll_periods` (CTE `period_agg` → `period_eff`).
- `payment_records` is read **only for payment status** (prepared/paid/reconciled) — it is
  **not** itself summed as cost.

⇒ A PT payout must be added as an **explicit cost source** in this summary; it will not
appear just by writing a row somewhere.

### 1.4 Dealer self-read RLS (to confirm in B1)
| table | dealer self-read today | note |
|---|---|---|
| `dealers` | reads own rate/salary (`auth.uid()=user_id`) — **reported inconsistently** | confirm exact policy text in B1 |
| `dealer_attendance` | own rows — **reported inconsistently** | confirm in B1 |
| `dealer_payroll` | **NO** | club-scoped via `club_members.player_user_id`, not dealer identity |
| `payroll_periods` | **NO** | club-scoped |
| `payroll_adjustments` | **NO** | inherits dealer_payroll club scope |
| `payment_records` | **NO** | super_admin / club_admin / club_cashier only |

`calculate_dealer_payroll` has **no `auth.uid()` guard** → must **never** be exposed to dealers.
Dealer-self reads will go through new `auth.uid()`-scoped `SECURITY DEFINER` RPCs, not broad RLS.

### 1.5 Attendance worked-minute logic to mirror
From `calculate_dealer_payroll` (P2 open-shift fix `20260906000000`, P3 cross-month
`20260909000000`): per attendance row, worked time =
`COALESCE(check_out_time, check_in_time + standard_hours_per_shift * interval '1 hour') - check_in_time`,
clamped `LEAST(…, 24h)`, minus break deduction (B2 policy), VN-tz absolute timestamps.
The PT "minutes since last reset" must reuse this exact shape so PT accrual == payroll.

---

## 2. DECISION — Option B (locked)

**Record PT payouts in a dedicated immutable ledger, and extend the finance summary to
include it.** Do **not** touch `payment_records`.

1. New table **`dealer_pt_wage_payments`** (immutable): `id, dealer_id, club_id,
   amount_vnd int, minutes_paid int, covered_from timestamptz, covered_to timestamptz,
   paid_by uuid, created_by uuid, created_at, payment_method, payment_reference,
   payment_record_id uuid NULL (reserved/unused under Option B), voided_at/voided_by,
   audit_note`. Use **minutes_paid** (not decimal hours). Idempotency guard.
2. **Extend `get_club_finance_summary`** to also `SUM(dealer_pt_wage_payments.amount_vnd)`
   (paid, in range, not voided) into the payroll/payout cost (`payrollNet`) so PT pay-reset
   is visible to the owner. This extension is part of B1 and must be golden-diff verified
   (no change to existing numbers when there are no PT payments).
3. **Reset semantics**: the dealer's reset anchor = `MAX(covered_to)` (fallback: first
   attendance / joined_date). Accrued balance is *derived* from attendance since the anchor;
   a full payment writes a ledger row and advances the anchor. Saved ledger rows are
   immutable (business reversal only via `voided_at/voided_by`).

**Why not the alternatives:** Option A (nullable `period_id` + payout-kind on `payment_records`)
breaks the one-record-per-period invariant and forces refactoring the LIVE lifecycle RPCs.
Option C (synthetic `payroll_periods`) pollutes period selectors and is hard to audit.

---

## 3. Non-negotiables carried into Salary-B1
- `pay_part_time_balance`: actor = `auth.uid()` (no client `p_paid_by`); per-dealer advisory
  lock (`pg_advisory_xact_lock(hashtext('pt_wage:'||dealer))`) before recompute/insert/reset;
  server-recompute the amount (ignore any client amount); reject balance ≤ 0; write
  `payroll_audit_log`; authz = club owner/admin/cashier (reuse lifecycle pattern).
- Dealer-self RPCs take `p_dealer_id` and verify `dealers.user_id = auth.uid()` (multi-club).
- Every RPC: `SECURITY DEFINER`, `SET search_path = public`, `REVOKE ALL … FROM PUBLIC`,
  `GRANT EXECUTE … TO authenticated`; anon denied; resolve `club_id` from the dealer.
- Migrations **source-only**, flags **OFF**, owner-gated apply, types regen before UI wiring.

## 4. Open items
- Confirm the exact dealer-self RLS policy text for `dealers` / `dealer_attendance` on
  `origin/main` during B1 (two prior audits disagreed). Frontend reads go via RPC regardless.

## 5. Next
Salary-B1 (separate branch/worktree, source-only): the ledger + RPCs + the
`get_club_finance_summary` extension above, with auditors (`db-safety` + `rls-security`) before
PR-ready. **Do not start until this B0 is reviewed.**
