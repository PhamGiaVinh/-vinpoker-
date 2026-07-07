# Pre-change snapshot — 20261220000000 (auto-fill Patch 1)

Captured 2026-07-07, before applying
`supabase/migrations/20261220000000_dealer_shift_preference_and_draft_rls.sql`.

## What the migration changes
1. **ADD** `public.dealers.shift_preference text` (+ CHECK `NULL | som | muon | linh_hoat`). Additive, no backfill.
2. **REPLACE** the dealer self-read policy `dealer_shift_assignments_select_own` to also require `status <> 'draft'`.

## Current (pre-change) dealer self-read policy — VERBATIM
Source of truth: `migrations/20260827000000_dealer_shift_planner.sql:198-207`.
Confirmed the ONLY definition of this policy across all migrations (grep 2026-07-07).
The operator `<table>_control_all` FOR ALL policy (which lets floor/dealer-control see drafts)
is **NOT touched** by this migration.

```sql
-- CURRENT policy (restore this exact block to roll back the RLS change):
DROP POLICY IF EXISTS "dealer_shift_assignments_select_own" ON public.dealer_shift_assignments;
CREATE POLICY "dealer_shift_assignments_select_own"
  ON public.dealer_shift_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dealers d
      WHERE d.id = dealer_shift_assignments.dealer_id AND d.user_id = auth.uid()
    )
  );
```

## Full rollback (run in Supabase SQL editor)
```sql
BEGIN;
-- 1. restore the pre-change self-read policy (copy of the block above)
DROP POLICY IF EXISTS "dealer_shift_assignments_select_own" ON public.dealer_shift_assignments;
CREATE POLICY "dealer_shift_assignments_select_own"
  ON public.dealer_shift_assignments FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.dealers d
      WHERE d.id = dealer_shift_assignments.dealer_id AND d.user_id = auth.uid()
    )
  );

-- 2. drop the added column + its constraint
ALTER TABLE public.dealers DROP CONSTRAINT IF EXISTS dealers_shift_preference_check;
ALTER TABLE public.dealers DROP COLUMN IF EXISTS shift_preference;
COMMIT;
```

## Post-apply verification
```sql
-- column present + CHECK correct
SELECT column_name, is_nullable FROM information_schema.columns
  WHERE table_name = 'dealers' AND column_name = 'shift_preference';
SELECT pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'dealers_shift_preference_check';
-- policy now blocks drafts
SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
  FROM pg_policy WHERE polname = 'dealer_shift_assignments_select_own';
-- expect using_expr to contain: status <> 'draft'
-- schema_migrations untouched (we apply the DDL directly, not via db push)
```
