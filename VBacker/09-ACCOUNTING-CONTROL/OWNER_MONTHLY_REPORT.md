---
title: Owner Monthly Report Template
updated: 2026-07-03
status: SPEC / NOT BUILT
---

# Owner Monthly Report (Báo cáo tháng cho chủ club)

## What this is
- A plain-language monthly report template for a non-technical owner. One page, VND,
  no jargon. Management accounting (kế toán quản trị) only — not tax/statutory reporting.
- ⚠️ **NOT YET BUILT.** No report generator exists; this spec defines what it must show.
  It aggregates finalized days from [[DAILY_CLOSE]] and finalized events from
  [[EVENT_PNL]] / [[SERIES_PNL]] — it never invents numbers those layers don't have.

## Template sections (thứ tự cố định)
1. **Tiền giữ lại (retained revenue)** — fee/rake the club actually kept this month.
   Never includes buy-in prize-pool money (that is player money passing through).
2. **Chi phí trực tiếp (direct costs)** — dealer/PT/floor/cashier wages, marketing,
   comped F&B COGS, other direct event costs. Itemized, not one lump.
3. **Bù đảm bảo (GTD subsidy)** — total overlay paid this month, listed per event.
   A subsidy is a real cost; it is shown, never netted away.
4. **Biên đóng góp (contribution)** — retained revenue + other revenue − subsidy − direct
   costs. Labeled **contribution margin**, NOT "lợi nhuận" (profit), because
   operating/overhead costs (rent, utilities, admin) are not included.
5. **Nợ phải trả còn lại (outstanding liabilities)** — unpaid payouts still owed to
   players + staking escrow held (player/backer money). This money is in the drawer/bank
   but is NOT the club's.
6. **Chênh lệch chưa giải thích (unexplained variance)** — sum of drawer/bank variances
   from daily closes that remain unresolved. Carried forward visibly month over month.
7. **Rủi ro (risks)** — plain-language list: e.g. pending repair applies, dark modules,
   reconciliation gaps, any month partially built on unclosed days.

## Rules (bắt buộc)
- **Every number labeled Tạm tính (provisional) or Đã chốt (finalized).** A month
  containing unclosed days must say so at the top, not in a footnote.
- **No vanity stats without money context** — entries, unique players, table counts only
  appear next to the money they generated (e.g. entries → retained fee), never alone.
- **Uncertainty ranges for any forward-looking line** — next-month projections show a
  range (khoảng dự báo, e.g. P5–P95), never a single confident number.
- Contribution ≠ profit reminder printed on the report itself, in Vietnamese.
- Numbers come only from finalized closes; the report generator must refuse to present
  an all-Đã-chốt month if any input day/event is still provisional.

## Build status honesty
- SPEC only. Depends on [[DAILY_CLOSE]] (not built) and event close
  ([[CLOSE_REPORT_WEDGE]] not started) — until those exist, any monthly report is
  hand-assembled and should be labeled entirely Tạm tính.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[DAILY_CLOSE]], [[EVENT_PNL]], [[SERIES_PNL]]
