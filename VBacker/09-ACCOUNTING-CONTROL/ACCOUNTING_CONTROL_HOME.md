---
title: Accounting Control — Section Home
updated: 2026-07-03
status: canonical
---

# Accounting Control (Tài chính & Đối soát)

## Purpose
- **Single source of financial truth** for VinPoker clubs: every money movement, retained
  revenue, pass-through funds, costs, liabilities, cash/bank reconciliation, and owner reports.
- Operational modules run the club; **Accounting Control decides what the money means** —
  what is revenue, what is someone else's money, what is a cost, and when it is final.

## What it IS / IS NOT
- **IS:** management accounting (kế toán quản trị) — decision support for the owner:
  recognition rules, reconciliation, variance detection, finalized close numbers.
- **IS NOT:** statutory/tax accounting. No VAT, no invoices, no statutory ledger. VinPoker
  does not replace and must never imply replacing statutory accounting software.

## Naming rule
- **UI (owner-facing):** "Tài chính & Đối soát"
- **Docs/architecture:** "Accounting Control"
- **Never** plain "Kế toán" or "Legal/Tax Accounting" — it would misposition the product.

## Three-tier architecture
- **Tier 1 — Operational modules emit events:** Cashier, Tournament, F&B, Payroll/Dealer Swing,
  Payout, Staking/VBacker, SePay/VietQR.
- **Tier 2 — Accounting Control reads, aggregates, reconciles:** cash movement, revenue
  recognition, cost recognition, liability tracking, variance detection, finalized event/day
  numbers. It does NOT replace modules; it is the aggregation + control layer.
- **Tier 3 — Owner reports:** Daily Close, Event P&L, Series P&L, Monthly Owner Report,
  Risk/Variance report.

## Four core separations (doctrine — every 09 note respects these)
1. **Operational events ≠ financial recognition** — modules emit events; Accounting Control
   decides what counts as revenue/cost/liability and when.
2. **Cash movement ≠ accounting recognition** — money moving (bank/drawer) is not the same
   as revenue/cost being earned/incurred.
3. **Retained revenue ≠ pass-through** — prize-pool money is player money passing through
   (a liability), NOT club revenue. Only fee/rake retained by the club is true revenue.
4. **Provisional ≠ finalized** — numbers are provisional until a close event (daily close /
   event close) finalizes them. Downstream consumers (Series Intelligence, owner reports)
   must use finalized numbers or label provisional clearly.

## Section index
- [[MONEY_FLOW_MAP]] — every money flow mapped to owning module and classification
  (retained revenue / pass-through / cost / liability / internal transfer).
- [[DAILY_CLOSE]] — the daily close contract: what gets finalized, when, and by whom.
- [[EVENT_PNL]] — per-tournament P&L: retained fee, GTD subsidy, direct costs, contribution.
- [[SERIES_PNL]] — series-level aggregation of finalized event numbers.
- [[BANK_CASH_RECONCILIATION]] — SePay bank inflows vs cash drawer vs recorded transactions.
- [[PAYROLL_AND_WAGES]] — dealer/floor/cashier/PT wage recognition as direct cost.
- [[FNB_FINANCE_RECOGNITION]] — F&B sale/refund/COGS recognition (dark until flags flip).
- [[PAYOUT_LIABILITIES]] — prize pool as liability from registration until paid out.
- [[STAKING_ESCROW_CONTROL]] — staking escrow in/out: pass-through, never club revenue.
- [[DATA_QUALITY_FOR_FINANCE]] — live-truth doctrine, schema drift, what finance may trust.
- [[OWNER_MONTHLY_REPORT]] — monthly owner report built only from finalized numbers.
- [[ACCOUNTING_GLOSSARY]] — bilingual EN/VI glossary of every financial term used here.

## Relationship to modules
- [[Finance]] — the read-only P&L UI over this truth layer.
- [[CLOSE_REPORT_WEDGE]] — Close Report is NOT STARTED; Accounting Control defines the
  financial contract it must satisfy.
- [[FNB]], [[Payout]], [[Staking-VBacker]], [[Dealer-Swing-Payroll]] — Tier 1 event emitters.
- [[Series-Intelligence]] — Tier 3 consumer; must use finalized numbers only.

---
Link: [[MODULE_STATUS]], [[MONEY_FLOW_MAP]], [[ACCOUNTING_GLOSSARY]], [[CLOSE_REPORT_WEDGE]], [[Finance]], [[FNB]], [[Payout]], [[Staking-VBacker]], [[Dealer-Swing-Payroll]], [[Series-Intelligence]]
