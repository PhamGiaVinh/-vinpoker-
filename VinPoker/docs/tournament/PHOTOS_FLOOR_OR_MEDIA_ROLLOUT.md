# Photos: floor OR media upload — controlled apply runbook

`20261026000000_tournament_photos_floor_or_media.sql` is **source-only**. Apply via the
controlled Management-API path (NOT `db push`), `schema_migrations` untouched.
Owner phrase: **"Apply photos floor or media"** + a Management-API token.

## Apply order (dependencies)
1. `20261023000000_tournament_photos.sql` (#500) — table + bucket + media-only policies.
2. `20261025000000` + `20261025000001` — `floor` role schema (#514).
3. **THEN** this migration (repoints the 4 photo write policies to `is_club_floor_or_media`).

## What it does
- Adds `is_club_floor_or_media(uid,club) = is_club_media OR is_club_floor`.
- Adds `safe_uuid_from_storage_folder(name)` — regex-checks the `{tournament_id}` path
  segment is a UUID before casting (NULL on bad input → policy rejects, never throws). **P0-4.**
- Replaces the 4 media-only write policies (`tournament_photos` + `storage.objects`
  INSERT/DELETE) with floor-OR-media equivalents.

## Verify (`SET ROLE` matrix)
- A user assigned `floor` (or `media`) for the tour's club → can INSERT a `tournament_photos`
  row + a `storage.objects` row under `{tournament_id}/…`.
- A user with neither, or for a DIFFERENT club → INSERT **rejected**.
- `anon` → INSERT rejected; SELECT still allowed (public read unchanged).
- A malformed storage path (non-UUID first folder) → `safe_uuid_from_storage_folder` returns
  NULL → policy rejects with no error.

## Rollback
`docs/emergency_rollbacks/PRE_PHOTOS_FLOOR_OR_MEDIA_20261026000000.sql` (restores media-only policies).
