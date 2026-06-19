# Module Map

Which session owns what, the key correctness concerns, and the allowed/forbidden boundaries. The map
is **guidance on what exists — not permission to edit out-of-scope files**. Stay inside your
session's assigned module.

> Feature flags are **stored in the database** (e.g. `swing_config`, settings tables), **default
> OFF**. There is no single code constant file; do not assume a flag exists or its value — verify.

## S1 — Online Poker / Game Engine
- **Key concerns:** server-authoritative actions; table/hand locks; idempotency keys; chip
  conservation; pot/side-pot correctness; showdown secrecy; reconnect/spectator safety; no stale
  hand history. Client is visual-only and never decides cards/winner/pot/chips.
- **Default safe work:** client-only UX behind flags; pure-engine unit tests; draft PR only.
- **Forbidden without owner approval:** live enable; live DB config; production Edge redeploy;
  schema migration apply.

## S2 — Tracker / Tournament Live
- **Key concerns:** operator input accuracy; street state machine; **public viewer privacy**
  (no hidden cards before reveal — note: Triton-style hole-card visibility is *intended*, not a bug);
  no stale viewer state; realtime publication verified via `pg_publication_tables`, polling fallback
  kept.
- **Owns:** `src/components/tracker/**`, viewer-hub, `src/lib/tracker/**`, `src/hooks/tracker/**`.
- **Forbidden:** online poker engine; payroll; live DB apply via `deploy_db=true`.

## S3 — Payroll / Finance
- **Key concerns:** audit trail; owner money visibility; role permissions; **no silent recompute of
  saved values** (saved = stored); no fake balances. DB formula/RPC patches need a golden-period
  before/after diff. One payroll patch = one concern.
- **Forbidden:** silent financial mutation; live DB apply; game engine. B5/B7/payment-lifecycle only
  when explicitly opened.

## S4 — Floor / Seat Assignment
- **Key concerns:** open/close-table race conditions; redraw correctness; seat locks; payout-input
  audit; TDA rules are advisory, not final authority.
- **Forbidden:** broad rewrite of production seat-assignment flow; waitlist/open-close RPCs/break/
  payout/TDA/AI-advisor until owner approves.

## S5 — Dealer / Shift / Swing
- **Key concerns:** floor-controlled corrections; canonical release bookkeeping; `perform_swing`
  overload history is risky; scheduler never auto force-releases (→ OT) and never auto-opens tables;
  invariant `swing_due_at` immutable.
- **Forbidden:** casual edits to Dealer Swing / rotation scheduler / `perform_swing` /
  `execute_pre_assigned_swing`; any DB/RPC change needs live snapshot + rollback + focused verify.

## S6 — Club Intelligence / Owner BI
- **Key concerns:** honesty labels on rules engine; **no AI prediction claims before real data**;
  owner-only visibility; dataset provenance.
- **Forbidden:** fabricating predictions; cross-club data leakage; live financial mutation.

## S0 — Coordinator / Planner (no code)
- Splits tasks, maintains the live session board, detects file conflicts, writes per-session prompts,
  collects end-of-day checkpoints. **Does not edit code.**

## High-risk shared files (serialize access — never two sessions at once)
- `src/components/Layout.tsx`
- `src/components/cashier/DealerSwingTab.tsx`
- `src/components/cashier/command-center/QuickLinksCard.tsx`
- Payroll calculation RPC migrations
- Dealer Swing RPC migrations
- Tracker live components

## Module boundaries (enforce)
- Tracker Live Action Engine ≠ Online Game Engine.
- HRC/GTO Preflop Study ≠ full solver.
- Online Game Engine must not touch business-ops modules.
- Dealer Swing Room Reconcile splits into: (A) DB/RPC source-only → (B) controlled live apply →
  (C) UI after the RPC exists live.
