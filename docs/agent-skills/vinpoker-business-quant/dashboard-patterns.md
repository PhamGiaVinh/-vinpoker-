# Dashboard Patterns — Owner Reporting Rules

Rules and display patterns for every owner-facing financial surface in VinPoker: the Finance
page (`/club/admin/finance`), future Daily Close / Event P&L / Series P&L / Monthly Owner
Report screens, and any widget that shows the owner a money number. Owner-facing name for this
domain: **Tài chính & Đối soát**. Never "Kế toán" alone, never "Legal/Tax Accounting" — this is
management accounting (kế toán quản trị), not statutory accounting.

## The 7 mandatory rules

**1. Show retained revenue separately from buy-in / prize pool.**
WHY: Buy-in prize-pool money is player money passing through the club — a liability, not
revenue. Merging them inflates "revenue" by an order of magnitude and hides whether the club
actually earned anything. Only fee/rake retained by the club is true revenue.
EXAMPLE: An event with 100 entries × 1,100,000 VND (1,000,000 to pool + 100,000 fee) shows
**Doanh thu giữ lại (phí): 10,000,000 VND** and, as a separate informational line,
**Tiền giải thưởng của người chơi (pass-through): 100,000,000 VND** — never a single
"Doanh thu: 110,000,000" line.

**2. Show GTD subsidy explicitly as its own line.**
WHY: `GTD Subsidy = max(0, Guarantee − player-funded prize pool)` is real club money spent when
a guarantee overlays. Netting it silently into revenue or the pool makes an overlaying event
look healthy. The owner's core GTD decision (raise / lower / keep the guarantee) depends on
seeing this number by itself.
EXAMPLE: Guarantee 50,000,000 VND, players funded 42,000,000 → the Event P&L shows
**Bù đắp đảm bảo GTD: −8,000,000 VND** as a visible cost line, plus the break-even entries
number so the owner sees how far short the field fell.

**3. Show direct costs explicitly.**
WHY: Retained revenue alone says nothing; the owner decides on contribution. Dealer wages,
floor/cashier wages, marketing cost, comped/subsidized F&B COGS, and other direct costs must
appear as itemized lines feeding Event Contribution — not pre-netted into a mystery number.
EXAMPLE: Event Contribution panel lists Lương dealer, Lương floor, Lương thu ngân, Chi phí
marketing, Giá vốn F&B tặng kèm — each its own row, sum shown as **Biên đóng góp**. Known gap:
the live P&L is missing the PT wage line until repair #656 R2 is applied — a dashboard built
today must not pretend that cost is zero.

**4. No vanity entries-only metrics as headline numbers.**
WHY: "312 entries!" changes no decision by itself and can mask a money-losing overlay event.
Entries matter only next to money: contribution per entry, capacity utilization, break-even
entries vs actual.
EXAMPLE: Reject a header card that shows only entry count; require it paired with
Biên đóng góp and, for GTD events, "cần X entries để hòa vốn — đạt Y".

**5. Show uncertainty wherever a number is forecast.**
WHY: Forecast value is decision support, not prediction. A single point number ("expect 87
entries") reads as certainty and sets the owner up to over-commit a guarantee. Ranges keep the
GTD decision honest.
EXAMPLE: **Dự báo entries: 70–105 (thường gặp ~85)** — a P5–P95 style range with a median, never
a bare point. If history is too thin to backtest, label it **giả thuyết / chưa đủ dữ liệu**.

**6. Label every value provisional or final.**
WHY: Numbers are provisional until a close event (daily close / event close) finalizes them.
Close Report is NOT STARTED, so today essentially everything live is provisional — presenting a
mid-event figure as settled invites decisions on numbers that will move. Downstream consumers
(Series Intelligence, monthly reports) must use finalized numbers or carry the label through.
EXAMPLE: Badge on every money card: **Tạm tính** (amber) while the event/day is open,
**Đã chốt** (green) only after close. A "Đã chốt" value never silently changes; corrections are
new, visible adjustment lines.

**7. Never call contribution margin "profit".**
WHY: Event Contribution excludes operating/overhead costs (rent, utilities, admin, equipment).
Labeling it "lợi nhuận" makes the owner believe the club earns more than it does — the most
expensive mislabel possible.
EXAMPLE: The line is **Biên đóng góp (chưa trừ chi phí vận hành chung)** — "lợi nhuận" is
reserved for a report that actually includes overhead, which does not exist yet.

## Plain-language owner UI doctrine

- **Vietnamese-first labels.** The owner is non-technical; even the TD finds jargon hard.
  Primary label in plain Vietnamese, technical term secondary or omitted:
  Doanh thu giữ lại, Tiền qua tay (pass-through), Bù đắp GTD, Biên đóng góp, Tạm tính, Đã chốt,
  Chênh lệch quỹ (variance). No English-only financial jargon on owner screens.
- **Guided, one-task-first.** Each screen answers one question first ("Hôm nay lời hay lỗ bao
  nhiêu từ phí?") with one primary number and one primary action; everything else is secondary.
  Wizards over dense forms for anything the owner must input.
- **Hide advanced/empty panels until data exists.** A panel backed by a dark-flag module or an
  empty table does not render as a wall of zeros — it is hidden, or shows a single plain state
  line ("Chưa bật F&B" / "Chưa có dữ liệu"). Empty-state text says what will appear here and
  what (if anything) the owner can do to enable it.
- **Read-only by default.** Owner finance surfaces display and explain; they do not offer
  money-mutating buttons. Any action that changes a money path lives behind its own explicit,
  owner-approved flow.

## Display patterns

- **Retained vs pass-through split card.** Two visually distinct blocks: club money (doanh thu
  giữ lại, colored as revenue) vs player money (prize pool, styled neutrally as custody/
  liability). Never one merged "revenue" figure; never a chart that stacks them into one bar.
- **GTD subsidy line + break-even context.** For guaranteed events: subsidy amount (0 when
  covered), break-even entries from
  `ceil((Guarantee + direct_costs − other_revenue) / net_prize_contribution_per_entry)`, and
  actual entries side by side.
- **Provisional/final badge.** Tạm tính / Đã chốt on every money card and every exported row,
  driven by the close event — not by page-load time.
- **Forecast as range.** Interval (P5–P95) + median, with the naive baseline ("giải tương tự
  lần trước: 78 entries") shown for comparison. Insufficient history → "giả thuyết / chưa
  backtest đủ" tag instead of a confident band.
- **Variance/risk panel.** Cash drawer vs expected, bank (SePay) vs recorded buy-ins, payout
  owed vs paid, escrow in vs out — each as expected / actual / chênh lệch, with anything
  non-zero flagged for reconciliation rather than averaged away.

## Anti-patterns — reject on sight

- **Entries-only vanity dashboard:** headline entry counts with no money context.
- **Merged revenue:** buy-ins + fees summed into one "doanh thu" figure, or prize pool stacked
  into a revenue chart.
- **Contribution labeled profit:** "lợi nhuận" on any number missing operating/overhead costs.
- **Point forecast without interval:** a single predicted number, or a fake-precise one
  ("87.3 entries") — false precision is still a point forecast.
- **Dark-flag zeros shown as truth:** F&B revenue "0 VND" rendered as a real result while
  `fnb*` flags are OFF; any line whose source module is dark must be hidden or labeled
  "chưa bật", never displayed as an earned zero.
- **Invisible subsidy:** GTD overlay netted into the pool or revenue so a losing event looks
  break-even.
- **Silently changing "final" numbers:** recomputing saved/closed values in place instead of
  posting a visible adjustment.
- **Jargon-first labels:** "Net contribution margin (ex-overhead)" as the primary label on an
  owner screen instead of plain Vietnamese with the technicality demoted.
