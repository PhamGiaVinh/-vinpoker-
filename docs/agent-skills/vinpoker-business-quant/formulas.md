# Formula Library — VinPoker Business Quant

Faithful transcription of the canonical formula set, with input definitions, VinPoker data
sources, and pitfalls. All amounts are **VND**. Round to whole VND (or thousands for owner
displays); never present more precision than the inputs support.

**Data-source caveat (applies to every formula):** the live DB (`orlesggcjamwuknxwcpk`) has
drifted from the migration ledger, so table/column references below are conceptual — verify
the live object before trusting a query, treat generated types as the source of truth, and
write queries defensively. Also remember the live-truth doctrine: merged PR ≠ live DB ≠
deployed Edge ≠ active feature flag. A number can exist in source and be zero/absent live.

---

## 1. True Revenue

```
True Revenue = Fee/Rake retained by club
```

**Inputs**
- *Fee/Rake retained by club* — the portion of buy-ins the club keeps (entry fee / phí, rake,
  separate service fee), plus any per-event retained charges.

**VinPoker source** — tournament rake and the separate service fee are captured as distinct
inputs on the tournament record (rake + service-fee migrations are applied live); the owner
finance P&L reads them via the `get_club_finance_summary` RPC. Cash-game rake, if tracked,
comes from cashier records.

**Pitfalls**
1. Counting gross buy-ins (or the prize pool) as revenue — the pool is pass-through player
   money, not club income.
2. Merging rake and service fee into one line when they are configured separately — you will
   double-count or drop one when reconciling.
3. Reading zero rake as "no revenue model" — the live DB has staging-like fixtures; rake is
   genuinely 0 until real tournaments run.

---

## 2. Pass-through

```
Pass-through = Prize pool / player-funded pool
```

**Inputs**
- *Prize pool / player-funded pool* — the sum of player buy-in money destined for payouts.
  It is a **liability** the club holds on behalf of players, never revenue.

**VinPoker source** — cashier registrations (offline and online/VietQR buy-ins) accumulate
the player-funded pool per tournament; staking/VBacker escrow is likewise player/backer
money in pass-through status.

**Pitfalls**
1. Booking pass-through as revenue — this is the single most damaging accounting error;
   it inflates "revenue" by an order of magnitude and hides the real business.
2. Forgetting the liability side: until payouts are settled, the pool is money owed.
   Payout state is currently fragile (payout Edge repair pending owner gate), so treat
   payout-owed vs payout-paid as separate facts.
3. Mixing staking escrow into club cash position — escrow in/out moves cash but is never
   club money.

---

## 3. GTD Subsidy

```
GTD Subsidy = max(0, Guarantee - Player-funded prize pool)
```

**Inputs**
- *Guarantee* — the advertised GTD amount for the event.
- *Player-funded prize pool* — pass-through pool actually collected from entries (formula 2).

**VinPoker source** — guarantee is an event attribute on the tournament record; the
player-funded pool comes from finalized registration/buy-in totals. Use numbers **after**
event close, not mid-registration.

**Pitfalls**
1. Computing subsidy from provisional entry counts before late registration closes —
   the overlay can shrink or vanish.
2. Treating subsidy as "marketing spend that disappeared" — it is a real direct cost and
   must appear explicitly in Event Contribution and on owner dashboards.
3. Ignoring re-entries: the pool includes re-entry money; entry-count proxies undercount it.

---

## 4. Event Contribution

```
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
```

**Inputs**
- *retained_fee_revenue* — formula 1, for this event.
- *other_event_revenue* — other club-retained event income (e.g. add-on fees, sponsor money
  attributable to the event).
- *GTD_subsidy* — formula 3.
- *dealer_wages / floor_wages / cashier_wages* — staff cost attributable to the event.
- *marketing_cost* — money actually spent to promote the event (attribution's money part only).
- *F&B_COGS_if_comped_or_subsidized* — cost of goods for F&B given away or subsidized for the
  event (comped drinks, staff meals charged to the event).
- *other_direct_costs* — anything else directly caused by running the event.

**VinPoker source** — fees via the finance RPC; wages via Payroll/Dealer Swing saved payroll
records; F&B COGS via the F&B module's inventory/COGS tables; marketing cost via the
marketing module (money side only). Note two live gaps: the finance P&L is currently
**missing the PT wage line** (repair merged, live apply pending owner gate), and all F&B
finance lines are **dark** (`fnb*` flags OFF, `fnb_in_club_net` OFF) so they read zero even
though the backend is applied live.

**Pitfalls**
1. **Never recompute saved payroll values.** Payroll doctrine: saved wage numbers are frozen;
   re-deriving them from shift data will disagree with what was actually paid.
2. Reading a zero F&B or PT-wage line as "no cost" — dark flags and the pending PT-wage
   repair make zeros structurally suspect; label them "not yet recognized", not "0".
3. Using provisional (pre-close) numbers — Contribution is only meaningful on finalized
   event numbers; the Close Report wedge is NOT built yet, so state explicitly whether
   inputs are finalized or provisional.

---

## 5. Event Margin %

```
Event Margin % = Event Contribution / retained_fee_revenue
```

**Inputs** — formulas 4 and 1.

**VinPoker source** — derived; same sources as above.

**Pitfalls**
1. Dividing by gross buy-ins instead of retained fee — makes margins look tiny and hides
   which events actually pay.
2. Quoting margin on events where retained_fee_revenue ≈ 0 (freerolls, fixtures) —
   the ratio is undefined/meaningless; report absolute Contribution instead.
3. Presenting this as a profit margin — see guardrail below.

---

## 6. Overlay Break-even Entries

```
Overlay Break-even Entries =
  ceil((Guarantee + direct_costs - other_revenue) / net_prize_contribution_per_entry)
```

**Inputs**
- *Guarantee* — the GTD amount.
- *direct_costs* — event direct costs (wages, marketing, comped F&B COGS, other).
- *other_revenue* — non-fee event revenue offsetting costs.
- *net_prize_contribution_per_entry* — the prize-pool portion of one entry (buy-in minus
  retained fee), i.e. what each entry adds toward covering the guarantee.

**VinPoker source** — guarantee and buy-in structure from the tournament record; fee split
from the rake/service-fee inputs; costs as in formula 4.

**Pitfalls**
1. Using the full buy-in in the denominator instead of the prize-pool portion — understates
   break-even and makes risky GTDs look safe.
2. Ignoring re-entries/add-ons: they change both entries and per-entry contribution.
3. Presenting break-even as a forecast — it is a threshold; whether entries reach it is a
   forecasting question with an interval, not a promise.

---

## 7. Capacity Utilization

```
Capacity Utilization = active_players / available_seats
```

**Inputs**
- *active_players* — players seated/active at a point in time (or averaged over a window).
- *available_seats* — seats across open tables.

**VinPoker source** — seat assignment / tournament tables (seats reference tables via FK;
verify live shape before querying). Series Intelligence capture snapshots table counts.

**Pitfalls**
1. Mixing registered entries with seated players — late reg and bust-outs make these diverge.
2. Counting closed/ghost tables as capacity — table release bugs (orphan assignments) have
   historically left stale state; sanity-check against operator reality.
3. Treating utilization as a target by itself — it changes decisions (open/close tables,
   staffing), it is not a vanity KPI.

---

## 8. Table-hour Cost

```
Table-hour Cost = staff_cost / table_hours
```

**Inputs**
- *staff_cost* — dealer + floor + cashier wage cost for the period.
- *table_hours* — sum of hours each table was open.

**VinPoker source** — wages from saved payroll records (never recomputed); table hours from
dealer-swing / table open-close records, defensively (release timestamps have known bugs).

**Pitfalls**
1. Recomputing wages from shift logs instead of using saved payroll values.
2. Table-hours inflated by tables never properly released — cross-check with the
   stale-attendance auto-close behavior before trusting long tails.
3. Comparing table-hour cost across clubs with different wage policies without noting it.

---

## 9. Player Net Value proxy

```
Player Net Value proxy =
  total_retained_fee + F&B_margin - rewards_cost - subsidy_allocated - support/host_cost_proxy
```

**Inputs**
- *total_retained_fee* — fees this player generated for the club over the window.
- *F&B_margin* — F&B revenue minus COGS attributable to the player.
- *rewards_cost* — promos/rewards given to the player.
- *subsidy_allocated* — the player's share of GTD subsidies for events they played.
- *support/host_cost_proxy* — rough cost of hosting/serving the player.

**VinPoker source** — player history (auto-record chain live: profile, entries, finishes),
finance fees per event, F&B module (dark-flag caveat applies). Several inputs are proxies —
say so.

**Pitfalls**
1. This is a **proxy**, not CLV truth — do not fake-weight it into composite scores or
   rank players to squeeze them; ecosystem health is a guardrail (doctrine point 10).
2. F&B_margin reads zero while F&B flags are dark — the proxy is structurally understated
   until flags flip.
3. Never surface per-player extraction metrics in player-facing UI, and never use this to
   advise gambling behavior.

---

## 10. Forecast Error

```
Forecast Error = actual_entries - forecast_median
```

**Inputs**
- *actual_entries* — finalized entry count after event close.
- *forecast_median* — the P50 of the forecast distribution made **before** the event.

**VinPoker source** — actuals from finalized registration data; forecasts from the Series
Intelligence forecast stack (currently dark behind `series*` flags) or a manual forecast log.

**Pitfalls**
1. Scoring against provisional entry counts — always wait for finalized numbers.
2. Retroactively "fixing" the forecast — score the number that was actually written down.
3. Reporting error without the interval context — a miss inside P5–P95 is expected behavior.

---

## 11. Calibration

```
Calibration: actual should fall inside P5-P95 roughly 90% of the time over many events
```

**Inputs** — a series of forecasts (P5/P50/P95) and finalized actuals.

**VinPoker source** — same as formula 10, accumulated over many events; needs a persistent
forecast log to be scoreable.

**Pitfalls**
1. Judging calibration on a handful of events — coverage needs many observations; with thin
   history, label results "hypothesis / chưa backtest đủ".
2. Intervals so wide they always cover — calibration must be paired with sharpness
   (interval width) to mean anything.
3. Silently re-fitting after each miss and calling the result calibrated — only
   walk-forward evaluation counts.

---

## Guardrail: contribution vs profit

**Event Contribution is a CONTRIBUTION margin.** It excludes rent, utilities, management
salaries, equipment, and other operating/overhead costs. Never label it "profit"
(lợi nhuận) in any report, dashboard, or conversation with the owner unless those costs are
actually included. Mislabeling contribution as profit is a P1 finding at minimum.

## VND and precision

All money in VND. No decimals of VND; owner-facing displays may round to nghìn/triệu with
the unit stated. Never present derived numbers with more precision than the inputs justify
— "≈ 12.4 triệu" from clean inputs is honest; "12,437,218 VND" from a proxy formula is
false precision. Forecasts are always ranges, never single numbers.

## Decision Quality (decision-journal scoring)

```
Decision Quality: compare chosen decision vs naive baseline / previous schedule / no-change policy
```

Method — keep a decision journal and score decisions, not just forecasts:

1. **Before deciding**, write down: the decision (e.g. raise GTD, add a flight, change
   schedule), the forecast/interval that motivated it, the naive baseline alternative
   (previous schedule, same-as-last-time, or explicit no-change policy), and what outcome
   metric will judge it (Event/Series Contribution, not entries alone).
2. **After the event closes**, record finalized actuals for both what happened and the best
   estimate of what the baseline would have produced (nearest comparable event or the same
   event's history).
3. **Score** = outcome under chosen decision minus estimated outcome under the naive
   baseline, in VND of Contribution. Positive = the decision added value; persistent ≈ 0
   means the analysis isn't changing anything yet — say so honestly.
4. Judge the **process** too: was uncertainty shown, was a baseline compared, was the
   decision one this metric could actually change (doctrine points 6–8)? A lucky outcome
   from a bad process still gets flagged.
5. Aggregate over many decisions before claiming the quant work "makes money" — one event
   proves nothing; that claim needs the same calibration discipline as forecasts.
