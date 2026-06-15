# Payroll P0 — BHXH base fix: golden-period before/after diff plan

**Patch:** `supabase/migrations/20260829000000_payroll_p0_bhxh_base_contract_salary.sql`
**Change:** social-insurance base `LEAST(v_gross_pay_vnd, cap)` → `LEAST(v_base_salary_vnd, cap)` — i.e. the FT base salary (already prorated by attendance), which **excludes OT, bonus and tips** but keeps proration.
**Run this BEFORE any live apply.** Source-only until the golden diff is reviewed + owner approves the controlled apply (Management-API only; NO `db push`, NO `deploy_db`).

> **GOLDEN-DIFF RESULT (2026-06-15, dryrun-twin, 31 FT dealers, June 2026, zero writes):**
> - First attempt used **full unprorated `monthly_salary_vnd`** as the base → **FAIL**: net pay went **NEGATIVE** for partial-month / low-shift dealers (1 shift, gross 346k, but BHXH on 9M = 945k → net −598,847). Regression worse than the bug. Owner chose the prorated-base fix.
> - Final formula **`v_base_salary_vnd`** → **PASS**: `net_negative=0`, `invariant_violated=0`, 21/31 dealers (those with OT) get a lower insurance base (OT removed) → insurance down → net up; 10/31 (no OT) **unchanged**. gross/base/OT byte-identical for all. PIT unchanged (sample all below the 11M threshold).

## Cascade to be aware of
Insurance feeds taxable income → PIT → net. So the patch changes **three** outputs:
`bhxh/bhyt/bhtn` (down for OT cases) → `taxable_income` (up) → `pit` (up a little) → `net_pay`.
Net change per dealer = **(insurance decrease) − (PIT increase)**; net should generally **rise** for FT-with-OT (insurance drop > PIT rise). `base_salary_vnd`, `ot_pay_vnd`, `gross_pay_vnd`, `regular/ot_hours`, `total_shifts` must be **byte-identical** (the patch does not touch the pay calc).

## Method — dryrun-twin (same-instant old vs new, zero persistence)
Run inside one `BEGIN … ROLLBACK` via the Management API (nothing is written). Define the NEW body under a temp name, then compare to the LIVE function on the same dealers/period:

```sql
BEGIN;
-- 1) temp copy of the NEW function under a distinct name (paste the migration body but
--    rename the function to calculate_dealer_payroll_p0test).
CREATE OR REPLACE FUNCTION public.calculate_dealer_payroll_p0test(p_dealer_id uuid, p_start_date date, p_end_date date, p_dependents integer DEFAULT 0)
  RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path TO 'public'
AS $f$ /* …full NEW body from the migration… */ $f$;

-- 2) compare live (old) vs p0test (new) for every active FT dealer of a club + month
WITH d AS (
  SELECT id FROM public.dealers WHERE status='active' AND employment_type='full_time'
    AND club_id = :p_club_id
), o AS (
  SELECT id, public.calculate_dealer_payroll(id, :p_start, :p_end) AS j FROM d
), n AS (
  SELECT id, public.calculate_dealer_payroll_p0test(id, :p_start, :p_end) AS j FROM d
)
SELECT o.id,
  (o.j->>'ot_hours')::numeric              AS ot_hours,
  (o.j->>'gross_pay_vnd')::bigint          AS gross,
  (o.j->>'bhxh_base_vnd')::bigint          AS old_ins_base,
  (n.j->>'bhxh_base_vnd')::bigint          AS new_ins_base,
  (o.j->>'bhxh_deduction_vnd')::bigint + (o.j->>'bhyt_deduction_vnd')::bigint + (o.j->>'bhtn_deduction_vnd')::bigint AS old_insurance,
  (n.j->>'bhxh_deduction_vnd')::bigint + (n.j->>'bhyt_deduction_vnd')::bigint + (n.j->>'bhtn_deduction_vnd')::bigint AS new_insurance,
  (o.j->>'pit_deduction_vnd')::bigint      AS old_pit,
  (n.j->>'pit_deduction_vnd')::bigint      AS new_pit,
  (o.j->>'net_pay_vnd')::bigint            AS old_net,
  (n.j->>'net_pay_vnd')::bigint            AS new_net,
  -- invariants that MUST NOT change:
  ((o.j->>'gross_pay_vnd') IS DISTINCT FROM (n.j->>'gross_pay_vnd')) AS gross_changed,
  ((o.j->>'ot_pay_vnd')    IS DISTINCT FROM (n.j->>'ot_pay_vnd'))    AS ot_changed,
  ((o.j->>'base_salary_vnd') IS DISTINCT FROM (n.j->>'base_salary_vnd')) AS base_changed
FROM o JOIN n USING (id)
ORDER BY (n.j->>'net_pay_vnd')::bigint - (o.j->>'net_pay_vnd')::bigint DESC;
ROLLBACK;
```

### Acceptance
- `gross_changed`, `ot_changed`, `base_changed` = **false** for ALL rows (pay calc untouched).
- Dealers **with OT** (`ot_hours > 0`): `new_ins_base = base_salary < old_ins_base` (OT removed) → `new_insurance < old_insurance` → `new_net ≥ old_net`.
- Dealers **no OT** (any attendance, incl. partial month): `new_ins_base = base_salary = gross = old_ins_base` → insurance + net **unchanged** (because with no OT, base_salary == gross).
- Dealers **0 shifts**: `new_ins_base = base_salary = 0` → insurance 0 (no over-deduction, no negative net).
- **No dealer may have `new_net < 0`** (the rule that killed the full-monthly_salary variant).

## Required unit/golden cases
| Case | Setup | Expect (new) |
|---|---|---|
| A | FT, monthly 20M, full month, OT 5M (gross 25M) | ins_base = **base_salary 20M** (OT 5M excluded); insurance = 10.5% × 20M = 2,100,000 |
| B | FT, monthly 20M, partial month (e.g. 15/26 shifts, no OT, base ≈ 11.5M) | ins_base = **base_salary ≈ 11.5M** (= gross when no OT); **NOT** 20M — full salary would push low-shift dealers to negative net |
| C | FT, monthly 20M, full month, bonus 3M + tips 1M | ins_base = **base_salary 20M** (bonus/tips never in base) |
| D | FT, monthly 60M (> cap), full month | ins_base = **46,800,000** (base 60M capped) |
| E | FT, 0 shifts in period | ins_base = **base_salary 0**, insurance = 0 |

After apply: re-run the read-only comparison vs the captured pre-apply snapshot (or vs a saved golden period), confirm the acceptance rules, then keep policies/data unchanged. **schema_migrations** recording optional (the function is the only object). Rollback if any invariant (`gross/ot/base`) changed.
