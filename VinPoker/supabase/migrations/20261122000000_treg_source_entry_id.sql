-- PATCH 4 / STAGE B — tournament_registrations.source_entry_id + re-entry-aware active uniques.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: an online re-entry needs a PENDING registration (pay-first), but a busted player still holds their
-- ORIGINAL registration at status='confirmed' — so the existing `uniq_treg_active` (one live reg per
-- tournament+player) would block a second pending re-entry reg. This (1) adds `source_entry_id` to link a
-- re-entry reg to its busted source entry (so the confirm step knows which entry to re-enter), and (2)
-- replaces `uniq_treg_active` with two partial uniques that keep the INITIAL-reg behaviour byte-identical
-- while allowing one live re-entry per busted entry.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS, DROP INDEX IF EXISTS, CREATE UNIQUE INDEX IF NOT EXISTS.
-- Rollback (only while no re-entry rows exist): drop the two new indexes; recreate uniq_treg_active on
-- (tournament_id, player_id) WHERE status IN ('pending','confirmed'); ALTER TABLE … DROP COLUMN source_entry_id.

ALTER TABLE public.tournament_registrations
  ADD COLUMN IF NOT EXISTS source_entry_id uuid REFERENCES public.tournament_entries(id) ON DELETE SET NULL;

-- Drop the old "one live reg per tournament+player" unique (it blocks the pending re-entry).
DROP INDEX IF EXISTS public.uniq_treg_active;

-- INITIAL regs: one live (pending/confirmed) per (tournament, player) — UNCHANGED behaviour, scoped to
-- non-re-entry rows (source_entry_id IS NULL). Every existing row has source_entry_id NULL → covered.
CREATE UNIQUE INDEX IF NOT EXISTS uniq_treg_active_initial
  ON public.tournament_registrations (tournament_id, player_id)
  WHERE status IN ('pending', 'confirmed') AND source_entry_id IS NULL;

-- RE-ENTRY regs: at most ONE live re-entry per busted source entry (prevents double-tap / two-device duplicate
-- re-entry for the same bust; still allows re-entry across DIFFERENT busted entries — entry_no increments).
CREATE UNIQUE INDEX IF NOT EXISTS uniq_treg_pending_reentry_per_entry
  ON public.tournament_registrations (source_entry_id)
  WHERE status IN ('pending', 'confirmed') AND source_entry_id IS NOT NULL;

CREATE INDEX IF NOT EXISTS idx_treg_source_entry
  ON public.tournament_registrations (source_entry_id)
  WHERE source_entry_id IS NOT NULL;
