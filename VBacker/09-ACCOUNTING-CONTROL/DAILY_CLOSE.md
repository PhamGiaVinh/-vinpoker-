---
title: Daily Close Doctrine
updated: 2026-07-03
status: SPEC / NOT BUILT
---

# Daily Close (Chốt sổ cuối ngày)

## What this is
- The daily control ritual that turns the day's **provisional** numbers into **finalized** numbers.
- ⚠️ **NOT YET BUILT.** No daily close exists in VinPoker today — closing is manual/absent.
  [[CLOSE_REPORT_WEDGE]] (event-level close) is the missing wedge this doctrine feeds:
  event close is the smaller unit; daily close aggregates and seals the day.
- Doctrine reminder: cash movement ≠ accounting recognition; provisional ≠ finalized.
  Nothing downstream (Series Intelligence, owner reports) should treat a day as truth
  until it has been closed.

## What daily close finalizes
- **Cash drawer count (kiểm quỹ)** — physical cash counted vs expected drawer balance;
  variance recorded, never silently adjusted.
- **Bank-vs-app reconciliation (đối soát ngân hàng)** — SePay bank transactions matched
  against app-recorded buy-ins/escrow for the day; unmatched rows flagged. See
  [[BANK_CASH_RECONCILIATION]].
- **Wage accrual for the day (lương tích lũy)** — dealer/PT/floor/cashier wages earned
  today recognized as cost, whether or not paid out yet. Saved payroll values never recompute.
- **F&B day totals (when live)** — F&B sales, refunds, and COGS for the day; currently DARK
  (all `fnb*` flags OFF), so this line is zero until flags flip.
- **Provisional → final flip** for the day's events — every event that reached event close
  today gets its [[EVENT_PNL]] numbers stamped final; events still running stay provisional
  and are labeled as such (Tạm tính).

## Inputs from each Tier-1 module
- **Cashier** — buy-ins, re-entries, refunds, payment method (cash / VietQR).
- **Tournament** — events opened/closed today, entries, prize pools formed.
- **F&B** — sales, refunds, COGS, comped items (dark until flags flip).
- **Payroll / Dealer Swing** — shifts worked, wage amounts accrued today.
- **Payout** — payouts owed vs actually paid today (liability movement).
- **Staking/VBacker** — escrow in/out (player/backer money, never club revenue).
- **SePay/VietQR** — raw bank transaction feed for the day.

## Variance checks run at close
- Drawer counted cash vs expected cash (chênh lệch quỹ).
- Bank feed total vs app-recorded electronic buy-ins.
- Payouts recorded vs payout liability movement (nothing paid that was not owed).
- Escrow balance movement vs staking events (escrow must never leak into revenue).
- Any unexplained variance is logged as **Chênh lệch chưa giải thích** — carried forward
  visibly, never zeroed out.

## Sign-off (ai ký chốt)
- **Cashier (thu ngân)** performs the count and reconciliation entries.
- **Owner (chủ club)** reviews variances and signs the close. A day is not final without
  owner sign-off; until then all its numbers remain Tạm tính.
- After sign-off, the day's numbers are immutable; corrections happen as new dated
  adjustment entries, never edits to a closed day.

## Build status honesty
- SPEC only. No table, RPC, or UI implements this today. When built, it must satisfy the
  contract defined here and in [[CLOSE_REPORT_WEDGE]] — this doctrine is the acceptance test.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[CLOSE_REPORT_WEDGE]], [[BANK_CASH_RECONCILIATION]], [[EVENT_PNL]]
