# PRE-APPLY record — 20260817000002_room_reconcile_corrections (applied 2026-06-13)

## Pre-apply live state (verified read-only before apply)
- `public.reconcile_dealer_room_state`: DID NOT EXIST (pg_proc count 0)
- `public.dealer_assignment_corrections`: DID NOT EXIST (pg_class count 0)
- Gate helpers `is_club_dealer_control`, `is_club_admin`, `has_role`: all 3 present live
- `schema_migrations` 202608xx live rows at apply time: 20260801000000, 20260814000000,
  20260814000001, 20260816000000, 20260816000001, 20260817000003
- `20260817000000`, `20260817000001` (GE-2) NOT live — intentionally not applied

Both objects are brand new — nothing was overwritten, so rollback is pure DROP.

## Rollback (full revert of 20260817000002)

```sql
BEGIN;
DROP FUNCTION IF EXISTS public.reconcile_dealer_room_state(uuid, jsonb, timestamptz, text, jsonb, boolean, boolean);
DROP TABLE IF EXISTS public.dealer_assignment_corrections;  -- drops its policies + index with it
DELETE FROM supabase_migrations.schema_migrations WHERE version = '20260817000002';
COMMIT;
```

⚠️ `dealer_assignment_corrections` is the correction AUDIT TRAIL. If any correction has been
applied in production, DO NOT drop the table — snapshot/export its rows first, or drop only
the function and leave the table in place (the function is the only writer).

## Apply method used
`supabase db query --linked --file supabase/migrations/20260817000002_room_reconcile_corrections.sql`
(single exact file; the file is self-wrapped BEGIN;…COMMIT;). Compile preflight executed the
full body with the final COMMIT swapped for ROLLBACK (zero persistence) before the real apply.
schema_migrations bookkeeping row inserted manually after verification.
