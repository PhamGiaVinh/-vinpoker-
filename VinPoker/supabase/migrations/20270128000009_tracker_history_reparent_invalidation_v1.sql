-- Tracker History reparent invalidation (SOURCE-ONLY, CRITICAL/RED).
-- A child UPDATE may move outcome-relevant evidence from hand A to hand B.
-- Lock every affected hand in UUID order, then invalidate and enqueue each hand
-- exactly once so opposite A->B / B->A moves cannot acquire parent locks in
-- opposite order.
--
-- Rollback: replace tracker_bump_hand_source_revision() with the immediately
-- preceding 20270128000004 definition. Do not roll back by deleting queue or
-- settlement audit rows; they are retained evidence.

CREATE OR REPLACE FUNCTION public.tracker_bump_hand_source_revision()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_hand_ids uuid[];
  v_hand_id uuid;
BEGIN
  IF TG_TABLE_NAME = 'tournament_hands' THEN
    PERFORM public.tracker_mark_prior_settlements_stale(OLD.id);
    NEW.source_revision := COALESCE(OLD.source_revision, 1) + 1;
    NEW.updated_at := pg_catalog.now();
    RETURN NEW;
  END IF;

  IF TG_OP = 'INSERT' THEN
    v_hand_ids := ARRAY[NEW.hand_id];
  ELSIF TG_OP = 'DELETE' THEN
    v_hand_ids := ARRAY[OLD.hand_id];
  ELSE
    v_hand_ids := ARRAY[OLD.hand_id, NEW.hand_id];
  END IF;

  -- Acquire all parent locks before mutating either parent. DISTINCT preserves
  -- same-hand UPDATE semantics; ORDER BY gives every reparent the same order.
  FOR v_hand_id IN
    SELECT candidate.hand_id
    FROM pg_catalog.unnest(v_hand_ids) AS candidate(hand_id)
    WHERE candidate.hand_id IS NOT NULL
    GROUP BY candidate.hand_id
    ORDER BY candidate.hand_id
  LOOP
    PERFORM h.id
    FROM public.tournament_hands AS h
    WHERE h.id = v_hand_id
    FOR UPDATE;
  END LOOP;

  FOR v_hand_id IN
    SELECT candidate.hand_id
    FROM pg_catalog.unnest(v_hand_ids) AS candidate(hand_id)
    WHERE candidate.hand_id IS NOT NULL
    GROUP BY candidate.hand_id
    ORDER BY candidate.hand_id
  LOOP
    UPDATE public.tournament_hands
    SET source_revision = source_revision + 1,
        updated_at = pg_catalog.now()
    WHERE id = v_hand_id;

    PERFORM public.tracker_mark_prior_settlements_stale(v_hand_id);
  END LOOP;

  RETURN COALESCE(NEW, OLD);
END;
$$;

ALTER FUNCTION public.tracker_bump_hand_source_revision() OWNER TO postgres;
REVOKE ALL ON FUNCTION public.tracker_bump_hand_source_revision()
  FROM PUBLIC, anon, authenticated, service_role;
