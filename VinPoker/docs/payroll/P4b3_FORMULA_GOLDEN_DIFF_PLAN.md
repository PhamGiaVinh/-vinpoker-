# Payroll P4b-3 — formula patch golden-diff plan (FUTURE — not this PR)

This is the plan for the **only** P4b phase that changes net pay: teaching
`calculate_dealer_payroll` to respect the insurance participation layer. Authored now
so the acceptance bar is fixed before any formula code is written. **No code here.**

## What P4b-3 will change
Resolve, for the dealer + period, the active `dealer_insurance_profiles` row (default
**NONE** when none applies — confirmed in P4b-3, not Phase 1) and the `insurance_policy_rates`
row whose window covers the period (by `region_code`), then:
- **NONE** → `BHXH = BHYT = BHTN = 0`, `insurance_base = 0` (cash-only dealer). No cap.
- **STATUTORY** → compute BHXH/BHYT/BHTN on `insurance_salary_vnd` (fallback rule TBD in P4b-3),
  each `include_*` toggle respected; **BHTN base capped at `bhtn_cap_vnd` (20 × regional min wage)**,
  BHXH/BHYT at their own caps.
- **SERIES_ONLY** → insurance computed only for periods/series the dealer is covered in; otherwise 0.
- The chosen rate row is **snapshotted onto the saved payroll record** so a later law change
  never recomputes a closed period.
- P0 base (`v_base_salary_vnd`), P1 TIPS=0, P2 open-shift, P3 cross-month overlap all preserved.

## Mandatory acceptance (owner, 2026-06-16)
```
dealer NONE        → BHXH = BHYT = BHTN = 0
dealer STATUTORY   → BHXH/BHYT/BHTN computed
BHTN cap           = 20 × regional_min_wage   (NOT the BHXH cap 46.8M)
cash-only dealer   → no insurance deduction
SERIES_ONLY        → applies only within the covered series/period
```
Plus the standing payroll guards: `net_negative = 0`; P0/P1/P2/P3 unchanged; saved/locked/paid
periods not recomputed; no TIPS change; `schema_migrations` untouched; no `db push`; no `deploy_db`.

## Golden-diff method (dryrun-twin, zero writes)
`BEGIN … ROLLBACK` via Management API: define the P4b-3 body as `calculate_dealer_payroll_p4btest`,
compare to the LIVE function across a month for a representative mix:
1. **Cash-only dealer (no profile / NONE)** — expect `new insurance = 0`, `new net ≥ old net`
   (current live computes insurance for everyone, so this is the big intended drop in deductions).
2. **STATUTORY dealer, salary < cap** — insurance = rates × insurance_salary; BHTN on the same base.
3. **STATUTORY dealer, salary > BHTN cap** — BHTN base = `bhtn_cap_vnd`; BHXH/BHYT at their caps.
4. **SERIES_ONLY dealer, period covered vs not covered** — insurance only in the covered period.
5. **Region variation** — same salary, region I vs IV → different BHTN cap when above it.

### Acceptance table
| Case | new insurance | new net vs old | base salary (P0) | net_negative |
|---|---|---|---|---|
| NONE / cash-only | 0 | ≥ old (deductions removed) | unchanged | 0 |
| STATUTORY < cap | rates × salary | per cascade | unchanged | 0 |
| STATUTORY > BHTN cap | BHTN on 20×minwage | per cascade | unchanged | 0 |
| SERIES_ONLY uncovered | 0 | ≥ old | unchanged | 0 |

## Rollout for P4b-3
Source-only migration (new slot) → golden diff (above) → owner review → controlled
Management-API apply → post-apply re-verify on the same cases → rollback = re-apply the
pre-P4b-3 body. Frontend (P4b-2) ships first so profiles can be set before the formula reads them.
