# B2 Break-Pay Policy — OWNER DECISION RECORD (2026-06-13)

**Status:** Owner-approved policy design. Config is source-only (B2-PR2, NOT applied to DB).
**Formula:** UNCHANGED — `calculate_dealer_payroll` does not read these fields yet. Wiring is B2-PR3, separately gated.

## Decision

Payroll supports **configurable break-pay modes** per club/policy row instead of one hardcoded rule:

| Mode | Money behavior |
|---|---|
| `paid_break` **(DEFAULT — dealer-friendly)** | Breaks stay paid. Hours = check-in → check-out. No deduction. `grace_minutes` is display/warning-only. |
| `unpaid_break_with_grace` | Clamp each break to `[check_in, check_out]`, merge overlaps, deduct only minutes **beyond `grace_minutes`** (default 35). |
| `unpaid_break_full` | Clamp + merge as above, deduct **all** valid break minutes. |

Intended use: local club cash/tournament → `paid_break`; foreign series / stricter venues → unpaid modes.

## Config fields (migration `20260819000000_payroll_b2_break_pay_mode_config.sql`, source-only)

```
shift_break_policies.break_pay_mode   TEXT    NOT NULL DEFAULT 'paid_break'   (CHECK 3 modes)
shift_break_policies.grace_minutes    INTEGER NOT NULL DEFAULT 35             (CHECK >= 0)
```

Additive + idempotent. Zero behavior change even when applied (formula doesn't read them yet).

## Operational visibility (kept in ALL modes, including paid_break)

- Break > 60 phút → warning
- Break > 120 phút → severe (red) warning
- Breaks ending after checkout → **clamped for reporting** so displayed break time is truthful
- These are frontend anomaly additions (payrollAnomalies) — scheduled with B2 frontend work, NOT in this PR

## Hard rules carried forward

- Do NOT copy orphan `get_dealer_payroll` break logic (no clamping — over-deducts ~4×; audit PR #46)
- Saved payroll periods are NEVER retro-recomputed
- Formula patch requires explicit owner approval of B2-PR3 (snapshot → dry-run money report → golden diff → apply)

## Still OPEN (gates B2-PR3, not this PR)

- **Q3:** in unpaid modes, deduction applies to total worked minutes BEFORE the regular/OT split (recommended) or only to regular minutes — owner has not decided yet
- Whether a per-break deduction cap is wanted in `unpaid_break_full` (audit found one 872-minute outlier; current decision: warnings only)

## Not in B2-PR2

No DB apply, no formula change, no frontend change, no B7/payment lifecycle/dashboard, no Dealer Swing writes (payroll only ever READS `dealer_breaks`).
