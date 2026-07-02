---
title: Payroll & Wages — Cost Recognition
updated: 2026-07-03
status: doctrine
---

# Payroll & Wages (Lương & công)

## Doctrine
- Wages are **cost recognition**, not cash tracking. A wage is *incurred* when the work is
  done (shift worked, table dealt), regardless of when it is paid out. The pay-out itself
  is a cash movement reconciled separately in [[BANK_CASH_RECONCILIATION]].
- Payroll/Dealer Swing is the Tier-1 operational module that *emits* wage events;
  Accounting Control decides how those events land in P&L. Neither replaces the other.

## Wage categories (loại lương)
- **Dealer wages** — per-shift / per-table time from Dealer Swing check-in/out and swing
  records; the largest direct labor cost of running tables.
- **Floor wages** — floor/TD staff time; direct cost of the events they run.
- **Cashier wages** — cashier shifts; direct cost of the operating day.
- **PT (part-time) wages** — hourly part-time staff; recognized like other wages.

## Hard rule: saved payroll values NEVER recompute
- Once a payroll value is saved (shift closed, wage line written), it is **final**. Later
  changes to rates, break policy, or formulas apply **forward only**.
- Corrections are made by an explicit adjustment entry, never by recomputing history.
  This keeps every past P&L number reproducible and audit-safe (append-only doctrine).

## Current state: PT wage line
- The live P&L (`get_club_finance_summary`, see [[Finance]]) is **missing the PT wage
  line** — PT cost silently absent understates labor cost.
- Repair **PR #656 R2 merged to main 2026-07-03**: restores the PT insertion points from
  the live dump (mig 20261211000000). **Migration apply is pending the owner gate** — until
  applied live, treat any P&L labor total as *provisional and understated by PT wages*,
  and label it as such in owner reports (see [[DATA_QUALITY_FOR_FINANCE]]).

## Mapping wages into reports
- **Event P&L ([[EVENT_PNL]]):** wages of staff working *that event* (dealers on its
  tables, its floor staff) enter Event Contribution as direct costs
  (`dealer_wages`, `floor_wages`, `cashier_wages` in the contribution formula).
- **Daily close ([[DAILY_CLOSE]]):** all wage cost accrued for the operating day —
  including staff time not attributable to one event (idle standby, cross-event cashier) —
  lands in the day accrual. Event-attributed and day-level wages must not double-count.
- Attribution rule of thumb: if a shift serves exactly one event, charge the event;
  otherwise charge the day and allocate only if a defensible driver exists (table-hours).

## Efficiency metric: table-hour cost
- `Table-hour Cost = staff_cost / table_hours` — the standard unit cost for comparing
  staffing efficiency across days and events.
- Use it to ask decision questions ("did the extra dealer shift pay for itself?"), not as
  a vanity number. It is a management-accounting metric (kế toán quản trị), not a
  statutory payroll figure.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[Dealer-Swing-Payroll]], [[EVENT_PNL]], [[Finance]]
