# Player History — Phase 1 (data foundation) — Runbook

**Status:** source-only. NO DB applied, NO flag flipped, NO money change. Owner-gated apply below.

## What this ships
When enabled per club, every player who buys in (walk-in or online) is anchored to ONE
`club_members` row, their entries link to it, and at close their finishing place + prize accumulate —
so a profile/history can be built. Phase 1 is the **data foundation** only (no profile UI yet).

Three additive, idempotent migrations (source-only):
- `20261208000000_player_identity_canonical.sql` (**M1**) — `club_members.phone_canonical`,
  `normalize_phone()`, two **partial unique indexes** (canonical phone / auth user per club),
  `find_or_create_club_member()` (race-safe upsert), `club_settings.player_history_enabled` (per-club
  kill switch, default **false**).
- `20261209000000_player_entry_link.sql` (**M2**) — `tournament_entries.member_id`,
  `lookup_member_for_buyin()` (cashier, masked/minimal), an **AFTER INSERT trigger** that auto-links
  ONLINE entries (zero change to the big `confirm_registration_and_assign_seat`), the offline buy-in RPC
  gains an optional `p_phone` (old 5-arg signature **dropped** first → no PostgREST overload), re-entry
  carries `member_id`, and a `player_history_link_errors` audit table.
- `20261210000000_player_result_finalize.sql` (**M3**) — `tournaments.bust_seq` +
  `tournament_entries.bust_order` (race-safe elimination order via a BEFORE UPDATE trigger),
  `finalize_tournament_results()` (official `finished_place` at close, re-entry & late-reg safe),
  `get_member_history()` (owner/admin/self only; prize **derived on read** from `tournament_prizes`).

Client (dark, flag OFF): `src/lib/normalizePhone.ts` (byte-mirror of the SQL) + tests, and
`FEATURES.playerHistory = false`.

## Safety design (why this is low-risk)
- **Best-effort:** all linking is wrapped so a failure can NEVER block a buy-in / seat / registration;
  identity-link errors go to `player_history_link_errors`, money/seat errors still propagate.
- **Inert by default:** with `club_settings.player_history_enabled = false` (default) the triggers do
  nothing, no member rows are created, and the cashier phone field is hidden (FE flag OFF). Fully dark.
- **Prize never drifts:** `prize` is derived on read from the official `tournament_prizes`, so a payout
  regenerate/manual-edit can’t leave a stale amount (nothing denormalized).
- **Re-entry / late-reg / concurrent bust safe:** official place = `final_field − bust_order + 1`
  computed at finalize over DISTINCT players by their last bullet; `bust_order` is a dense atomic counter.
- **Self-contained:** does NOT depend on the unapplied `20261121000000` floor-bust migration.

## Proof already done (source-only)
- `normalizePhone` unit tests: **6/6 pass**.
- Controlled `BEGIN…ROLLBACK` dry-run against the LIVE schema (club 22222222 fixture, driving
  `auth.uid()` via `request.jwt.claims`): **18/18 assertions green**, transaction rolled back — migrations
  apply cleanly in order; dedup across phone formats; name-conflict no-overwrite; no-anchor → no junk;
  user-path idempotent; authz reject; masked minimal lookup; dense bust_order; finalize places
  (3/2/1); derive-on-read prize; re-entry supersede + late-order; `re_entered` label; RLS blocks
  non-staff; flag-off inertness; online-trigger auto-link; single 6-arg offline RPC (no overload).
- Read-only auditors: `db-safety` + `rls-security` (see PR).

## Owner-gated APPLY (do NOT run without the owner phrase)
Controlled Management-API apply — NOT `supabase db push`; `schema_migrations` is not written.
1. **Preflight re-audit (read-only, hard gate):** re-run the duplicate scan — if ANY club has two
   `club_members` sharing a canonical phone or a `player_user_id`, **STOP** and report; do not auto-merge.
   (Live is currently empty → clean, but re-check at apply time.)
2. Apply **M1 → M2 → M3 in order**, each inside its own `BEGIN … COMMIT` (or all three in one
   transaction) via `POST /v1/projects/orlesggcjamwuknxwcpk/database/query`.
3. Verify: the two partial unique indexes exist, the four functions exist with the right grants
   (anon/PUBLIC revoked), the two triggers exist, `create_offline_buyin_and_seat` is a single 6-arg
   function.
4. Regenerate `types.ts` (optional) or keep the `(supabase as any)` casts.
5. **Enable per club:** `UPDATE club_settings SET player_history_enabled = true WHERE club_id = …;`
   (do this BEFORE a tournament you want history for — bust_order is only captured while enabled).
6. Flip `FEATURES.playerHistory = true` (separate 1-line PR) to show the cashier phone field.
7. UAT on one real tournament: buy-in with a phone → 2nd buy-in same phone reuses the member → bust →
   close → `get_member_history` shows the accumulated rows.

## Rollback
- FE: `playerHistory = false` (hides the cashier field). Per club: `player_history_enabled = false`
  (all triggers inert).
- DB (all additive): drop the two triggers + `link_entry_to_member`/`capture_bust_order`/
  `find_or_create_club_member`/`lookup_member_for_buyin`/`finalize_tournament_results`/
  `get_member_history`/`normalize_phone`, drop the two partial unique indexes, drop the added columns
  (`club_members.phone_canonical`, `tournament_entries.member_id`/`bust_order`, `tournaments.bust_seq`,
  `club_settings.player_history_enabled`), drop `player_history_link_errors`. Restore the prior
  `create_offline_buyin_and_seat` (5-arg) and `reenter_tournament_player` from their live definitions.
