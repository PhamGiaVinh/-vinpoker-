---
title: Money Flow Map
updated: 2026-07-03
status: canonical
---

# Money Flow Map

Every money flow in VinPoker, mapped to its owning module and its accounting classification.
Classifications: **retained revenue** · **pass-through** · **cost** · **liability** ·
**internal transfer**. Doctrine: cash movement ≠ recognition; pass-through ≠ revenue.

## Tournament money
| Flow | Owning module | Classification |
|---|---|---|
| Buy-in — fee/rake portion | Cashier / Tournament | **Retained revenue** (true club revenue) |
| Buy-in — prize-pool portion | Cashier / Tournament | **Pass-through** → held as **liability** until paid out |
| Re-entry (offline + online "Mua lại") | Cashier / SePay-VietQR | Same split as buy-in: fee retained, prize portion pass-through liability |
| Prize payout to players | Payout | **Liability settlement** (reduces prize liability; never a cost) |
| GTD subsidy top-up = max(0, Guarantee − player-funded pool) | Tournament / Payout | **Cost** (club money injected into the prize pool) |

## F&B (dark until `fnb*` / `fnb_in_club_net` flags flip)
| Flow | Owning module | Classification |
|---|---|---|
| F&B sale (pre-paid) | F&B | **Retained revenue** |
| F&B refund | F&B | **Revenue reversal** (contra-revenue) |
| F&B COGS (mandatory inventory) | F&B | **Cost** (giá vốn) |

## Wages
| Flow | Owning module | Classification |
|---|---|---|
| Dealer wages | Payroll / Dealer Swing | **Cost** (direct) |
| Floor wages | Payroll | **Cost** (direct) |
| Cashier wages | Payroll | **Cost** (direct) |
| PT (part-time) wages | Payroll / Finance | **Cost** — PT line restore merged (PR #656 R2), live apply pending owner gate |

## Bank & cash
| Flow | Owning module | Classification |
|---|---|---|
| SePay bank inflow (webhook) | SePay ingestion | **Cash movement** — classify by what it pays for (buy-in split, F&B, etc.); not revenue by itself |
| Dynamic VietQR payment (buy-in / re-entry) | SePay / VietQR | **Cash movement** → routed to the corresponding buy-in split |
| Cash drawer movements (in/out/float) | Cashier | **Internal transfer** — reconciliation item, never revenue or cost |

## Staking & marketing
| Flow | Owning module | Classification |
|---|---|---|
| Staking escrow in (backer funds) | Staking / VBacker | **Pass-through** → **liability** (player/backer money, never club revenue) |
| Staking escrow out (settlement/refund) | Staking / VBacker | **Liability settlement** — refund path repair (PR #656 R3) pending owner gate |
| Marketing spend (Telegram dispatch etc.) | Marketing | **Cost** (money part only; content is out of scope) |

## Known hazards
- **SePay escrow-row hazard:** the account picker edits the OLDEST active escrow row while
  the edge function reads the NEWEST — keep exactly one active escrow account per club.
- **Staking money path:** refund routes referenced non-existent schema; repair merged,
  live apply pending owner gate. Treat staking flows defensively until verified live.
- **F&B flows exist live but DARK** — P&L is unchanged until flags flip; do not book F&B
  lines into owner reports before then.

## Schema caution
- The live DB has **drifted from the migration ledger**; `types.ts` is the source of truth.
  Any flow mapping here must be verified against live object state (Merged PR ≠ live DB ≠
  Edge deployed ≠ flag active) before it feeds a close or an owner report.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[BANK_CASH_RECONCILIATION]], [[PAYOUT_LIABILITIES]], [[STAKING_ESCROW_CONTROL]], [[FNB_FINANCE_RECOGNITION]], [[PAYROLL_AND_WAGES]], [[DATA_QUALITY_FOR_FINANCE]]
