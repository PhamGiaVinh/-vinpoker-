# Tracker Settlement PR3 Migration Collision Report

Date: 2026-07-12
Base: `origin/main` at `7ce3661740bffe085c7cfd61a3d9b629dbd1c103`
Mode: CRITICAL/RED, source-only

## Scope

This PR handles only the Live Center/settlement migration collision at
`20261237000000`. The atomic resettle migration at `20261237000001` already has
a unique version and is unchanged. No other migration collision is repaired.

## Selected Rename

| Item | Value |
| --- | --- |
| Old filename | `VinPoker/supabase/migrations/20261237000000_live_center_public_clock_atomic_payout.sql` |
| New filename | `VinPoker/supabase/migrations/20261238000001_live_center_public_clock_atomic_payout.sql` |
| SHA-256 before | `4c848fa19608459d771b687cfeffae654a708891978e73dbaa92b34244ec8ecb` |
| SHA-256 after | `4c848fa19608459d771b687cfeffae654a708891978e73dbaa92b34244ec8ecb` |
| Body preserved | `true` |

The selected migration was proven unapplied on the active project by catalog
probes below. The old version had two source files; the sibling
`20261237000000_restore_busted_player_to_seat.sql` is not part of this PR.

## Active Project Probes

Owner ground truth identifies `orlesggcjamwuknxwcpk` as the only active
Supabase project. No separate staging/preview project was checked or modified.

- `supabase_migrations.schema_migrations` is readable.
- Applied versions at or after `20261230000000`: `20261235000000` only.
- Current source inventory: 501 migration files and 25 duplicate versions.
- Pre-edit maximum version: `20261238000000`.
- `20261238000001` was free before the rename; post-rename source inventory has exactly one file at that version.

### Target object evidence

- `public.tournament_resettle_requests`: absent.
- Added `hand_players` columns `player_name`, `avatar_url`: absent.
- Added `tournament_eliminations` columns `source`, `result_kind`, `seat_id`, `player_name`, `avatar_url`, `idempotency_key`, `actor_user_id`, `awarded_at`: absent.
- Functions `snapshot_hand_player_identity`, `get_public_tournament_clock_summary`, `get_public_tournament_results`, `preview_tournament_bust`, `bust_tournament_player_with_payout`, `authorize_tournament_live_resettle`, and `commit_tournament_live_resettle`: no public signatures or bodies found.
- Trigger `trg_snapshot_hand_player_identity`: absent.
- Indexes `uq_tournament_eliminations_idempotency` and `uq_tournament_eliminations_result_entry_place`: absent.
- Policies and grants for `tournament_resettle_requests`: none because the table is absent.
- Existing `start_hand` body hash `8cc042b29a0899d02939df104d2f415b` contains no snapshot fields.
- Existing `record_hand` overload body hashes `c98b702624b3a3783bb2d62f570facaf` and `bd8b12b57b5628bf74a73d8322ea9e83` contain no snapshot fields.

These probes establish absence from live objects, not only absence from the
migration ledger.

## Execution Order Safety

- Old intended order: first
  `20261237000000_live_center_public_clock_atomic_payout.sql`, then
  `20261237000001_atomic_tournament_resettle_commit.sql`.
- Final order after rename: first
  `20261237000001_atomic_tournament_resettle_commit.sql`, then
  `20261238000001_live_center_public_clock_atomic_payout.sql`.
- The rename reverses the pair's previous intended order. The direct dependency
  audit below confirms that this reversal is safe at the SQL object-reference
  level.
- Direct dependency audit: **PASS**. `37000001` uses existing baseline tables,
  columns and authorization functions, plus the
  `tournament_resettle_requests` table that it creates itself. It does not use
  `hand_players.player_name/avatar_url`, the new
  `tournament_eliminations` result/payout columns,
  `snapshot_hand_player_identity`, public clock/results RPCs, preview/bust RPCs,
  or the new trigger/indexes from `38000001`.
- Active-schema baseline probe: **PASS**. Required existing tables, stack
  columns, audit columns and `is_club_owner`/`is_club_admin` signatures were
  present on the active project.
- Disposable-schema execution for A (active schema + 37000001), B (resulting
  schema + 38000001), and C (clean schema with both final filenames):
  **NOT_MEASURED**. Docker Desktop was unavailable and no local or production
  migration was executed. Static dependency analysis is the only execution
  safety evidence in this PR.
- `37000001` may execute first because its only new-table dependency is created
  in the same file; its remaining dependencies are baseline objects. The
  renamed `38000001` then adds identity, public clock/results and Floor payout
  objects without being required by the atomic resettle function.
- Source-only merge readiness is separate from production DB-apply readiness.
  Production apply remains OWNER-GATED and requires its controlled runbook and
  measured disposable/staging execution before any live apply decision.
- Final unique-version scan timestamp: `2026-07-12T20:20:44.6271883+07:00`.
- Final scan base: `origin/main` `7ce3661740bffe085c7cfd61a3d9b629dbd1c103`.
- Rename similarity: `100%`; SHA-256 unchanged; no SQL body edits; no active DB
  objects were modified.

## Related Migration

`20261237000001_atomic_tournament_resettle_commit.sql` remains unchanged and
has SHA-256
`04bf084f8d9e5d48ff5f7f23d8320285f14c94833101dc2c5d04dbf7e21a3403`.

## Unrelated Collision Backlog

The following 24 duplicate versions are intentionally not modified:

- `20260906000000`: `dealer_self_service_rpcs`, `payroll_p2_open_shift_standard`
- `20260915000000`: `dealer_selfcheckin_pool_bridge`, `tournaments_service_fee`
- `20260917000000`: `online_poker_runner_cron_vault`, `sync_tournament_itm_places`, `treg_used_free_rake`
- `20260921000000`: `club_intel_f1_foundation`, `online_poker_open_tables`
- `20260922000000`: `club_intel_f1_write_path`, `dealer_assignment_canonical_teardown`
- `20260930000000`: `get_player_intelligence_rpc`, `start_hand_stack_fallback`
- `20261021000000`: `chip_ops_bag_tag`, `get_dealer_availability_requests`
- `20261022000000`: `chip_ops_bagtag_snapshot`, `club_series_images`, `online_poker_buyin_log`
- `20261023000000`: `chip_ops_bank_couple`, `tournament_photos`
- `20261024000000`: `leaderboard_public_read`, `tournament_events`
- `20261025000000`: `app_role_floor`, `create_tournament_event_with_flights`
- `20261026000000`: `tournament_event_qualifiers`, `tournament_photos_floor_or_media`
- `20261028000000`: `clubs_tv_branding`, `dealer_pt_wage_ledger`
- `20261110000000`: `bank_txn_api_verified`, `dealer_feature_p5b_wrapper_pool_selfpick`
- `20261117000000`: `dealer_feature_pool_min_two_guard`, `sepay_system_settings`
- `20261126000000`: `payout_custom_templates`, `series_capture_autosync`
- `20261211000000`: `finance_summary_pt_wage_restore`, `player_history_auto_finalize`, `review_availability_request`
- `20261212000000`: `sepay_settle_fnb`, `staking_refund_enum`
- `20261216000000`: `accounting_payout_liability`, `dealer_shift_reminders`
- `20261218000000`: `card_reissue_log`, `fnb_menu_image_bucket`
- `20261220000000`: `dealer_shift_preference_and_draft_rls`, `tracker_seat_display_edit`
- `20261224000000`: `close_dealer_tables`, `hand_players_name_avatar_snapshot`
- `20261231000000`: `series_theory_patch_v2`, `staff_payroll`
- `20261238000000`: `staff_link_code`, `tournament_satellite_payout`

## Safety Boundary

No `supabase db push`, DB apply, Edge deploy, frontend deploy, flag flip, merge,
or Hand #8 repair was performed. This PR changes migration filename metadata and
adds evidence only; it does not execute SQL.
