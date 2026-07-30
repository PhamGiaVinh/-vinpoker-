# Tracker Unified Ops V2 Writer Inventory

Baseline reviewed: `origin/main` at
`8513d7604d70aadff89ca858f7d4cb4e3725e580`.

This is a source inventory, not proof that a migration or function is live.
No writer is changed by PR0.

## Context-Affecting Writers

| Domain | Writer | Final source definition | Known client/Edge caller | V2 disposition |
|---|---|---|---|---|
| Floor mode | `floor_set_table_control_mode` | `20270105000001_floor_table_control_mode.sql` | `FloorTableControlMode.tsx` | Join tournament advisory-lock discipline in PR2A |
| Floor seat | `floor_assign_player_to_seat` | `20261240000000_floor_production_hardening.sql` | `AddPlayerDialog.tsx`, `OpsTables.tsx` | Join lock discipline in PR2A |
| Floor move | `move_player_seat` | `20261240000000_floor_production_hardening.sql` | `MovePlayerDialog.tsx`, `FloorPlayerActions.tsx` | Join lock discipline in PR2A |
| Floor close | `close_tournament_table` | `20270101000000_close_tournament_table_containment.sql` | `CloseTableDialog.tsx`, `OpsTables.tsx` | Join lock discipline in PR2A |
| Floor redraw | `redraw_tournament` | `20261240000000_floor_production_hardening.sql` | `RedrawLauncherDialog.tsx`, `OpsTables.tsx` | Join lock discipline in PR2A |
| Floor bust | `floor_bust_player` | `20270105000001_floor_table_control_mode.sql` | Floor control adapter/Edge path | Join lock discipline in PR2A |
| Floor restore | `restore_busted_player_to_seat` | `20261240000000_floor_production_hardening.sql` | `OpsTournamentCockpit.tsx` | Join lock discipline in PR2A |
| Floor stack CAS | `floor_update_tournament_seat_chip` | `20270105000001_floor_table_control_mode.sql` | Floor control adapter/Edge path | Lock-compatible until V2 correction exists; do not remove before PR5 |
| Clock start | `floor_start_tournament_clock` | `20270104000004_floor_clock_control_atomic.sql` | `tournament-live-clock` Edge | Join lock discipline in PR2A |
| Clock control | `floor_control_tournament_clock` | `20270104000004_floor_clock_control_atomic.sql` | `tournament-live-clock` Edge | Join lock discipline in PR2A |
| Cashier buy-in/seat | `create_offline_buyin_and_seat` | `20261209000000_player_entry_link.sql` | `OfflineBuyInPanel.tsx` | Compatibility/concurrency dependency for PR2A; no money outcome change |
| Cashier re-entry | `reenter_tournament_player` | `20261209000000_player_entry_link.sql` | `ReentryPanel.tsx` | Compatibility/concurrency dependency for PR2A; no money outcome change |
| Legacy roster | `set_tracker_table_roster_seat` | `20261215000000_tracker_seat_setup.sql` | `useStandaloneHandInput.ts` | V2 UI unmounts it; containment only in PR5 |
| Legacy hand start | `start_hand` | `20270105000001_floor_table_control_mode.sql` | `tournament-live-update` Edge | Never called by V2; retained for rollback until PR5 |
| Legacy void | `void_last_hand` | `20261225000000_edit_completed_hand.sql` | legacy operator path | Replaced only by explicit V2 void in PR2C |
| Hand completion | `record_hand` | `20261224000000_hand_players_name_avatar_snapshot.sql` | `tournament-live-update` Edge | Settlement/action contract unchanged by Unified Ops V2 |

## Proven Legacy Risks

The final source definition of legacy `start_hand`:

- accepts client hand number, hand time, creator, and button seat;
- accepts both canonical and physical table identity in active-hand lookup;
- marks a hand older than ten minutes `voided`;
- deletes actions and eliminations for that hand;
- clears hole-card and ending-stack evidence;
- repeats stale-hand cleanup in its unique-violation retry path.

V2 must not call or wrap this function. `start_tracker_hand_v2` is a new
server-authoritative transaction and never auto-voids.

`floor_control_revision` changes only with the table mode. It is not a safe
CAS for roster, stacks, active hand, or level changes. V2 uses opaque
`context_version`.

## Identity Risk

The repository contains both:

```text
tournament_tables.id
tournament_tables.table_id -> game_tables.id
```

Some legacy readers and writers accept either identity. V2 mutations accept
only `tournament_tables.id`. Compatibility resolution is tournament-scoped
and fails closed on zero or multiple matches.

## Projection Risk

Live stack has three projections:

```text
tournament_seats.chip_count
tournament_chip_counts.chip_count
tournament_entries.current_stack
```

Legacy paths do not all prove these values equal at the same transaction
boundary. V2 context blocks on mismatch. PR2B correction updates all three or
writes nothing.

## Required PR2A Dependency Review

Before any SQL implementation:

1. Confirm live signatures, bodies, grants, triggers, and callers read-only.
2. Choose one tournament advisory-lock key shared by all competing writers.
3. Preserve each existing writer's business outcome and authorization.
4. Add Start-vs-Move/Correction/Mode/Close and level-change concurrency tests.
5. Include Cashier seat-producing paths in the race analysis without changing
   payment, fee, receipt, or re-entry semantics.
6. Stop if any writer cannot safely join the lock order in the same source-only
   wave.

PR0 does not claim those gates pass. It records them for PR2A owner review.
