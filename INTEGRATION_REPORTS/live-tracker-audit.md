# Live Tracker — Integration Audit Note (Milestone A)

_Date: 2026-06-11 · Branch: `feature/live-tracker-integration` (from `main`)_

## TL;DR

VinPoker **already has a working Live Tracker** — spectator viewer, tracker-input dashboard,
backend tables, RPCs, and edge functions all exist and are wired to the same Supabase tables.
This is an **integration / gap-fix** effort, **not a rewrite**. The single highest-value fix is
the **realtime publication gap** (Milestone A, shipped in this branch).

## What already exists

### Viewer (spectator, read-only)
- `src/pages/TournamentLiveTracker.tsx` — route `/live/:tournamentId` (inside `Layout`).
- `src/components/cashier/tournament-live/TournamentLiveView.tsx` — polished SVG poker-felt UI:
  seats positioned around the table, action timeline, table stats, clock. Reads live data; **no
  mock data**.
- `src/components/cashier/tournament-live/HandHistoryPanel.tsx` — historical hand replay/review.

### Tracker Input (dealer/TD/staff)
- `src/pages/TrackerDashboard.tsx` — route `/tracker`, gated by the `tracker` role
  (`useAuth().isTracker`, roles fetched from `user_roles`).
- `src/components/cashier/TournamentLivePanel.tsx` — tabbed hub: live view, clock, table draw,
  hand input, hand history, leaderboard, blinds, prizes.
- `src/components/cashier/tournament-live/HandInputPanel.tsx` — hand entry. Already validates
  session/read-only state, chip amounts, detects orphan (in-progress) hands, and has a
  `void_hand` path. Uses `heartbeat_lock` to prevent concurrent edits.
- Sibling panels: `TableDrawPanel`, `ClockPanel`, `BlindStructurePanel`, `PrizeStructurePanel`,
  `LeaderboardPanel`.

### Backend
- Core migration `supabase/migrations/20260608000001_tournament_live_tracker.sql`: 8 tables
  (`tournament_hands`, `hand_players`, `hand_actions`, `tournament_seats`,
  `tournament_chip_counts`, `tournament_eliminations`, `tournament_levels`,
  `tournament_prizes`) + 17 RPCs (clock, leaderboard, record_hand, undo_last_action,
  update_stack, state transitions, blinds, prizes, …).
- Follow-ups: `20260608000002_tournament_hand_tracking.sql` (street, community_cards,
  pot_size), `20260617000000_realtime_hand_tracking.sql` (hand status, hole_cards, lock).
- Edge functions: `tournament-live-update` / `-clock` / `-draw` / `-leaderboard`.

## The gap fixed in Milestone A

**Only `public.tournaments` is in the `supabase_realtime` publication.** The viewer and input
dashboard subscribe via `postgres_changes` to `tournament_hands`, `tournament_chip_counts`,
`tournament_seats` (event `*`, `filter: tournament_id=eq.<id>`) and `hand_players` (UPDATE) —
**none of which are published** at the migration baseline. Result: the viewer cannot update
without a manual refresh.

Fix: `supabase/migrations/20260808000000_tracker_realtime_publication.sql` publishes the **4
subscribed tables** (idempotent, DEFAULT replica identity, no `REPLICA IDENTITY FULL`).
`hand_actions` is **not** subscribed anywhere in `src`, so it is intentionally left out (no
realtime benefit, avoids WAL cost).

## Grounded facts (verified)
- Subscription filters: `TournamentLiveView.tsx:259`, `TournamentLivePanel.tsx:72`.
- `hand_actions` realtime subscription: **none found** in `src`.
- RLS: `tournament_hands/seats/chip_counts/hand_players` = `FOR SELECT TO authenticated
  USING (true)` (`20260608000001_*.sql` ~lines 916–985). Logged-in realtime works with no RLS
  change; anon gets nothing (→ future sanitized RPC for public viewer).
- `tournament_hands` has a DB unique index on `(tournament_id, table_id, hand_number)` →
  duplicate-hand inserts are already blocked.

## Module boundaries — DO NOT TOUCH
Dealer Swing (`DealerSwingTab.tsx`, `useDealerSwing.ts`, `lib/dealerSwingState.ts`,
`deploy-package/functions/*`), Assign Seats / `confirm_registration_and_assign_seat` /
`SeatReceipt*`, Staking, Bankroll, ICM/GTO, Account, Documents, Feed, Transfer, Marketplace.

## Deferred (separate approval each)
- **B** Audit log + input hardening — `tracker_audit_logs`, audit written **inside the RPC**
  atomically (`void_hand_with_audit`), stack-delta validation with override-by-reason.
- **C** Viewer polish — loading/empty/error states; Lovable style reconcile from
  `VBACKER CODEBASE.zip` if it differs.
- **D** Tracker settings — minimal feature flags; future prediction/odds/betting flags disabled
  and imported nowhere; future types in `src/types/tracker-future.ts` (unimported).
- **E** Public spectate route — `/spectate/:id` via sanitized RPC
  `get_public_live_tracker_state`, gated by `public_viewer_enabled` (default off). No broad RLS
  loosening.
- **F** `useLiveTracker` refactor — only after realtime is proven (avoids ambiguous regressions).
