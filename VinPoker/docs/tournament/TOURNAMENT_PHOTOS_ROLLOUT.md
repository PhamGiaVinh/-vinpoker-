# Tournament Photos — controlled apply runbook

`20261023000000_tournament_photos.sql` is **source-only**. Apply it only via the
controlled Supabase **Management-API** path (same method as the ITM-sync / anon-read
rollouts) — **never** `supabase db push` (the safety hook blocks it), and **do not**
touch `schema_migrations`.

Owner phrase to start: **"Apply tournament photos"** + a Management-API access token.

## What it creates
- `public.club_media` (per-club media assignment, like `club_trackers`) + RLS.
- `public.is_club_media(user,club)` + `public.media_club_ids(user)` helpers.
- `public.tournament_photos` (public read, club-media write) + RLS + grants.
- Storage bucket `tournament-photos` (public read) + `storage.objects` RLS gated by
  the tour's club via the path's `{tournament_id}` segment.

## Steps
1. **Preflight** (read-only): `club_media`/`tournament_photos` absent; bucket absent;
   record counts.
2. **Dry-run**: run the whole migration inside `BEGIN; … ROLLBACK;` — confirm no error.
3. **Apply**: run the migration (idempotent — safe to re-run).
4. **Verify structural**: tables + 2 helpers exist; bucket `tournament-photos` public=true;
   RLS enabled; grants present.
5. **Verify functional** (`SET ROLE`):
   - `anon`: `SELECT` on `tournament_photos` succeeds (returns rows / empty, no error).
   - a non-media `authenticated`: `INSERT` into `tournament_photos` for a tour they
     don't manage is **rejected** by RLS.
   - `is_club_media(<owner_uid>, <their_club>)` → true; `is_club_media(<random>, <club>)` → false.
6. **schema_migrations NOT touched**; no data writes; 0 rows changed in existing tables.

## After apply
- Regen `types.ts` (or keep the hand-added `tournament_photos` / `media_club_ids` types).
- Super-admin (AdminUsers `/admin/users`): grant a user the `media` role → assign them to club(s).
- Media user → `/media` → "Ảnh giải đấu" tab → pick a tour → upload → viewer "Hình ảnh" tab shows them.

## Rollback
`docs/emergency_rollbacks/PRE_TOURNAMENT_PHOTOS_20261023000000.sql` (empty the bucket first if removing files).
