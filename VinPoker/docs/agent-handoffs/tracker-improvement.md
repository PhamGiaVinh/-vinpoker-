# Agent Handoff: Live Tracker

**Session Module:** Live Tracker
**Branch:** `agent/tracker-improve` (from `origin/main` @ `5dea9f6`)
**Created:** 2026-06-12
**Scope:** Live Tracker frontend only. No backend, migration, RPC, or Edge Function changes.

## Files This Session Owns

- `src/components/cashier/tournament-live/TournamentLiveView.tsx`
- `src/components/cashier/TournamentLivePanel.tsx`
- `src/pages/TrackerDashboard.tsx`
- `docs/agent-handoffs/tracker-improvement.md` (this file)

## Files This Session Must NOT Touch

Payroll, Dealer Swing, Seat Assignment core, Staking, game engine, Supabase migrations, RPCs, Edge Functions, `Layout.tsx` / `public/version.json` (dirty from parallel sessions), orphaned `PokerVisuals.tsx` / `pokerLiveSound.ts`.

## Current Status

- [x] Analysis
- [x] Implementation
- [x] Verification (see Verification Result)
- [x] Handoff document complete

---

## Findings

| # | Severity | Finding | Status |
|---|---|---|---|
| 1 | P1 | **Stale seats** — `TournamentLiveView.loadAllData` only set seats when result non-empty; switching tournaments left the previous tournament's seats on screen | Fixed |
| 2 | P1 | **Multi-table mixing** — seats query had no `table_id`; all tables rendered on one felt, positions assigned by array index so players shifted seats when others busted | Fixed |
| 3 | P1 | **Skeleton flash** — every realtime event blanked the whole view to skeletons (`setLoading(true)` unconditional) | Fixed |
| 4 | P1 | **Silent query failures** — no `.error` checks; failures rendered zeros with no error state | Fixed |
| 5 | P1 | **No realtime-down warning** — `.subscribe()` status ignored; channel failure = silently frozen view | Fixed |
| 6 | P1 | **TrackerDashboard misleads on RPC failure** — `tracker_club_ids` error displayed as "chưa được phân công CLB" | Fixed |
| 7 | P2 | **Fetch storm** — panel reloaded the whole tournament list on every hand/chip event, duplicating the view's own channel | Fixed |
| 8 | P2 | **Clock freezes at 0** — local countdown stopped, stale blinds shown until next unrelated event | Fixed |
| 9 | P2 | **No operator overview** — bare dropdown, no status cards, no occupancy, no needs-attention view | Fixed |
| — | Existing | Hole cards visible to any authenticated viewer (`hand_players.hole_cards` rendered raw) | Not changed — flag for public-spectate milestone |
| — | Existing | `ClockPanel`, `HandInputPanel`, `TableDrawPanel`, `LeaderboardPanel` internals | Not audited |

---

## Code Changes

### `src/components/cashier/tournament-live/TournamentLiveView.tsx`
- **Multi-table rule:** seats and latest hand now select `table_id`. Render priority: operator-selected table → current hand's table → the single table. With multiple tables and nothing resolved, the felt renders **no** seats and shows "Giải có nhiều bàn — chọn bàn để xem live" with a compact local table selector (names lazily via `get_tournament_tables`, a read-only RPC already used by 3 other tracker panels). Null `table_id` is treated as unsafe for multi-table rendering — no array-index fallback.
- Felt position anchored by physical `seat_number` (`SEAT_POSITIONS[seat_number]`), not array index. Position badges (BTN/SB/…) only computed when the displayed table matches the current hand's table.
- **Async race guard:** `requestSeqRef` — stale responses after a tournament switch are discarded at every `await` boundary. Tournament switch resets all state.
- **Skeleton only on initial load** (`initialLoadedRef`); realtime refreshes update silently.
- **Two-tier errors:** initial-load failure → error card + retry; post-initial refresh failure → keep last good data + compact banner with the failure time. Clock RPC errors are non-fatal.
- **Realtime status:** channel `subscribe` callback drives `connecting`/`online`/`offline`. Offline → amber "Realtime offline" banner + 30 s polling fallback using a single `pollingRef` interval (no leak across repeated errors; stopped on `SUBSCRIBED` and unmount). Status callbacks from replaced channels are ignored.
- **`lastUpdatedAt`** (last *successful* refresh) shown in header; `softErrorAt` tracked separately.
- **Clock-zero refetch** debounced via `zeroRefetchDoneRef` — one refetch per zero crossing, reset when fresh clock data arrives with remaining > 0.
- Props: `refreshTrigger` removed (the view owns its realtime channel).

### `src/components/cashier/TournamentLivePanel.tsx`
- Event routing: `tournaments` UPDATE → reload list; hands/chips/seats → bump `refreshTrigger` only (consumed by TableDraw/Clock/Leaderboard which have no own channel). No more full-list reload per chip count.
- `refreshTrigger` no longer passed to `TournamentLiveView`.
- **Operator overview** when no tournament selected, four distinct states: loading skeletons / error + retry / "Không có giải active" / card grid (name, club, status badge, players remaining, avg stack — built from already-loaded state, no new queries) with a "Cần chú ý" strip for `registering`/`drawing` tournaments.
- Dropdown items show status + club; "Tất cả giải" back button deselects (and now correctly clears `selectedTournament`).

### `src/pages/TrackerDashboard.tsx`
- `tracker_club_ids` / `clubs` query failures now render a distinct error card with retry instead of the misleading "chưa được phân công CLB" empty state.

---

## Known Verification Risks

- The realtime-down banner depends on Supabase channel status. If local dev realtime is healthy but the live DB's `supabase_realtime` publication is missing tables, events won't arrive yet the channel may still report SUBSCRIBED — verify directly on live/staging (the 30 s polling fallback only engages on channel-level failure).
- Multi-table display assumes `table_id` is populated on `tournament_seats` and `tournament_hands`. If either is null, the UI must not (and now does not) merge all tables onto one felt.
- This patch intentionally does not change hole-card visibility, backend RLS, RPCs, migrations, or public spectator permissions.
- This patch intentionally does not audit ClockPanel, HandInputPanel, TableDrawPanel, or Leaderboard internals.

## Manual Verification Checklist

1. Switch between two tournaments → no stale seats from the previous tournament.
2. Kill network / pause realtime → amber offline banner appears; data refreshes every 30 s; banner clears on reconnect with a single interval (no duplicates in devtools timers).
3. Multi-table tournament with a live hand → only the hand's table renders; selector shows "● hand" marker; manually selecting another table shows only that table.
4. Multi-table tournament with no hand yet → felt is empty with the "chọn bàn" prompt, never mixed seats.
5. `/tracker` with RPC failure → error card with retry, not "chưa được phân công".
6. Overview grid: click a card → tabs open; "Tất cả giải" → returns to grid.

## Rollback Notes

This patch is frontend-only. Rollback by reverting the tracker commit on `agent/tracker-improve`. No DB rollback, migration rollback, RPC rollback, or Edge Function rollback is required.

## Verification Result

(to be filled by build run — see PR description)

## Dependencies on Other Modules / Handoff to Next Session

- Read-only contracts consumed: `tournaments`, `tournament_seats`, `tournament_hands`, `hand_actions`, `hand_players`, `profiles`, `get_tournament_clock`, `get_tournament_tables`, `tracker_club_ids`. No shapes changed.
- Future public-spectate milestone must sanitize hole cards (`hand_players.hole_cards`) — current authenticated tracker view shows them raw by existing design.
- Realtime depends on `tournament_hands`/`tournament_chip_counts`/`tournament_seats`/`hand_players` being in the `supabase_realtime` publication (Milestone A migration `20260612000000_tracker_realtime_publication.sql` on `feature/live-tracker-integration`). The polling fallback added here reduces — but does not remove — that dependency.
