# Floor role (schema) — controlled apply runbook

`20261025000000_app_role_floor.sql` + `20261025000001_club_floors.sql` are **source-only**.
Apply via the controlled **Management-API** path (NOT `db push`), `schema_migrations` untouched.
Owner phrase to start: **"Apply floor role schema"** + a Management-API token.

## What it creates (schema only — NO existing access changes)
- `app_role` gains the value `'floor'`.
- `public.club_floors` (per-club floor assignment, like `club_dealer_controls`) + RLS.
- `public.is_club_floor(uid,club)` + `public.floor_club_ids(uid)` helpers (SECURITY DEFINER, read-only).

## Order & dry-run
1. Apply `20261025000000` (`ADD VALUE 'floor'`) **first** — on PG15 this is transactional, so a `BEGIN; … ROLLBACK;` dry-run is safe; nothing in these migrations USES the value (membership is via `club_floors`), so no "unsafe use of new enum value" error.
2. Apply `20261025000001` (table + helpers). Dry-run BEGIN/ROLLBACK, then apply.

## Verify
- `'floor' = ANY(enum_range(NULL::app_role)::text[])` → true.
- `club_floors` exists + RLS enabled; `is_club_floor` / `floor_club_ids` exist with EXECUTE for authenticated.
- **No existing policy changed** (this PR does not touch tournament_photos / floor-dashboard access — that is PR1B / PR1C).
- `SET ROLE`: a non-owner authenticated user cannot INSERT into `club_floors` for a club they don't own; `is_club_floor(<owner>, <their club>)` → true.

## Rollback
`docs/emergency_rollbacks/PRE_CLUB_FLOORS_20261025000001.sql` (the enum value stays — Postgres can't drop enum values; harmless).
