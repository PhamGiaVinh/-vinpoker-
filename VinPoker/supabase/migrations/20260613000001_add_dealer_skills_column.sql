-- ═══════════════════════════════════════════════════════════════════════════════
--  Add skills text[] column to dealers table
--  ═══════════════════════════════════════════════════════════════════════════════
--  Root cause: buildDealerCandidates() selects "skills" inside dealers!inner(...)
--  but dealers table had no skills column — causing PostgREST 400 → empty
--  candidates → pickNextDealer returns null → all swings get "no_dealer".
-- ═══════════════════════════════════════════════════════════════════════════════

ALTER TABLE public.dealers
  ADD COLUMN IF NOT EXISTS skills text[] NOT NULL DEFAULT '{}';

-- Grant select to authenticated (matching existing dealers RLS profile)
GRANT ALL (skills) ON public.dealers TO authenticated;

COMMENT ON COLUMN public.dealers.skills IS
  'Game-type proficiencies e.g. {"NLH","PLO","Mixed"}. Used by pickNextDealer for skill-matching bonus and requiredGameTypes filtering.';
