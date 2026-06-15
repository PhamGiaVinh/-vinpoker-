# Payroll P4b — Insurance Participation Layer — Phase 1 rollout

**Design:** see `docs/payroll/P4b_INSURANCE_PARTICIPATION_LAYER_DESIGN.md`.
**Phase 1 = config schema only.** No payroll-number change, no `calculate_dealer_payroll` change, no DB apply in the PR.

## Why a participation layer (not a cap change)
Most VinPoker dealers are **cash-only** and do not participate in BHXH/BHYT/BHTN. Only official staff / large-series personnel do. So insurance must be opt-in per dealer — never auto-applied. Phase 1 lays the data foundation; the formula stays untouched until P4b-3.

## Phase 1 deliverables (this PR — source only)
| File | What |
|---|---|
| `supabase/migrations/20260910000000_payroll_p4b_insurance_layer_phase1.sql` | 2 additive tables + RLS + triggers + indexes + grants. No data, no function change. |
| `docs/emergency_rollbacks/PRE_P4b_PHASE1_20260910000000.sql` | rollback = `DROP TABLE` the 2 new tables (safe, unreferenced) |
| `scripts/payroll/seed_insurance_policy_rates_2026.sql` | **guarded** 2026 region rates — owner-applied separately, NOT in the migration |
| `docs/payroll/P4b3_FORMULA_GOLDEN_DIFF_PLAN.md` | golden-diff plan for the future formula patch |
| `src/types/insurance.ts` | hand-written, source-aligned TS row types (no UI) |

### Schema summary
**`insurance_policy_rates`** (statutory law snapshot, versioned by `effective_from`/`effective_to`, unique per `region_code, effective_from`): `regional_min_wage_vnd`, `bhtn_cap_vnd` (= 20 × min wage), `bhxh_cap_vnd`, `bhyt_cap_vnd`, employee/employer rates for BHXH/BHYT/BHTN, `source_note`. RLS: read = any authenticated; write = super_admin / service_role.

**`dealer_insurance_profiles`** (per-dealer participation): `dealer_id`, `club_id`, `series_id?`, `effective_from`/`effective_to`, `insurance_mode` (**NONE** default | STATUTORY | SERIES_ONLY), `insurance_salary_vnd?`, `region_code?`, `include_bhxh/bhyt/bhtn`, `created_by`. Constraints: SERIES_ONLY requires `series_id`; one OPEN non-series profile per dealer+club. RLS: club admin/owner/super_admin manage their club; dealer self-read; service_role.

## Phase boundaries
- **P4b-1 (this PR):** config schema only. **Changes no payroll numbers.** ← Phase 1
- **P4b-2:** dealer-profile / series-coverage UI (read+write the new tables). No formula change.
- **P4b-3:** the formula patch (`calculate_dealer_payroll`) — guards insurance by `insurance_mode` + region BHTN cap. **This is the only phase that changes net pay**, and is gated by a mandatory golden diff (see `P4b3_FORMULA_GOLDEN_DIFF_PLAN.md`).

> The decision **"missing profile ⇒ NONE vs legacy behavior"** is made in P4b-3, deliberately **not** in Phase 1.

## Owner-gated apply (later, controlled)
1. Verify slot `20260910000000` free; confirm `calculate_dealer_payroll` md5 unchanged (ce2d4c7…).
2. Apply the migration via Management-API (CREATE TABLE …) — additive, no payroll impact.
3. Optionally apply `seed_insurance_policy_rates_2026.sql` (confirm figures first).
4. NO `supabase db push`, NO `deploy_db=true`, schema_migrations untouched.

## Safety (Phase 1)
`calculate_dealer_payroll` untouched · no payroll number change · no seed in migration · DB apply NO · db push NO · deploy_db NO · schema_migrations untouched · no Tracker/Swing/Cashier/Online-Poker/Finance/GTO change.
