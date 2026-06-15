# Payroll P4b — Insurance Participation Layer (DESIGN — not code)

**Status:** design spec (owner-authored 2026-06-16). No migration, no code, no DB change in this doc.
**Supersedes the naive P4b** ("change BHTN cap 46.8M → 20× regional min wage for everyone"), which is WRONG because it assumes every dealer participates in social insurance.

## Core principle — two separate layers
Payroll has **two independent layers** that must not be conflated:

1. **Cash / operational pay** — shift pay, OT, bonus, deduction, net cash. (P0/P1/P2 all live here.)
2. **Statutory insurance** — BHXH / BHYT / BHTN, only for dealers who actually participate.

**Reality at VinPoker:** most dealers are **cash-only** and do NOT pay BHXH/BHYT/BHTN. Only official staff and some big-series personnel are insured. So the current function — which computes insurance for **every** FT dealer — is itself wrong for cash-only dealers (it invents deductions that don't exist). The cap is a side issue; **participation** is the real fix.

## Business rule (owner, 2026-06-16)
```
Default dealer at a club:        insurance_mode = NONE  → BHXH = BHYT = BHTN = 0 (no cap applies)
Official staff / big series:     insurance_mode = STATUTORY or SERIES_ONLY → compute per profile
BHTN is computed ONLY when insurance_mode != NONE
BHTN cap = 20 × regional minimum wage (NOT the BHXH ceiling 46.8M)
Staking / tips / cash bonus are NOT insurance-relevant unless folded into insurance_salary
```

## Statutory reference (snapshot these — do not hardcode)
- BHTN max contribution base = **20 × monthly regional minimum wage** (Việc làm 2025).
- Regional minimum wage from **01/01/2026**: Vùng I 5,310,000 · II 4,730,000 · III 4,140,000 · IV 3,700,000 đ/tháng.
- → **BHTN cap 2026**: Vùng I **106,200,000** · II **94,600,000** · III **82,800,000** · IV **74,000,000**.
- BHXH/BHYT ceiling (20× base salary) stays as today for STATUTORY dealers (46.8M unless updated).
- Employee rates: BHXH 8% · BHYT 1.5% · BHTN 1% (employer rates separate, for reporting).

## Data model (proposed)
### `dealer_insurance_profiles`
```
dealer_id            uuid    -- FK dealers
effective_from       date
effective_to         date    nullable (open = current)
insurance_mode       text    -- NONE | STATUTORY | SERIES_ONLY
insurance_salary_vnd bigint  -- the registered insurance salary (may differ from monthly_salary_vnd)
region_code          text    -- I | II | III | IV
applies_to_club_id   uuid    nullable
applies_to_series_id uuid    nullable  -- for SERIES_ONLY
notes                text
```
Default: a dealer with NO active profile row ⇒ treated as `NONE`.

### `insurance_policy_rates` (law snapshot, versioned by effective date)
```
effective_from       date
effective_to         date    nullable
region_code          text    -- I | II | III | IV
regional_min_wage_vnd bigint
bhtn_cap_vnd         bigint  -- = 20 × regional_min_wage_vnd
bhxh_cap_vnd         bigint
bhyt_cap_vnd         bigint
employee_bhxh_rate   numeric -- 0.08
employee_bhyt_rate   numeric -- 0.015
employee_bhtn_rate   numeric -- 0.01
employer_bhxh_rate   numeric
employer_bhyt_rate   numeric
employer_bhtn_rate   numeric
```
**Critical:** payroll must read the rate row whose effective window covers the **payroll period**, and the chosen values must be **snapshotted onto the saved payroll record** — so a later law change never silently recomputes a closed period. (Same discipline as "saved values are stored values".)

## Function change (`calculate_dealer_payroll`) — split into 2 patches
**P4b-1 — insurance_mode guard (the real fix):**
- Resolve the dealer's active `insurance_mode` for the period (default NONE).
- `NONE` ⇒ BHXH = BHYT = BHTN = 0, insurance_base = 0 (regardless of salary). This corrects cash-only dealers.
- `STATUTORY` / `SERIES_ONLY` ⇒ compute as today, base = `v_base_salary_vnd` (P0) capped per layer.
- Output `insurance_mode` in the JSON so the UI can show "Không tham gia bảo hiểm → 0".

**P4b-2 — region-aware BHTN cap:**
- For participating dealers, BHTN base cap = `bhtn_cap_vnd` from the period's `insurance_policy_rates` (20× regional min wage), NOT the BHXH ceiling.
- BHXH/BHYT keep their own ceiling.

Each patch = source-only → **golden-period before/after diff** → owner-gated controlled apply (the P0/P2 protocol). Acceptance for P4b-1: dealers with no profile ⇒ all insurance = 0 and net rises accordingly; STATUTORY dealers unchanged vs today except where the region cap differs.

## UI (later, after RPC live)
**Dealer profile** — insurance block:
```
[ ] Không tham gia bảo hiểm        (NONE)
[ ] Có BHXH/BHYT/BHTN              (STATUTORY)
[ ] Chỉ áp dụng cho series lớn     (SERIES_ONLY)
Vùng lương tối thiểu: I / II / III / IV
Lương làm căn cứ bảo hiểm: [______] VND
```
**Payroll detail** — show cash layer and insurance layer separately; when NONE: `Không tham gia bảo hiểm trong kỳ này → BHXH/BHYT/BHTN = 0` (so operators don't think it's a bug).
**Series** — `series_insurance_enabled`, `series_region_code`, `covered_dealers`, `coverage_start/end`; payroll for a series period computes insurance only for covered dealers.

## Phasing (suggested)
1. P4b-1a (DB): tables + seed `insurance_policy_rates` (2026 region rows) — additive, no behavior change.
2. P4b-1b (RPC): `insurance_mode` guard in `calculate_dealer_payroll` (default NONE) → golden diff → apply.
3. P4b-2 (RPC): region BHTN cap for participants → golden diff → apply.
4. UI: dealer-profile insurance block + payroll-detail two-layer view.
5. Series override.

**Risk note:** P4b-1b flips most dealers' insurance to 0 — a large, intended change to net pay. It MUST be golden-diffed and owner-reviewed before apply (bigger impact than P0/P2). Do NOT bundle with P3.
