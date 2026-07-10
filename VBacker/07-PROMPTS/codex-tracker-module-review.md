---
title: Codex review packet — Tournament Live TRACKER module
updated: 2026-07-10
type: review-brief
for: Codex CLI (in-repo) or ChatGPT (paste diffs)
---

# Codex review packet — Tournament Live TRACKER module

**How to use this**
- **Codex CLI (in the repo):** paste the "TASK FOR CODEX" block below as your prompt. Codex reads
  the real files directly (scoped by the file list) — it does NOT need to read the whole codebase.
- **ChatGPT web:** attach the diffs/files. Get the exact file set + diffs with the commands under
  "Pull the code". Paste this packet as context first, then the files.

This is a **money-path module** (it moves real tournament chips and reveals cards). Correctness
and card-secrecy matter more than style. Prioritize the invariants in §4.

---

## 1. What "the Tracker module" is
The operator tool that records a live poker tournament hand-by-hand (blinds → actions → board →
showdown → settle), writes chips, and drives the public spectator view. Layers:
1. **Pure engines** (client `src/lib/tracker-poker/*` + server `supabase/functions/_shared/trackerEngine/*`) — hand-state reducer, legality validator, pot/side-pot math, showdown, resettle.
2. **Operator hand-input console** (`src/components/cashier/tournament-live/handinput/*`, `src/components/tracker/*`) — the 7-step guided workflow.
3. **Hand history + edit + resettle** (`HandHistoryPanel`, `HandEditPanel`, `resettleApply`).
4. **Public live viewer** (`LiveFelt`, `TournamentLiveView`, `viewer-hub/*`, replay).
5. **Server** — edge functions (`tournament-live-*`) + SECURITY DEFINER / INVOKER RPCs + tables.

## 2. Pull the code (scoped — not the whole repo)
```bash
# Full tracker file list:
git ls-files \
  'VinPoker/src/lib/tracker-poker/*' \
  'VinPoker/src/components/cashier/tournament-live/**' \
  'VinPoker/src/components/tracker/**' \
  'VinPoker/supabase/functions/_shared/trackerEngine/*' \
  'VinPoker/supabase/functions/_shared/pokerEngine/*' \
  'VinPoker/supabase/functions/tournament-live-*/**' \
  'VinPoker/tests/trackerPoker/*' 'VinPoker/tests/trackerEngine/*'

# Hand/chip RPC migrations (grep the names in §5):
git ls-files 'VinPoker/supabase/migrations/*' | xargs grep -l 'record_action\|record_hand\|start_hand\|edit_completed_hand\|apply_resettle_forward\|void_last_hand\|takeover_hand_lock\|set_tracker_' 
```

## 3. File map (grouped)

### Pure engines — client (`src/lib/tracker-poker/`)
`trackerEngine.ts` (hand-flow: order/legal/settle) · `handState.ts` (reducer — CLIENT COPY of the
server reducer, kept in parity) · `potEngine.ts` (side-pot math — CLIENT COPY) · `trackerShowdown.ts`
(showdown settle) · `resettleForward.ts` (edit-completed-hand re-settle engine) · `handFlow.ts` ·
`replayEngine.ts`/`replayFx.ts` (replay) · `handBreakdown.ts` · `rankShift.ts` · `handPlayerNames.ts`

### Pure engines — server (`supabase/functions/_shared/`)
`trackerEngine/{index,handState,potEngine,validateAction,types}.ts` — **the server authority**
(reconstructs state from DB, judges legality, recomputes side_pots — never trusts client side_pots).
`pokerEngine/*` — the GE-2 ONLINE runtime (deck/shuffle/evaluate/views/invariants); **NOT used by the
tracker RPCs** but shares the poker rules — verify the tracker doesn't accidentally import it.

### Operator hand-input console (`src/components/cashier/tournament-live/handinput/` + `src/components/tracker/`)
`HandInputConsole` (flag switcher) → `RacetrackHandInputConsole` / `StandaloneHandInputConsole`;
driving hook **`useStandaloneHandInput.ts`** (the 7-step state machine — highest-complexity file);
felt `TrackerRacetrack` + `ActionDock`; sub-panels: `SetupHandPanel`, `SeatSetupPanel`,
`BlindSetupPanel`, `BoardEntryPanel`/`RunoutBoardPanel`, `ActionStepPanel`/`BetKeypad`,
`ShowdownInputPanel`, `ChipQuickEditPanel`, `ReviewHandPanel`; helpers `postHand.ts`, `resumeHand.ts`,
`streetRollback.ts`, `handInputEdge.ts`, `standaloneFelt.ts`, `betSizing.ts`.

### Hand history + edit + resettle
`HandHistoryPanel.tsx` (list + edit + resettle orchestration) · `HandEditPanel.tsx` ·
`handEditDiff.ts` · `resettleApply.ts` (engine→RPC mapping). **This sub-area was just heavily
reviewed — see §6; focus elsewhere.**

### Public live viewer (`src/components/cashier/tournament-live/` + `viewer-hub/`)
`LiveFelt.tsx` (shared felt, operator + spectator) · `TournamentLiveView.tsx` (modes) ·
`PokerVisuals.tsx`/`ChipStack.tsx` · `viewer-hub/{LiveHub,LiveHandFeed,HandFeedCard,useLiveTrackerData,useCompletedHandsFeed,handFeedDerive}.tsx`.

### Seat / roster / floor ops
`SeatDrawDialog`, `RegistrationQueuePanel`, `AddPlayerDialog`, `MovePlayerDialog`,
`FloorTableMapPanel`/`FloorTableDetailSheet`, `RedrawLauncherDialog`, `EditChipsDialog`,
`BustConfirmDialog`.

### Edge functions (`supabase/functions/`)
`tournament-live-update/` (main router — validates via trackerEngine then RPCs) ·
`tournament-live-draw/` (seat/table ops; `update_seats` writes `tournament_seats` directly via JWT) ·
`tournament-live-clock/` · `tournament-live-leaderboard/` (read-only) · `tournament-live-cleanup/`.

### Tests (26 files — good baseline)
`tests/trackerEngine/*` (14: handState, potEngine parity/sidepot, validateAction, deadButton, deadSb,
coverCall, runoutReveal, showdown, postHand) · `tests/trackerPoker/*` (11: trackerEngine, handFlow,
potEngine, replayEngine, rankShift, resettleForward, resettleApply, showdownRevealOrder).

## 4. INVARIANTS to verify (this is what "correct" means)
1. **Chip conservation** — Σ chips is constant across every hand; `record_hand` settles from the
   `hand_players` starting-stack seeds; resettle re-attributes without creating/destroying chips.
2. **Server is authoritative for pots** — the server `trackerEngine/potEngine` recomputes side_pots
   from the action stream; the client-supplied `side_pots` must never be trusted for money.
3. **`action_amount` is a DELTA** (chips ADDED this action, never a "raise-to" total) — everywhere
   (`streetContribution`, potEngine, reducer). A single mis-read here corrupts every pot.
4. **Side-pot correctness** — a short all-in caps its eligibility; over-callers form side pots.
   `settleShowdown` is side-pot-exact; `settleSelectedWinners` is a WHOLE-POT even split (manual
   fallback — the UI must block it when a side pot exists, see §6).
5. **Hole-card secrecy** — `hole_cards` are persisted ONLY when the operator reveals at showdown
   (already face-up at the table); there is NO hidden/RFID source; the viewer/hand-feed must never
   show more than the physical table showed. Verify server `views.ts` strips hidden cards and no
   viewer path leaks unrevealed holes.
6. **Lock / two-writer safety** — `record_action` enforces `tracker_lock_blocks`; only the lock
   holder writes; `takeover_hand_lock` only after the 5-min heartbeat TTL. Verify no path writes a
   hand without the lock check.
7. **Idempotency** — `hand_actions.idempotency_key` + `record_action` idempotency prevent
   double-applied actions on retry/double-click.
8. **Actor binding on SECURITY DEFINER RPCs** — every SECDEF RPC binds `auth.uid()` internally
   (never trusts a client-passed actor) and gates on `is_club_tracker(actor) OR is_club_floor(actor)`;
   PUBLIC/anon execute revoked.
9. **chip_counts ↔ seats ↔ hand_players consistency** — `tournament_chip_counts` (entry-keyed),
   `tournament_seats` (player-keyed, one row/player), and `hand_players` must not silently diverge
   (see the resettle RPC's comment on the seat-vs-chip_count keying trap).
10. **Elimination integrity** — a bust writes `tournament_eliminations` (place/entry) driving payouts;
    resettle must NEVER flip alive↔busted (routed to void+re-enter instead).

## 5. Money-path RPCs (auth model — verify each)
| RPC | migration | mode | authz |
|---|---|---|---|
| `record_action` | 20260928000000 | INVOKER (RLS) | per-hand lock `tracker_lock_blocks` |
| `record_hand` | 20261224000000 | INVOKER | RLS on tournament_hands/hand_players |
| `start_hand` | 20261224000000 | INVOKER | RLS + button_seat range guard |
| `delete_last_action` | 20260928000000 | INVOKER | RLS + `FOR UPDATE` |
| `update_community_cards` | 20260928000000 | INVOKER | RLS |
| `void_last_hand` | 20261225000000 / 20261014000000 | INVOKER | RLS + active-seat guard |
| `edit_completed_hand` | 20261225000000 | **DEFINER** | auth.uid + is_club_tracker/floor |
| `apply_resettle_forward` | **20261230000000** (base 20261226000000) | **DEFINER** | auth.uid + is_club_tracker/floor + conservation + no-bust-flip |
| `set_tracker_table_roster_seat` | 20261215000000 | **DEFINER** | auth.uid + tracker/floor |
| `set_tracker_seat_display` | 20261220000000 | **DEFINER** | auth.uid + tracker/floor |
| `get_tracker_table_locks` / `takeover_hand_lock` | 20261221000000 | **DEFINER** | tracker/floor |
| `update_seats` | — (edge `tournament-live-draw`) | JWT + RLS | direct `tournament_seats` write |

## 6. ALREADY reviewed — do NOT re-flag (build on this)
The **resettle-forward** sub-feature (edit a completed hand → recompute + move chips) was just built
and put through a **36-agent adversarial review + 2 focused verifiers**. 11 real defects were found
and FIXED across #818/#820/#823/#824/#825:
- intra-subset drift (subset-SUM conservation guard is blind to a net-zero move among the changed
  players) → client freshness re-check + server `stale_state` belt (`expected_current`);
- re-entry chain (engine carries by player_id only) → `reentry_boundary` block;
- unbounded child fetch → paged reads + completeness check;
- manual whole-pot split over-paying a short all-in → blocked when a side pot exists;
- non-atomic edit-then-apply + stale-preview → UX + invalidation;
- later-hand `starting_stack` not propagated → server now updates it.
4 findings were adversarially REFUTED (safe). **Codex should focus on the parts that have NOT had
this pass:** the operator hand-input write path (`useStandaloneHandInput`, `record_hand`/`record_action`
settlement), side-pot math on the LIVE path, the lock/heartbeat concurrency, the hole-card-secrecy
surface, and client↔server engine parity.

## 7. Feature-flag / live state
Read `src/lib/featureFlags.ts` — tracker gates are the `tracker*`/`live*` keys. Many are **ON** in
production (`trackerRacetrackUi`, `trackerRacetrackRich`, `trackerFeltV2`, `trackerCardFaces`,
`trackerHandHistoryEdit`, `trackerResettleForward`, `liveActionEngine`, `liveHandFeed`, …). ALWAYS
check the flag's current value in that file before assuming a path is dead. `trackerEngineMode` is OFF.

## 8. Highest-risk focus (rank order)
1. `record_hand` settlement + `useStandaloneHandInput` submit path — where chips are actually written.
2. Side-pot math on the live path (`potEngine`, `trackerShowdown`) + client↔server parity of the two
   copies (parity tests exist — verify they actually cover the divergence cases).
3. Lock/heartbeat concurrency (two operators, takeover, stale lock).
4. Hole-card secrecy across viewer/hand-feed/broadcast.
5. Seat vs chip_count vs hand_players consistency (re-entry, move-player, redraw).

---

## TASK FOR CODEX (paste this as the prompt)
> Review the VinPoker **Tournament Live Tracker** module for **money-path correctness and hole-card
> secrecy**. Use the file map and invariants in this packet. Read the actual files (scoped by §2/§3 —
> do NOT scan the whole repo). The **resettle-forward** sub-feature (§6) was already adversarially
> reviewed and fixed — do not re-flag it; focus on the operator hand-input/settlement path, live
> side-pot math, lock/heartbeat concurrency, hole-card leak surface, and client↔server engine parity.
> For each finding give: severity, file:line, a CONCRETE failure scenario (inputs → wrong chips /
> leaked card / crash), and a fix. Verify against the invariants in §4 and the RPC auth model in §5.
> Empty findings for a solid area is a fine answer. Rank findings most-severe first.
