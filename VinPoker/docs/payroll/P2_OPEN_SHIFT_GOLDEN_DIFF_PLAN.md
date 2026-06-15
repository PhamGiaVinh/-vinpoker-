# Payroll P2 — open-shift phantom OT fix: golden-period before/after diff

**Patch:** `supabase/migrations/20260906000000_payroll_p2_open_shift_standard.sql`
**Change (ONE expression):** in the attendance loop, the open-shift duration fallback
`COALESCE(check_out_time, now())` → `COALESCE(check_out_time, check_in + standard_hours_per_shift)`.
**Owner policy (2026-06-16):** a shift with no check-out counts as exactly **one standard shift** (regular = standard, OT = 0) — no phantom OT extrapolated to now().
**Run BEFORE any live apply.** Source-only; controlled Management-API apply is owner-gated. NO `db push`, NO `deploy_db`.

## Why
A still-open shift (`check_out_time IS NULL`) computed `now() − check_in`, capped at 24h. For FT, `OT = hours − standard`, so a forgotten checkout grew up to ~16h of phantom OT with wall-clock time. Live 2026-06-16: **all 27 open June shifts** produced phantom OT (every "OT dealer" in the period was phantom).

## Method — dryrun-twin (zero writes)
`BEGIN … ROLLBACK` via Management API: define the NEW body as `calculate_dealer_payroll_p2test`, compare to the LIVE (P0-applied) function on every active FT dealer for a month.

## GOLDEN-DIFF RESULT (2026-06-16, 31 FT dealers, June 2026) — PASS
```
rows=31 · net_negative=0 · base_or_insbase_changed=0 · ot_changed=27 · fully_unchanged=4
```
- **27 open-shift dealers**: phantom OT removed. Open shift → 1 standard shift (8h), OT from it = 0; gross drops by the phantom OT pay; net drops to the correct value.
- **Real OT preserved**: dealer 6a997f44 (open shift + real closed-shift OT): old_ot 26.9h → new_ot **10.9h** — only the 16h phantom is removed, the 10.9h real OT stays.
- **4 dealers with no open shift**: byte-identical (net unchanged).
- **base_salary / bhxh_base unchanged for ALL** → P2 is orthogonal to P0 (open shift still counts as 1 shift for base-salary proration; only OT hours/pay change). No negative net.

## Acceptance (all met)
- Closed-shift-only dealers: gross/ot/net byte-identical.
- Open shift → regular = standard, OT = 0 (no phantom OT).
- Mixed (open + real OT): only the phantom (open) portion removed.
- `base_salary_vnd` and `bhxh_base_vnd` unchanged (no interaction with P0/insurance).
- No `net_pay < 0`.
- No TIPS / PIT-formula / cross-month change (P3 untouched).

## Rollback
Re-apply `20260829000000_payroll_p0_bhxh_base_contract_salary.sql` (the live P0 body) — restores `COALESCE(check_out_time, now())`. Function is a pure calculator → single `CREATE OR REPLACE`, no data implications.
