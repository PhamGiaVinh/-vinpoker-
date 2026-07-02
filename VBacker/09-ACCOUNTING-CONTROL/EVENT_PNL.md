---
title: Event P&L Doctrine
updated: 2026-07-03
status: doctrine
---

# Event P&L (Biên đóng góp theo giải)

## Core separation
- **Prize pool is NEVER revenue.** Buy-in prize-pool money is player money passing through
  the club — a liability until paid out. Only the fee/rake the club keeps is true revenue.
- This is management accounting (kế toán quản trị) for the owner, not statutory/tax accounting.

## Formulas (verbatim semantics — do not alter)
```
True Revenue = Fee/Rake retained by club
Pass-through = Prize pool / player-funded pool
GTD Subsidy = max(0, Guarantee - Player-funded prize pool)

Event Contribution =
  retained_fee_revenue
  + other_event_revenue
  - GTD_subsidy
  - dealer_wages
  - floor_wages
  - cashier_wages
  - marketing_cost
  - F&B_COGS_if_comped_or_subsidized
  - other_direct_costs

Event Margin % = Event Contribution / retained_fee_revenue

Overlay Break-even Entries =
  ceil((Guarantee + direct_costs - other_revenue) / net_prize_contribution_per_entry)
```

## Rules
- **Prize pool never counted as revenue** — it flows to [[PAYOUT_LIABILITIES]] as a
  liability, and any shortfall vs a guarantee becomes GTD Subsidy (Bù đảm bảo), a cost.
- **Comped/subsidized F&B COGS is charged to the event** — free drinks for players are an
  event cost, not a disappearing item. Recognition rules: [[FNB_FINANCE_RECOGNITION]].
- **Wages are direct costs** — dealer/floor/cashier hours attributable to the event, per
  [[PAYROLL_AND_WAGES]]; saved payroll values never recompute.
- **Three states, never conflated — Forecast / Tạm tính / Đã chốt:**
  - **Forecast** — pre-event projection (entries, overlay); always carries an interval and
    is never presented as an actual.
  - **Tạm tính (provisional actual)** — real operational records exist mid-event but are
    not yet reconciled or closed.
  - **Đã chốt (final)** — finalized and reconciled at event close; the Accounting Control
    truth that downstream consumers ([[SERIES_PNL]], owner reports) may use.
- **Contribution ≠ profit.** Event Contribution is a CONTRIBUTION margin. Never label it
  "profit" (lợi nhuận) when operating/overhead costs (rent, utilities, admin) are excluded.
- Series-level roll-up and cross-event allocation live in [[SERIES_PNL]] — do not bury
  shared costs inside a single event.

## Current reality (2026-07-03, defensive)
- **Rake/fee data is live** via the Finance RPC `get_club_finance_summary`
  (read-only P&L at `/club/admin/finance`) — see [[Finance]].
- **PT wage line missing** from live P&L; repair PR #656 R2 is merged to main but the
  migration apply is still pending the owner gate. Until applied, event cost lines
  understate wages.
- **Payout engine dark** (GE-2C `enabled=false`; Payout Engine 3-neo flag `payoutEngine` OFF;
  Edge v1→v1.1 repair pending) — payout figures are operationally recorded, not
  engine-authoritative yet.
- No automated event close exists; treat all current event numbers as provisional unless
  manually verified.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[PAYOUT_LIABILITIES]], [[PAYROLL_AND_WAGES]], [[FNB_FINANCE_RECOGNITION]], [[SERIES_PNL]], [[Finance]]
