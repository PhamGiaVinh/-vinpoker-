# Payroll P0 — BHXH base fix: golden-period before/after diff plan

**Patch:** `supabase/migrations/20260829000000_payroll_p0_bhxh_base_contract_salary.sql`
**Change:** social-insurance base `LEAST(v_gross_pay_vnd, cap)` → `LEAST(monthly_salary_vnd-when-worked, cap)`.
**Run this BEFORE any live apply.** Source-only until the golden diff is reviewed + owner approves the controlled apply (Management-API only; NO `db push`, NO `deploy_db`).

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
- Dealers **with OT** (`ot_hours > 0`): `new_ins_base < old_ins_base` (OT removed) → `new_insurance < old_insurance` → `new_net ≥ old_net`.
- Dealers **no OT, full month**: `new_ins_base = monthly_salary = old_ins_base` (≈ unchanged) → insurance ~unchanged.
- Dealers **partial month** (prorated gross < monthly_salary): `new_ins_base = monthly_salary > old_ins_base` → insurance **up** (now on contractual base, per policy) — confirm this matches owner intent.
- Dealers **0 shifts**: `new_ins_base = 0` → insurance 0 (no over-deduction).

## Required unit/golden cases
| Case | Setup | Expect (new) |
|---|---|---|
| A | FT, monthly 20M, OT 5M (gross 25M) | ins_base = **20M** (not 25M); insurance = 10.5% × 20M = 2,100,000 |
| B | FT, monthly 20M, partial month (gross 12M, no OT) | ins_base = **20M** (contractual, not 12M) |
| C | FT, monthly 20M, bonus 3M + tips 1M | ins_base = **20M** (bonus/tips never in base) |
| D | FT, monthly 60M (> cap) | ins_base = **46,800,000** (capped) |
| E | FT, 0 shifts in period | ins_base = **0**, insurance = 0 |

After apply: re-run the read-only comparison vs the captured pre-apply snapshot (or vs a saved golden period), confirm the acceptance rules, then keep policies/data unchanged. **schema_migrations** recording optional (the function is the only object). Rollback if any invariant (`gross/ot/base`) changed.
