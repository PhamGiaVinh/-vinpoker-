-- Series Intelligence — OFFICIAL club-wide "regime changed" flag (+ audit). SOURCE-ONLY.
--
-- The LOCAL switch (PR5b, localStorage) is per-browser. This is the club-wide upgrade: one
-- authoritative regime mark per club, visible to every operator, with an append-only audit of who
-- flipped it and when. Forward-looking Series numbers escalate their caveat when `changed` is true.
--
-- ⚠️ NOT APPLIED. Owner-gated: apply in a controlled SQL-Editor session (this file ships in the repo
-- for review only). The whole body is wrapped in BEGIN/ROLLBACK below so pasting it is a self-test
-- that changes NOTHING; to actually apply, run the statements between the two marked lines inside
-- your own transaction (or strip the ROLLBACK harness). No client wiring ships until this is live.
--
-- Anchors (verified against existing migrations): public.clubs(id), public.is_club_owner(uid, club_id),
-- gen_random_uuid(), the RLS/definer idioms from the series-capture-autosync migration.

BEGIN;  -- ===== SELF-TEST HARNESS (ends in ROLLBACK) — remove for a real apply =====

-- >>> APPLY FROM HERE >>>

CREATE TABLE IF NOT EXISTS public.series_regime_state (
  club_id     uuid PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  changed     boolean NOT NULL DEFAULT false,
  note        text,
  changed_at  timestamptz,
  changed_by  uuid REFERENCES auth.users(id),
  updated_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS public.series_regime_audit (
  id       uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id  uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  changed  boolean NOT NULL,
  note     text,
  actor    uuid REFERENCES auth.users(id),
  at       timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS sra_club_at_idx ON public.series_regime_audit (club_id, at DESC);

ALTER TABLE public.series_regime_state ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.series_regime_audit ENABLE ROW LEVEL SECURITY;

-- SELECT only, club owner, own club. Writes go ONLY through the SECURITY DEFINER RPC (no write policy).
DROP POLICY IF EXISTS srs_select ON public.series_regime_state;
CREATE POLICY srs_select ON public.series_regime_state
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

DROP POLICY IF EXISTS sra_select ON public.series_regime_audit;
CREATE POLICY sra_select ON public.series_regime_audit
  FOR SELECT TO authenticated
  USING (club_id IS NOT NULL AND public.is_club_owner(auth.uid(), club_id));

-- Owner-only setter: upsert the state + append one audit row. changed_at keeps the ORIGINAL stamp
-- while it stays `changed` (editing the note doesn't reset the clock); cleared when unset.
CREATE OR REPLACE FUNCTION public.set_club_regime_state(
  p_club_id uuid,
  p_changed boolean,
  p_note    text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_changed boolean := COALESCE(p_changed, false);
BEGIN
  IF p_club_id IS NULL OR NOT public.is_club_owner(v_actor, p_club_id) THEN
    RETURN jsonb_build_object('error', 'not_club_owner');
  END IF;

  INSERT INTO public.series_regime_state AS s (club_id, changed, note, changed_at, changed_by, updated_at)
  VALUES (p_club_id, v_changed, p_note, CASE WHEN v_changed THEN now() ELSE NULL END, v_actor, now())
  ON CONFLICT (club_id) DO UPDATE SET
    changed    = EXCLUDED.changed,
    note       = EXCLUDED.note,
    changed_at = CASE WHEN EXCLUDED.changed THEN COALESCE(s.changed_at, now()) ELSE NULL END,
    changed_by = v_actor,
    updated_at = now();

  INSERT INTO public.series_regime_audit (club_id, changed, note, actor)
  VALUES (p_club_id, v_changed, p_note, v_actor);

  RETURN jsonb_build_object('status', 'ok');
END $$;

REVOKE ALL ON FUNCTION public.set_club_regime_state(uuid, boolean, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.set_club_regime_state(uuid, boolean, text) TO authenticated;

-- <<< APPLY TO HERE <<<

-- ===== self-test: prove the objects exist + the owner-guard rejects a non-owner =====
DO $$
DECLARE r jsonb;
BEGIN
  ASSERT to_regclass('public.series_regime_state') IS NOT NULL, 'state table missing';
  ASSERT to_regclass('public.series_regime_audit') IS NOT NULL, 'audit table missing';
  -- auth.uid() is NULL in this harness → is_club_owner(NULL, random) is false → not_club_owner.
  r := public.set_club_regime_state('00000000-0000-0000-0000-000000000000'::uuid, true, 'selftest');
  ASSERT r ? 'error', 'guard should reject a non-owner in the harness';
END $$;

ROLLBACK;  -- ===== nothing above is persisted — remove BEGIN/ROLLBACK to apply for real =====
