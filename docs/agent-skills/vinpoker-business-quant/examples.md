# Worked Examples — VinPoker Business Quant

Four compact, end-to-end examples with realistic VND numbers. Each ends with the lesson it
exists to teach. Formulas come from the formula library; doctrine terms (retained revenue,
pass-through, subsidy, provisional vs final) are used exactly as defined in SKILL.md.

## Example 1 — Event P&L: 500M GTD tournament with overlay

Setup: GTD 500,000,000 VND. Buy-in 5,500,000 = 5,000,000 to prize pool + 500,000 fee retained
by the club. Freezeout-equivalent counting (each paid entry counted once, re-entries included).

**Provisional (at registration close):** 92 entries expected (4 late re-entries not yet
confirmed) → player-funded pool 460,000,000 → GTD subsidy 40,000,000 (provisional).

**Final (at event close):** 88 paid entries confirmed.

```
Player-funded pool      = 88 × 5,000,000  = 440,000,000   (pass-through, NOT revenue)
GTD subsidy             = max(0, 500,000,000 − 440,000,000) = 60,000,000
Retained fee revenue    = 88 × 500,000    = 44,000,000    (the ONLY true revenue here)

Direct costs:
  Dealer wages           18,000,000
  Floor wages             4,500,000
  Cashier wages           3,000,000
  Marketing               8,000,000
  Comped F&B (COGS)       5,000,000
  Other direct            2,500,000
  Total                  41,000,000

Event Contribution = 44,000,000 − 60,000,000 − 41,000,000 = −57,000,000
Event Margin %     = −57,000,000 / 44,000,000 ≈ −130%
```

Break-even check — the denominator is `net_prize_contribution_per_entry` (5,000,000, the
per-entry money that funds the guarantee), NOT the full buy-in:
`ceil((500,000,000 + 41,000,000 − 0) / 5,000,000) = 109 entries`. The event
needed 109 entries; it got 88. Note the provisional subsidy (40M) understated the final (60M) by
20M — a report published before close would have looked 20M better than reality.

**Lesson:** 88 entries and a 440M pool look like a big, successful event. In doctrine terms the
club earned 44M in true revenue and spent 101M in subsidy plus direct costs. Pass-through money
must never be shown as revenue, and provisional numbers must be labeled — both errors would
have hidden a 57M loss.

## Example 2 — Review of an owner-dashboard PR (hypothetical)

PR under review: "Owner Revenue Dashboard v2" — a `/club/admin` panel showing a headline
**"Doanh thu" tile = buy-ins + fees combined** (prize pool merged into revenue) and a second
tile labeled **"Lợi nhuận"** that is actually Event Contribution (no operating/overhead costs).
It reads live registration rows (provisional) with no provisional/final flag.

**Verdict: NO-GO**

**Findings by severity:**
- **P0 — Money wrong:** prize-pool pass-through is counted as club revenue. For the Example 1
  event the tile would show ~484M "doanh thu" when true revenue is 44M — an ~11× inflation that
  is a liability (player money owed as payouts), not income. Owner decisions made on this
  number (GTD sizing, spending) would be systematically wrong.
- **P1 — Misleading label:** "Lợi nhuận" (profit) on a contribution margin that excludes
  operating/overhead costs. Rename to "Biên đóng góp sự kiện" (Event Contribution).
- **P1 — Missing guardrail:** no GTD subsidy line; overlay cost is silently netted away.
- **P1 — Provisional shown as final:** reads registration rows before close; must label
  "tạm tính" or consume finalized close numbers only.
- **P2 — Vanity metric:** entries-count tile with no money context; P2 — jargon labels not in
  plain Vietnamese for a non-technical owner.

**Checks:** formula correctness FAIL (revenue definition). Data source FAIL (provisional live
rows; also assumes F&B revenue lines while `fnb*` flags are dark — verify LIVE vs source-only vs
dark-flag before trusting any line). Owner decision impact HIGH. Required before re-review:
corrected formulas, retained-vs-pass-through split visible, subsidy line, provisional/final
labels, screenshots against a known fixture, and a rollback plan (feature flag, default OFF).

**Lesson:** the two highest-damage dashboard errors are merging pass-through into revenue and
calling a contribution margin "profit". Both are P0/P1 blockers regardless of how good the UI
looks; a dashboard review is a money-definition review first, a design review second.

## Example 3 — Forecast review: entries for a 500M GTD event

Forecast presented: **median 87 entries, P5–P95 [61, 118]** (ridge model, walk-forward).
Overlay break-even at the proposed structure: **95 entries**.

- **Baseline comparison:** last similar event (same weekday/buy-in tier) = 82 entries; trailing
  median of 6 similar events = 84. Model median 87 is close to baseline — expected, not a flaw.
  Walk-forward MAE: model 11.2 vs baseline 12.5 entries. Modest edge; model acceptable.
- **Calibration:** actual entries fell inside the P5–P95 interval in 10 of the last 12 events
  (~83%, target ≈ 90%). Slightly overconfident; treat interval edges with caution, do not
  narrow the interval.
- **Decision framing:** break-even 95 sits above the median 87, so overlay is more likely than
  not — roughly a 2-in-3 chance of some subsidy (coarse on purpose; no false precision).
  Options priced for the owner:
  1. **Reduce GTD** to ~430M → break-even ~82 entries, near the median; overlay becomes a
     coin-flip-or-better rather than the expected outcome.
  2. **Add a flight** to lift captured entries (history: matching events with a second flight
     captured +15–25% entries) — check capacity cap first; demand ≠ captured entries.
  3. **Accept the risk:** keep 500M as a marketing investment; expected subsidy at the median
     ≈ 40M (500M − 87×5.3M pool contribution) — budget it explicitly as GTD subsidy, do not
     hide it.
- **Insufficient-history check:** the model pools freezeout and re-entry events; if this event's
  re-entry policy changes, mark the forecast "hypothesis / chưa backtest đủ".

**Lesson:** the forecast's job is done when the owner sees the interval, the baseline, the
calibration record, and the three priced options. The forecast chooses nothing and promises
nothing — never present the median as what "will" happen.

## Example 4 — Daily-close variance investigation

At daily close (manual, since Close Report is not built yet), two truth checks:

```
Cash drawer:  expected 45,200,000  vs counted 44,700,000  → variance −500,000
SePay bank:   12 credits = 66,000,000  vs system-recorded 11 online buy-ins = 60,500,000
              → 1 unmatched bank credit of 5,500,000
```

Classification pass (every variance gets exactly one class):
- **Timing:** the 5,500,000 credit hit the bank at 23:58; the webhook recorded it at 00:04 the
  next day. It exists in both truths, in different periods → reclassify to the next day's close.
  Not missing, not an error. RESOLVED.
- **Missing:** would be a bank credit with no system record at all (webhook failed) → P0,
  reconstruct from bank statement, never hand-insert without owner sign-off.
- **Duplicate:** same transfer recorded twice (webhook retry) → reverse one (a correction the
  operator executes only with owner approval — this skill classifies and escalates), document.
- **Mapping:** credit matched to the wrong club/tournament (memo mismatch). Watch the known
  SePay hazard: keep exactly ONE active escrow account per club — the account picker edits the
  oldest escrow row while the edge function reads the newest, so multiple active rows can
  mis-map payments.
- The drawer −500,000: recount confirmed; no F&B refund, no recorded payout explains it →
  **unexplained**, which is its own class, never absorbed silently.

**Escalation:** any unexplained variance above the club threshold (e.g. 200,000 VND) or ANY
unmatched bank transaction escalates to the owner the same day, with the classification table
attached. The bank statement is cash truth; system records are recognition truth — when they
disagree, investigate and document. Never adjust records to force a match.

**Lesson:** a variance is not a number to make disappear, it is a fact to classify. Timing
items reclassify cleanly; everything else escalates with evidence. "Đối soát" means the books
explain the bank — never the bank edited to match the books.
