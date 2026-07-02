# Forecasting Principles — Tournament Entries & Demand

Doctrine for any forecast of tournament entries, demand, or related quantities (F&B volume,
staffing load) in VinPoker. A forecast exists to support a decision — GTD sizing, overlay risk,
flight scheduling, dealer staffing — never to impress. Every rule below exists because its
violation has a known failure mode: overconfident GTDs, phantom precision, and models that only
look good because they peeked at the future.

## The eight rules

### 1. No multiplier soup

Never build a forecast by stacking hand-tuned factors ("base 80 entries × 1.2 weekend × 1.1
series boost × 0.9 rainy season × 1.15 marketing push"). Each factor looks defensible alone;
multiplied together they compound error and hide it — nobody can say afterward which factor was
wrong, so nothing is ever learned. Stacked multipliers are also trivially tunable to hit any
number the author already wanted, which makes them advocacy, not forecasting. If a factor
matters, it must enter as a feature in a model that is backtested as a whole, or it stays out.

### 2. No false precision

Reporting "87.4 entries" or "overlay risk 23.7%" from a model trained on 15 events is theater.
Round to the precision the data supports: whole entries, coarse probability bands ("khoảng 1
trong 4 giải sẽ overlay" — about 1 in 4). False precision is worse than vagueness because it
transfers unearned confidence to a non-technical owner who cannot audit the model. The interval
(rule 3) carries the honesty; the point estimate should look as rough as it really is.

### 3. Never a single number — always an interval (P5 / P50 / P95)

A single-number forecast is a hidden claim of certainty. Always report at minimum P50 (median)
with a P5–P95 interval: "median 87 entries, 90% interval [61, 118]". The interval is not
decoration — it is the input to the actual decision, because overlay risk is
P(entries < break-even), which only an interval can express. If the model cannot produce a
defensible interval, it is not ready to inform a money decision.

### 4. Walk-forward backtest only — no lookahead

Evaluate every model as if it were live: train only on events that finished BEFORE the event
being predicted, step forward event by event, record the error. Any evaluation that lets the
model see the future — random train/test splits across time, features computed from full-period
aggregates, tuning hyperparameters on the test window — will overstate accuracy, sometimes
wildly. A model with no walk-forward evidence has no evidence.

### 5. Always compare to a naive baseline

Before trusting any model, compare it to the dumbest honest alternatives: last-similar-event
(same weekday, same buy-in tier, same series status) and the trailing median of recent similar
events. If the model does not beat the naive baseline on walk-forward error, use the baseline —
it is cheaper, more explainable, and equally accurate. Reporting "model MAE 11.2 vs baseline
MAE 12.5" is the minimum standard; a model number without a baseline number is unreviewable.

### 6. Report calibration

An interval forecast is only useful if it means what it says: actual entries should fall inside
the P5–P95 interval roughly 90% of the time over many events. Track this coverage rate over the
walk-forward history and report it alongside every forecast ("interval coverage 10/12 recent
events ≈ 83%"). Coverage far above 90% means intervals are uselessly wide; far below means the
model is overconfident and its overlay-risk numbers cannot be trusted. Recalibrate (widen or
re-fit) before using a miscalibrated model for GTD decisions.

### 7. Show assumptions explicitly

Every forecast ships with its assumptions written out: which historical events were counted as
"similar", what re-entry policy was assumed, whether a marketing push or competing event is in
scope, what capacity cap applies. Unstated assumptions are where forecasts fail silently — the
model was fine, the world changed, and nobody flagged that the forecast assumed otherwise. An
assumption list also tells the owner exactly what to watch: if an assumption breaks, the
forecast is void, not "wrong".

### 8. Flag insufficient history as "hypothesis / chưa backtest đủ"

With fewer than roughly 10–15 comparable events, there is no basis for a calibrated interval or
a meaningful backtest. Do not dress a guess as a forecast: label it explicitly
**"hypothesis / chưa backtest đủ"** (not yet sufficiently backtested), widen the stated range
generously, and prefer the naive baseline plus owner judgment. New formats, new buy-in tiers,
and first-time series are always in this state — say so.

## True demand vs captured entries

Observed entries are NOT demand. Capacity caps truncate the top (a 90-seat room cannot record
120 demand), re-entry policy inflates or deflates counts (unlimited re-entry vs freezeout can
shift entries 30%+ for the same player interest), and registration friction, competing events,
and late-reg length all distort what gets captured. A model trained naively on captured entries
will systematically underestimate demand for events that sold out and mis-forecast any event
whose re-entry policy differs from history. Always record alongside each event: seats available,
whether it capped out, re-entry policy, late-reg length — and either model unique players and
re-entries separately or restrict comparisons to events with matching policy.

## Simple and shrinkage models first

The model ladder is: (1) naive baseline (last-similar-event, trailing median) → (2) pooled /
shrunk mean across similar events (small clubs and rare formats borrow strength from the pool
instead of trusting 3 noisy observations) → (3) regularized regression (ridge with
cross-validation) on a small, explainable feature set. Stop climbing the ladder the moment the
next rung fails to beat the previous one on walk-forward error. **Kelly-style bet sizing and
regime-switching models are deferred by policy** — they are not to be introduced without owner
approval and a much longer calibrated history; this matches the Series Intelligence quant stack,
where ridge+CV forecasting exists behind dark flags and Kelly/regime-switch were explicitly
deferred.

## Forecasts are decision support — never certainty

A forecast's only job is to change a decision: how large a GTD to post, whether overlay risk is
acceptable, whether to add a flight, how many dealers to schedule. Present every forecast in the
decision's terms ("at GTD 500M, break-even is 95 entries; the forecast puts ~65% probability
below that — expect overlay more often than not") and never as a prediction that will be
"right" or "wrong" as a single number. Judge forecasts by calibration and by decision quality
versus the naive alternative (would the baseline have led to a better GTD choice?), not by
whether one event happened to land near the median. It is forbidden to present a forecast to
the owner as certainty.

## Connection to overlay break-even

The bridge from forecast to money is the break-even formula:

```
Overlay Break-even Entries =
  ceil((Guarantee + direct_costs - other_revenue) / net_prize_contribution_per_entry)
```

Compute break-even entries for the proposed GTD, then read overlay risk directly off the
forecast distribution: P(entries < break-even). This turns "median 87 vs break-even 95" into a
concrete conversation — reduce the guarantee, add a flight to lift capture, or knowingly accept
the overlay as a marketing cost (GTD Subsidy = max(0, Guarantee − player-funded pool), a real
cost line in Event Contribution, never hidden). The forecast does not make this choice; it
prices it. The owner decides.
