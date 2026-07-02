---
title: Staking & VBacker Money Path
updated: 2026-07-02
status: BROKEN (awaiting PR #656 R3)
---

# Staking / VBacker Status

## Current State (2026-07-03)
✅ **PR #656 R3 merged to main** — code live, schema + Edge deploy pending owner gate
- **Issue** refund routes fail on non-existent schema refs — FIXED via 4 enum + 4 column additions
- **R3 gate** passed: write-surface enumeration ✓ · mutual exclusion CAS ✓ · append-only residue ✓ · smoke suite ready ✓
- **Repair** PR #656 R3: 3 Edge fns patched + 2 migrations (enum + schema) ready for owner-gated apply

## Schema Truth
- Live DB has drifted from migrations
- Staking tables: `staking_escrows`, `staking_refunds` (state unclear)
- Refund flow: `issue_refund()` RPC → Edge fn → wallet update
- VBacker smart contract integration: TBD

## Next Steps
1. Owner runs GitHub Actions `repair-wave-apply.yml` with `repair=staking-edge`
   - Apply mig 20261212000000 (enum) + 20261212000001 (schema)
   - Deploy staking-cosign-release, admin-confirm-funded, staking-process-refund
   - Run smoke test suite (10-case fixture)
2. Once "🟢 xanh", verify refund flow in UAT (club 11111111)
3. Monitor live txns (escrow/ledger consistency)

## Risks
- User funds trapped if schema mismatch
- Edge function version stale
- No rollback plan documented

## Financial Recognition
- Escrow is player/backer money (pass-through), never club revenue — control rules in
  [[STAKING_ESCROW_CONTROL]] (09-ACCOUNTING-CONTROL).

---
Link: [[MODULE_STATUS]], [[IMMEDIATE_CONTAINMENT_REGISTER]], [[STAKING_ESCROW_CONTROL]]
