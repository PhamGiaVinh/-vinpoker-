---
title: Payout Engine Status
updated: 2026-07-02
status: LIVE (stale, pending repair)
---

# Payout Engine (GE-2C + Repair Wave)

## Current Status
- **Engine** GE-2C LIVE, dark mode (enabled=false)
- **Edge** v1 deployed, stale (v1.1 repair pending #656 R1)
- **PR #578** payoutEngine flag OFF, 13 tests pass
- **Forecast** snapshot-token freeze-at-close LIVE

## PR #656 R1 Repair (2026-07-03)
✅ **Merged to main** — code live, Edge deploy pending owner gate
- Edge fn v1 → v1.1 (timeout-sweep + safety, no business logic change)
- Live-apply: owner runs GitHub Actions `repair-wave-apply.yml` with `repair=payout-edge`
- Once deployed, Edge version will match client v1.1 banding logic

## Test Coverage
- 19/19 tests pass locally
- Owner preview via show_widget pending
- Live data: clubs 11111111 + 22222222 (test)

## Risk
- Stale Edge version may underpay players
- No automatic reconcile—manual verification required
- Rollback requires code + Edge redeploy

## Next
1. Owner approves #656 R1
2. Apply edge fn v1.1
3. UAT payout rounds
4. Flip payoutEngine flag ON per phase

## Financial Recognition
- Prize pool is a liability (pass-through), not revenue — tracking rules in
  [[PAYOUT_LIABILITIES]] (09-ACCOUNTING-CONTROL).

---
Link: [[MODULE_STATUS]], [[IMMEDIATE_CONTAINMENT_REGISTER]], [[PAYOUT_LIABILITIES]]
