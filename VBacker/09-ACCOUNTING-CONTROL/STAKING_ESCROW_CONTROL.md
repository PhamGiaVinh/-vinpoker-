---
title: Staking Escrow Control
updated: 2026-07-03
status: doctrine
---

# Staking Escrow Control (Kiểm soát ký quỹ staking)

## Doctrine: escrow is other people's money
- Staking escrow holds **player and backer money** while a staking deal is pending. It is
  **pass-through** (tiền giữ hộ) — the club is a custodian, not an owner. Escrow balances
  are **NEVER club revenue** and never enter P&L except as a liability-side balance.
- Any fee the club charges *on* staking (if ever) would be recognized separately as
  retained revenue; the escrowed principal itself always flows back out to a player,
  a backer, or a refund.

## Control invariants (bất biến kiểm soát)
- **Matched exit for every entry.** Every escrow-in must have exactly one eventual exit:
  a **release** (deal settles, money moves to the entitled party) or a **refund** (deal
  cancels, money returns to the payer). No third outcome exists.
- **No orphan funds.** At any moment, `sum(escrow-in) = sum(released) + sum(refunded)
  + current escrow balance`. Money with no owner and no pending deal is an incident.
- **Append-only residue.** Escrow history is never edited or deleted; corrections are new
  offsetting entries. Every balance must be re-derivable from the entry log.
- **Mutual exclusion on state transitions.** An escrow row settles exactly once —
  release and refund are mutually exclusive and non-repeatable (no double-release, no
  refund-after-release). Concurrent settlement attempts must lose, not double-pay.
- Escrow bank movements reconcile through [[BANK_CASH_RECONCILIATION]] — including its
  one-active-escrow-account-per-club rule for the SePay row hazard.

## CURRENT STATE (2026-07-03): refund path repair pending
- The staking money path was **broken**: refund routes referenced **non-existent schema**,
  so a cancelled deal could not return money through the system.
- Repair **PR #656 R3 merged to main 2026-07-03**: enum + schema migrations plus 3
  hardened Edge functions. **Live apply/deploy is pending the owner gate**, followed by a
  **10-case smoke suite** before the path is trusted.
- ⚠️ **Funds-trapped risk until applied:** money already in escrow whose deal cancels has
  no working automated refund route. Until the repair is live, any such case is handled as
  a manual, owner-visible settlement and logged — never left "pending" in the system.

## What finance may report meanwhile
- Escrow balances may be *displayed* as custodial liabilities, clearly labeled
  provisional (see [[DATA_QUALITY_FOR_FINANCE]]); they must not appear anywhere near
  revenue or contribution numbers.
- Any orphan fund, stuck refund, double-settlement, or invariant breach escalates
  immediately to [[MONEY_PATH_RISKS]] as a P0 money-path incident.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[Staking-VBacker]], [[MONEY_PATH_RISKS]], [[BANK_CASH_RECONCILIATION]]
