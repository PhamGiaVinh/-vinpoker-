# Owner-run SQL apply package — floor role + tournament photos

**You run this yourself in the Supabase SQL Editor.** Nothing here is auto-applied; no
token is needed/shared. Run each STEP's SQL (copy the referenced migration file's full
contents), then run its POST-CHECK and compare to EXPECTED. Stop if any check fails.

> **`schema_migrations` note:** running SQL manually in the SQL Editor does **NOT** insert
> rows into `supabase_migrations.schema_migrations` (only the Supabase CLI / `db push`
> does). So after this, the DB objects exist but the CLI's migration ledger won't list
> them. That's fine and intentional — this project applies via controlled ops, never
> `db push` (it's blocked by the safety hook). Every block below is **idempotent**
> (`IF NOT EXISTS` / `CREATE OR REPLACE` / `ADD VALUE IF NOT EXISTS` / `DO … duplicate_object`),
> so re-running is safe.

Apply order: **#514 → #500 → #521.** (HOLD #508 — see the bottom.)

---

## STEP 1 — #514 floor role schema
Run, in order, the full contents of:
1. `supabase/migrations/20261025000000_app_role_floor.sql`  (`ALTER TYPE … ADD VALUE 'floor'`)
2. `supabase/migrations/20261025000001_club_floors.sql`     (table + helpers)

**POST-CHECK**
```sql
SELECT 'floor' = ANY (enum_range(NULL::public.app_role)::text[]) AS floor_in_enum;
SELECT to_regclass('public.club_floors') IS NOT NULL AS club_floors_exists;
SELECT count(*) AS floor_fns FROM pg_proc
 WHERE proname IN ('is_club_floor','floor_club_ids') AND pronamespace = 'public'::regnamespace;
```
**EXPECTED:** `floor_in_enum = true` · `club_floors_exists = true` · `floor_fns = 2`.

---

## STEP 2 — #500 tournament photos (table + bucket + media RLS)
Run the full contents of `supabase/migrations/20261023000000_tournament_photos.sql`.

**POST-CHECK**
```sql
SELECT to_regclass('public.club_media')       IS NOT NULL AS club_media_exists;
SELECT to_regclass('public.tournament_photos') IS NOT NULL AS photos_exists;
SELECT count(*) = 1 AS bucket_exists_public
  FROM storage.buckets WHERE id = 'tournament-photos' AND public = true;
SELECT count(*) AS photo_policies FROM pg_policies
 WHERE schemaname='public' AND tablename='tournament_photos';
```
**EXPECTED:** `club_media_exists = true` · `photos_exists = true` · `bucket_exists_public = true` · `photo_policies = 3` (public_read + insert_media + delete_media).

---

## STEP 3 — #521 floor-OR-media photo RLS
Run the full contents of `supabase/migrations/20261026000000_tournament_photos_floor_or_media.sql`.

**POST-CHECK (objects)**
```sql
SELECT count(*) AS combined_fns FROM pg_proc
 WHERE proname IN ('is_club_floor_or_media','safe_uuid_from_storage_folder')
   AND pronamespace='public'::regnamespace;
SELECT string_agg(policyname, ', ' ORDER BY policyname) AS photo_write_policies
 FROM pg_policies WHERE schemaname='public' AND tablename='tournament_photos' AND cmd IN ('INSERT','DELETE');
SELECT public.safe_uuid_from_storage_folder('not-a-uuid/x.jpg') IS NULL       AS bad_path_null;
SELECT public.safe_uuid_from_storage_folder('00000000-0000-0000-0000-000000000000/x.jpg')
       = '00000000-0000-0000-0000-000000000000'::uuid                          AS good_path_ok;
```
**EXPECTED:** `combined_fns = 2` · `photo_write_policies = tournament_photos_delete_floor_media, tournament_photos_insert_floor_media` · `bad_path_null = true` · `good_path_ok = true`.

**POST-CHECK (security matrix — replace the UUIDs with a real tournament + its club + test users).**
Run each as the indicated role to confirm deny/allow. Example pattern:
```sql
-- helper truth table (run as a privileged session)
SELECT public.is_club_floor_or_media('<FLOOR_USER>', '<TOUR_CLUB>')  AS floor_same_club_true;   -- expect true
SELECT public.is_club_floor_or_media('<FLOOR_USER>', '<OTHER_CLUB>') AS floor_cross_club_false; -- expect false
SELECT public.is_club_floor_or_media('<RANDOM_USER>','<TOUR_CLUB>')  AS nonstaff_false;         -- expect false
```
**EXPECTED:** same-club floor/media → **true**; cross-club → **false**; non-floor/non-media → **false**.
Anon: the SELECT policy is `USING(true)` (read), and there is **no** anon INSERT/DELETE policy + no anon write grant → anon can **read** public photos but **cannot** write/delete. Malformed storage path → `safe_uuid…` NULL → the `IS NOT NULL` guard denies the write for **everyone** (no cast error).

---

## Rollback (if needed, reverse order)
- #521 → `docs/emergency_rollbacks/PRE_PHOTOS_FLOOR_OR_MEDIA_20261026000000.sql` (restores media-only).
- #500 → `docs/emergency_rollbacks/PRE_TOURNAMENT_PHOTOS_20261023000000.sql`.
- #514 → `docs/emergency_rollbacks/PRE_CLUB_FLOORS_20261025000001.sql` (enum value `floor` can't be dropped — harmless).

## HOLD — #508 public leaderboard
**Do NOT apply** `20261024000000_leaderboard_public_read.sql` yet. Reason (privacy review): the
current `get_tournament_leaderboard` RPC output includes `player_id`, `table_id`, `seat_number`
— **not public-safe**. A separate PR will add a **public-safe leaderboard read** (display name,
rank, stack, finish position, ITM only — no internal ids / no seat) for anon, which the viewer
uses; the full RPC stays authenticated-only. Apply the public path **only after that lands**.
