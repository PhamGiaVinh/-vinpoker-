---
title: Data Quality for Finance
updated: 2026-07-03
status: doctrine
---

# Data Quality for Finance (Chất lượng dữ liệu cho tài chính)

## Why this note exists
- Finance numbers are only as trustworthy as the data layer beneath them. This note
  defines **which data finance may trust**, and what must be verified or labeled before
  any number reaches the owner.

## Live truth layers (doctrine)
- **Merged ≠ applied ≠ deployed ≠ flag active.** These are four different states:
  1. PR merged to main — code exists, nothing live changed.
  2. Migration **applied** — the live DB actually has the objects.
  3. Edge function **deployed** — the server path actually runs the new code.
  4. Feature **flag active** — users/reports actually see the behavior.
- A finance claim ("PT wage is fixed", "payout Edge is v1.1") must name **which layer**
  it is true at. PR #656 today: merged at layer 1, pending owner gate for layers 2–3.

## Migration ledger is unreliable — verify live object state
- The local migration ledger has drifted far from the remote DB (hundreds of local
  migrations vs far fewer applied). **Never infer live state from migration files.**
- Verify by reading the live object itself (table/view/function present and returning
  expected shape) before trusting a number that depends on it.

## Schema drift — write and read defensively
- The live DB has drifted from migrations; **`types.ts` is the source of truth** for
  what actually exists. Queries feeding finance must tolerate missing/renamed columns
  loudly (fail visible), not silently return partial numbers.

## Dark flags: a zero is not always a truth
- Dark modules zero out their lines by design — e.g. F&B lines show **0** because all
  `fnb*` flags and `fnb_in_club_net` are OFF, not because there were no sales
  (see [[FNB_FINANCE_RECOGNITION]]).
- Every report line must be classifiable as: **real zero** (activity was zero),
  **dark zero** (flag off), or **broken zero** (pipeline failure). Only the first is a
  financial fact; the other two must be labeled or excluded.

## Provisional vs final labeling (tạm tính vs chốt)
- No number reaches an owner report unlabeled. **Provisional (tạm tính):** live-updating,
  pre-close, or from a pending-repair path. **Final (đã chốt):** produced by a close event
  ([[DAILY_CLOSE]] / event close) and immutable thereafter.
- Downstream consumers — [[OWNER_MONTHLY_REPORT]], Series Intelligence economics — must
  consume finalized numbers, or display the provisional label verbatim.

## Readiness checklist — before a metric enters owner reports or SI economics
A metric may enter [[OWNER_MONTHLY_REPORT]] or [[Series-Intelligence]] economics only if:
1. **Source live-verified** — the tables/RPCs it reads are confirmed live, not assumed
   from merged code or migration files.
2. **Flag state known** — every dark flag touching the metric is listed; dark zeros
   labeled or excluded.
3. **Recognition correct** — revenue vs pass-through vs subsidy vs cost separated per
   [[MONEY_FLOW_MAP]]; contribution never labeled "profit" (lợi nhuận).
4. **Finalized or labeled** — closed-period data, or explicit provisional label.
5. **Reconciled** — bank/cash/app variance for the period resolved or escalated
   ([[BANK_CASH_RECONCILIATION]]).
6. **Known gaps declared** — e.g. PT wage understatement until #656 R2 applies live.
Fail any item → the metric stays out of the report, or ships with the failure stated.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[MODULE_STATUS]], [[Series-Intelligence]], [[OWNER_MONTHLY_REPORT]]
