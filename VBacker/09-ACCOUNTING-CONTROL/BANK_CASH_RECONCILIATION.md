---
title: Bank & Cash Reconciliation
updated: 2026-07-03
status: doctrine
---

# Bank & Cash Reconciliation (Đối soát ngân hàng & tiền mặt)

## Doctrine
- Reconciliation compares **three independent sources** that must agree:
  1. **SePay bank truth** — actual money that hit the bank account (webhook-ingested transactions).
  2. **Cashier / app events** — what the system *believes* happened (buy-ins, re-entries, payouts, F&B sales).
  3. **Cash drawer** — physical cash counted per shift (két tiền mặt).
- The bank record is the strongest evidence of cash movement; the app record is the
  accounting intent. **Cash movement ≠ accounting recognition** — a matched bank line
  confirms money moved, not that revenue was earned (see [[MONEY_FLOW_MAP]]).
- No source overwrites another. A mismatch is recorded as a **variance** and resolved
  by explanation, never by silently editing history.

## Cadence (nhịp đối soát)
- **Per shift:** cash drawer count vs expected drawer per app events. Variance logged at
  shift close by the cashier on duty.
- **Daily:** SePay bank transactions vs app-side buy-in/payment events, rolled into
  [[DAILY_CLOSE]]. A day cannot be finalized with unexplained bank variance.
- **Per event:** event-level cash-in (buy-ins) checked against registration records before
  event numbers are finalized in [[EVENT_PNL]].

## Variance buckets (phân loại chênh lệch)
- **Timing** — money arrived in a different period than the app event (e.g. late-night
  transfer lands next banking day). Explainable; resolves itself; note the period shift.
- **Missing** — app event exists but no bank/drawer money, or money exists with no app
  event. Highest priority; possible unlogged sale or unrecorded payment.
- **Duplicate** — the same payment counted twice (double webhook, double manual confirm).
- **Mapping** — money matched to the wrong club, event, player, or purpose (e.g. buy-in
  recorded as F&B). Amounts are right in total but wrong in category.
- **Amount** — matched pair but values differ (partial transfer, typo, fee deducted by bank).

## Auto-confirm path: dynamic VietQR memo matching
- Dynamic VietQR pre-fills account + amount + memo, so the SePay webhook can auto-match the
  incoming bank line to the pending buy-in/re-entry by memo. This is the preferred path:
  it produces bank truth and app event **born matched**, minimizing manual reconciliation.
- Manual transfers without a structured memo fall back to human matching and are the main
  source of Mapping/Missing variances.

## Known hazard: SePay escrow-row mismatch
- ⚠️ The bank-account picker UI edits the **OLDEST** active escrow account row, while the
  edge function reads the **NEWEST**. If a club has more than one active escrow row, the UI
  and the payment path can silently point at different bank accounts.
- **Control rule: keep exactly ONE active escrow bank account per club.** Deactivate old
  rows before adding a new account. Multi-account support waits for SePay Patch 2.

## Escalation
- Every variance gets a bucket, an owner-readable explanation, and a resolution status.
- Any variance unresolved past its daily close, or any Missing/Duplicate variance touching
  real player money, escalates to [[MONEY_PATH_RISKS]] — it is a money-path incident, not
  a bookkeeping footnote.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[DAILY_CLOSE]], [[MONEY_PATH_RISKS]], [[MONEY_FLOW_MAP]]
