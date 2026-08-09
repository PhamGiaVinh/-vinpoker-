-- TEST canonical replay compatibility overlay.
--
-- Historical migration 20260605000001 creates an index on club_id, while the
-- original column was only added later by 20260719000000. Production history
-- is immutable, so the TEST harness injects this nullable precursor only into
-- its disposable copied migration catalog. The canonical later migration still
-- owns backfill, NOT NULL enforcement, trigger creation, and final indexing.
ALTER TABLE public.dealer_assignments
  ADD COLUMN IF NOT EXISTS club_id UUID
  REFERENCES public.clubs(id) ON DELETE CASCADE;
