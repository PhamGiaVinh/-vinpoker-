---
title: Series P&L Doctrine
updated: 2026-07-03
status: doctrine
---

# Series P&L (Biên đóng góp theo chuỗi giải)

## What it is
- The series-level roll-up: **sum of Event Contributions across all events in a series**,
  minus series-level shared costs. Each event's numbers come from [[EVENT_PNL]] —
  the series view never recomputes event internals, it aggregates finalized events.
- Same guardrail as events: this is contribution, not profit (lợi nhuận), unless
  operating/overhead costs are included.

## Cross-event allocations (chi phí phân bổ)
- Costs that serve the whole series — **marketing campaigns, fixed staff, venue** — are
  allocated **explicitly** as series-level lines or a stated allocation rule (per event,
  per entry, per table-hour).
- **Never hidden inside one event.** Dumping the series marketing budget into the Main
  Event makes that event look bad and the satellites look free — both numbers become lies.
- Every allocation shows its rule. If the rule is arbitrary, label it arbitrary.

## Ecosystem view (một giải lỗ có thể hợp lý)
- A loss-leader event (e.g. a cheap satellite or a big-GTD flagship) can be rational **if
  series-level contribution improves** — it feeds entries, players, and F&B into the rest
  of the series.
- But the subsidy must be **shown as an explicit subsidy line** (Bù đảm bảo / trợ giá),
  never buried by re-labeling costs or smearing them across other events.
- Decision rule: optimize at series/ecosystem level, not isolated event vanity — but only
  with the loss visible, so the owner is choosing it, not missing it.

## Data discipline for Series Intelligence
- [[Series-Intelligence]] and the quant stack ([[SERIES_INTELLIGENCE_THESIS]]) must
  consume **FINALIZED numbers only** (Đã chốt) for economics, backtests, and forecasts.
- Provisional numbers (Tạm tính) may appear in live overlays but must be **labeled
  provisional** — never mixed silently into finalized history. A model trained on
  unclosed events learns noise.
- Current reality: no automated close exists, so today effectively everything is
  provisional; SI economics conclusions should carry that caveat until close is built.

## Series efficiency metrics
```
Capacity Utilization = active_players / available_seats

Table-hour Cost = staff_cost / table_hours
```
- Use these to compare events **within** a series and series against each other:
  a "successful" event with 40% seat utilization and a high table-hour cost is burning
  staff money; the series view is where that shows up.
- These are efficiency signals, not targets to game — closing tables early to inflate
  utilization hurts the ecosystem the series exists to grow.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[EVENT_PNL]], [[Series-Intelligence]], [[SERIES_INTELLIGENCE_THESIS]]
