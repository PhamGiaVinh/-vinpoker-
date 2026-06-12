# TV Display Pairing — contract for PR C2 (TV frontend) and PR C3 (dashboard)

**Status: SOURCE-ONLY. Migration `20260818000001_tv_displays_pairing.sql` is committed but NOT applied.**
PR C2/C3 frontends must NOT merge until the migration is applied live in a dedicated,
owner-approved supabase-ops session (preflight → apply → verify → rollback note).

Rollback: `docs/emergency_rollbacks/PRE_APPLY_tv_displays_20260818000001.sql`.

## Why this exists

Live RLS hides `tournaments` (and `tournament_levels` etc.) from anon entirely
(verified 2026-06-13 during PR B), so a no-login TV cannot use `get_tournament_clock`.
`get_tv_display_state` is SECURITY DEFINER and returns one curated, TV-safe JSON.

## RPC contract

### `tv_pair_begin()` — anon (TV calls on /tv/pair)
Returns `{display_id, pair_code, display_token, expires_at}` or `{error: 'too_many_pending' | 'code_generation_failed'}`.
- `pair_code`: 6 digits, 10-minute expiry, single-use.
- `display_token`: 64 hex chars — store in localStorage key `vinpoker.tv.token` (PR C2).
- Self-cleans unpaired rows older than 1h; caps pending pairings at 200.

### `tv_claim_display(p_pair_code, p_club_id, p_name, p_zone?)` — authenticated staff (dashboard)
Club gate: `has_role(uid,'super_admin')` OR club in `dealer_control_club_ids(uid)` (same gate as Tournament Live).
Returns `{display_id, display_number, name}` or `{error: 'unauthorized' | 'forbidden' | 'code_not_found_or_expired'}`.
Sets per-club `display_number` (cosmetic; concurrent claims may race — acceptable).

### `get_tv_display_state(p_display_token)` — anon (TV's single read, 30s poll = heartbeat)
Top-level `status`: `'invalid' | 'expired' | 'unpaired' | 'revoked' | 'paired'`.
TV behavior: `unpaired` → keep showing code; `expired`/`invalid` → call tv_pair_begin again;
`revoked` → clear stored token, back to pair screen; `paired` → render.

Paired shape:
```jsonc
{
  "status": "paired",
  "display": { "id", "name", "zone", "display_number", "layout", "theme", "announcement", "club_name" },
  "tournament": { "id", "name", "status", "players_remaining", "average_stack", "prize_pool" } /* or null when unassigned */,
  "clock":   /* exact get_tournament_clock JSONB — reuse ClockRpcPayload from src/lib/tv/mapTvData.ts */,
  "levels":  [ { "level_number", "small_blind", "big_blind", "ante", "duration_minutes", "is_break" } ],
  "entries": { "total_confirmed", "total_buy_ins" },
  "re_entries": 0,
  "prizes":  [ { "position", "amount" } ]
}
```
Field names intentionally match the PR B raw shapes (`ClockRpcPayload`, `TvLevelRow`,
`TvPrizeRow` in `src/lib/tv/mapTvData.ts`) so PR C2 reuses `mapTvData` with a thin adapter.
Every paired call stamps `last_seen_at` (dashboard online dot: `last_seen_at < 90s` = online).

### `tv_revoke_display(p_display_id)` — authenticated staff
Sets status='revoked', rotates the token (leaked links die immediately).
Returns `{display_id, status}` or `{error}`. Re-pair = TV starts over at /tv/pair.

## Table + assignment (PR C3)

`public.tv_displays` — staff RLS (SELECT/UPDATE/DELETE) club-scoped via
`dealer_control_club_ids`; no INSERT policy (rows only via tv_pair_begin); invisible to anon.
Dashboard assigns/switches by plain `UPDATE tv_displays SET assigned_tournament_id/layout/announcement/name/zone`
(RLS-covered), then sends Broadcast ping on channel `tv-display:{display_id}`
(payload `{event:'config'}`) so the TV refetches instantly. Layouts:
`clock | break_screen | announcement | payouts | multi_board` (only `clock` in MVP).

## Not in this migration (deliberate)

- No realtime publication change (TV polls + Broadcast ping).
- No changes to tournaments/levels/registrations/seats/prizes.
- No `eventNote`/`guarantee`/logo columns (future gated bundle).
