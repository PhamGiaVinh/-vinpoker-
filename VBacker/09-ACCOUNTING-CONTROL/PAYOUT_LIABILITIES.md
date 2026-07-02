---
title: Payout Liabilities
updated: 2026-07-03
status: doctrine
---

# Payout Liabilities (Nghĩa vụ trả thưởng)

## Doctrine: prize money is a liability, never revenue
- The prize pool is **player money passing through the club**. From the **first buy-in**,
  the pool portion is recorded as a **liability** (khoản phải trả) — money the club owes
  back to players as prizes. It is never club revenue.
- Only the fee/rake retained by the club is true revenue (`True Revenue = Fee/Rake
  retained by club`). Mixing pool money into revenue is the single worst accounting error
  this system exists to prevent (see [[MONEY_FLOW_MAP]]).

## Payout states: owed vs paid
- **Owed (phải trả):** the event finishes, final standings fix each prize — the liability
  becomes itemized per player.
- **Paid (đã trả):** cash/bank actually leaves (cashier payout or transfer). Only payment
  extinguishes the liability; cash movement is reconciled in [[BANK_CASH_RECONCILIATION]].
- **Unpaid / unclaimed prizes stay visible as liabilities until settled.** A prize not
  collected tonight is still owed — it must never silently disappear from the books or
  quietly become club money. Aging unclaimed payouts are reviewed at [[DAILY_CLOSE]].

## GTD subsidy: when the guarantee costs the club
- `GTD Subsidy = max(0, Guarantee − Player-funded prize pool)` — if the guarantee exceeds
  what buy-ins funded, the shortfall (overlay) is a **club cost**, charged to the event in
  [[EVENT_PNL]] as `GTD_subsidy`.
- The subsidy is a marketing-like cost of running the guarantee; it is not "lost revenue"
  (the pool was never revenue) and not a reduction of the players' liability.

## Forecast-live vs freeze-at-close (doctrine)
- **Forecast-live:** while registration is open, the projected pool/payout table may
  update live — this is decision support, clearly **provisional** (tạm tính).
- **Freeze-at-close:** when registration closes, the payout table is **frozen** under a
  snapshot token. All payouts settle against the frozen snapshot; later data changes never
  reshuffle prizes. Owner-facing screens must label which state a number is in
  (see [[DATA_QUALITY_FOR_FINANCE]]).

## CURRENT STATE (2026-07-03)
- **Payout engine is dark:** GE-2C runtime live but `enabled=false`; Payout Engine 3-neo
  PR-1 behind `payoutEngine` flag OFF. Payouts today are effectively operator-driven.
- **Edge repair pending:** the stale payout Edge v1 → v1.1 repair (**PR #656 R1**) is
  **merged to main 2026-07-03**, but the Edge deploy is **pending the owner gate**. Until
  deployed, treat the automated payout path as unreliable and keep liability tracking
  manual-verified.
- Until the engine is live, payout liability numbers in reports are provisional unless a
  human has confirmed the frozen payout table against actual payments.

## Escalation
- Any payout owed with no matching payment path, any snapshot mismatch, or any liability
  that "vanished" without settlement escalates to [[MONEY_PATH_RISKS]].

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[Payout]], [[EVENT_PNL]], [[MONEY_PATH_RISKS]]
