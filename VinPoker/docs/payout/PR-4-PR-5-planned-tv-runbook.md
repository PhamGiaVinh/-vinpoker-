# PR-4 (planned payout settings) + PR-5 (TV payout board) — rollout notes

Both are **source-only, flag-gated, and need ZERO DB migration** — everything they read/write
already exists live:
- PR-4 uses `tournaments.planned_itm_percent/planned_payout_archetype/planned_min_cash_x/
  planned_rounding_unit` (added by `20261120000000_payout_engine.sql`, unused until now) and the
  **existing** `tournaments` UPDATE RLS (`is_club_dealer_control` — club owner or TD/floor-control).
  No new RPC.
- PR-5 is a pure client-side render change over the **same** `tournament_prizes` data the TV
  already reads (via `useTournamentTvData` → `TvData.prizes`). No new fetch/RPC/table.

## Order (each step owner-gated, but no DB step exists)
1. **Merge** each PR (dark — both flags default `false`). CI deploys the frontend; behavior is
   byte-identical to before while the flags are off.
2. **Flip `FEATURES.payoutPlannedSettings = true`** (separate one-line PR) — pre-fill + "Lưu mặc
   định cho giải này" appear in `PayoutEnginePanel` for every allow-listed club.
3. **Flip `FEATURES.tvPayoutBandedDisplay = true`** (separate one-line PR) — `TvPayoutsScreen`
   groups equal-amount bands into one row and shows more of the ladder.
4. UAT: open a club-22222222 tournament's Payout panel once with planned_* unset (defaults as
   before), save a default, reload the panel (or navigate away and back) and confirm it pre-fills.
   For PR-5, view `/tv/:tournamentId` (layout=payouts) on a LIVE_STANDARD-closed tournament with
   >9 ITM places and confirm ranks 10+ show as grouped band rows instead of duplicates.

## Rollback / kill-switch
- **PR-4:** `payoutPlannedSettings = false` → panel behaves exactly as before (hardcoded DAILY/
  15%/2×/rounding-by-buy-in, no save button). The `planned_*` columns are harmless to leave
  populated.
- **PR-5:** `tvPayoutBandedDisplay = false` → `TvPayoutsScreen` reverts to the original top-12,
  one-row-per-rank rendering.

## Test coverage
- `PayoutEnginePanel.test.tsx` — 5 new tests: save-button gating, OFF-does-not-prefill,
  ON-prefills-all-4-fields, save writes the right `tournaments.update` payload, RLS-denied shows a
  friendly message.
- `src/lib/tv/payoutBands.test.ts` — 6 tests for the pure `groupPayoutRows` helper (individual
  ladder untouched, N=19 LIVE_STANDARD bands collapse to exactly the 3 expected rows, truncation
  count, a position gap never merges, sort-order independence, empty input).
- `TvPayoutsScreen.tsx` itself has no component-level test — consistent with every other
  `components/tv/*` screen in this codebase (only the `lib/tv/*` pure mapping/logic functions are
  unit-tested; the screens are thin presentational wrappers). The pure-function coverage above is
  the behavior that actually changed.
