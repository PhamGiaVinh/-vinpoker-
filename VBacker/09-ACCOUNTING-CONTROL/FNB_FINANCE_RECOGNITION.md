---
title: F&B Finance Recognition
updated: 2026-07-03
status: doctrine, dark
---

# F&B Finance Recognition (Ghi nhận tài chính F&B)

## Recognition rules (doctrine)
- **Pre-paid sale = revenue at sale.** F&B is sold pre-paid; the sale is recognized as
  F&B revenue at the moment of sale, not at delivery. This is true club revenue
  (retained), unlike prize-pool pass-through.
- **Refund reverses the sale.** A refund is a negative revenue event in the period the
  refund happens — it does not rewrite the original sale record (append-only).
- **COGS is mandatory and inventory-driven.** Every F&B sale consumes inventory; cost of
  goods sold comes from the inventory module, never from a guessed margin percentage.
  No F&B revenue line may appear without its matching COGS line.
- **Comped / subsidized F&B is a cost, not zero.** When F&B is given free or below cost
  to an event (player comps, staff meals for a tournament), the **COGS is charged to that
  event** as a direct cost (`F&B_COGS_if_comped_or_subsidized` in Event Contribution,
  see [[EVENT_PNL]]). Free drinks are never financially free.
- F&B margin (revenue − COGS) rolls into [[DAILY_CLOSE]] as part of the operating day.

## CURRENT STATE — live but dark (không phải lỗi)
- Backend **P0–P7 APPLIED LIVE 2026-06-28** (tables, functions, realtime, cron all in the
  live DB), but the module is **DARK**: all `fnb*` feature flags are OFF and
  `fnb_in_club_net` is OFF.
- Consequence: **P&L is intentionally unchanged** — F&B and F&B-COGS lines show **0**.
  A zero here means "flag off", **not** "no F&B activity" and **not** a bug.
  Any report consuming these lines must label them dark (see
  [[DATA_QUALITY_FOR_FINANCE]]).
- Nothing in the club net changes until the owner flips `fnb_in_club_net` after UAT.

## Golden-diff doctrine (before any flag flip)
- The finance calculation that includes F&B was cloned **byte-faithful from the live
  dump**, and a golden-diff proved it: with F&B at zero, the new finance output is
  **identical** to the live output (verified on a real club: identical=true, fnb=0,
  fnbcogs=0).
- Rule: any change that touches the finance summary must first prove a golden diff of
  **zero** against live behavior with the new feature off. Only then may the flag flip be
  proposed — flipping a flag must *add* lines, never *alter* existing ones.

## What finalization requires (when un-darked)
- F&B revenue, refunds, and COGS reconciled against inventory movements for the day.
- Comped-COGS attributed to the correct event before that event's P&L is finalized.
- Bank/drawer side of F&B payments reconciled via [[BANK_CASH_RECONCILIATION]].

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[FNB]], [[EVENT_PNL]], [[DAILY_CLOSE]]
