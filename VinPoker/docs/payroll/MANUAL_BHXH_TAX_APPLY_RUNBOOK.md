# Payroll manual BHXH + tax override — controlled apply runbook

Owner-gated apply of the per-dealer manual BHXH/tax override. Lets the owner set BHXH
(social insurance) and PIT (thuế TNCN) per dealer — **NULL = auto-compute (no change),
0 = none, >0 = exact amount.** Applying the migrations alone changes **ZERO** payroll
numbers (every dealer's columns are NULL until the owner sets one) — proven by a golden diff.

## What gets applied (two migrations, in order)
1. `20261001000000_dealers_manual_bhxh_tax.sql` — `dealers.manual_bhxh_vnd` + `manual_tax_vnd` (nullable).
2. `20261001000001_payroll_manual_bhxh_tax_override.sql` — `calculate_dealer_payroll` re-authored
   with two guards (BHXH override before taxable income; PIT override after the PIT calc).
   Byte-identical to the live P3 body except those guards (verified by diff).

## Runner
```
scripts/payroll/apply_manual_bhxh_tax.mjs
```
Allowlisted to exactly those two files, safety-scanned each run (col → ADD COLUMN on `dealers`
only; fn → CREATE OR REPLACE `calculate_dealer_payroll` only; refuses DML/DROP/other-table/
other-function/schema_migrations). Runs a **golden before/after diff**: it calls
`calculate_dealer_payroll` for every active dealer (June 2026) BEFORE and AFTER applying, and
asserts net_pay + every deduction is byte-identical (overrides are NULL → no-op). Aborts with a
report if anything moves.

## Credentials (never commit / print)
```
SUPABASE_PROJECT_REF   = <project ref>
SUPABASE_ACCESS_TOKEN  = <Supabase Management API token>
```
No creds → the runner prints the env names and exits 0 (contacts nothing).

## Steps
```bash
# 1) preflight — read-only (columns absent, fn md5, active dealer count)
node scripts/payroll/apply_manual_bhxh_tax.mjs --preflight

# 2) apply — owner-gated. golden BEFORE → apply col → apply fn → golden AFTER (must match) → post-verify
CONFIRM_APPLY_MANUAL_BHXH_TAX=APPLY_MANUAL_BHXH_TAX \
  node scripts/payroll/apply_manual_bhxh_tax.mjs --apply
#    expect: GOLDEN DIFF PASS · cols present=2 · fn SECURITY DEFINER=true · fn md5 changed
```

## After apply
1. Regenerate `src/integrations/supabase/types.ts` (adds `manual_bhxh_vnd` / `manual_tax_vnd`),
   then drop the `as any` casts in `DealerAdjustDialog` / `AddDealerDialog` / `useDealerManagement`.
2. Flip `FEATURES.manualPayrollDeductions` → true → the "Khấu trừ thủ công" inputs appear in the
   dealer edit + create dialogs.
3. Owner UAT: edit a dealer → set BHXH=0 + Thuế=0 → recompute that period → net rises by the
   removed deductions; leave another dealer blank → net unchanged.

## Saved-period safety
The override only affects FUTURE recomputes. Saved/locked payroll periods keep their stored
values (this patch does not recompute them).

## Rollback
- Formula: re-apply `20260909000000_payroll_p3_cross_month_overlap.sql` (the prior P3 body).
- Columns: `ALTER TABLE public.dealers DROP COLUMN IF EXISTS manual_bhxh_vnd; ... manual_tax_vnd;`

## Hard guarantees
```
db push / deploy_db:       NO
schema_migrations write:   NO  (runner never inserts a row)
payroll numbers changed:   NO  (golden diff proves no-op when overrides are NULL)
saved periods recomputed:  NO
```
