-- PENDING SOURCE ONLY. Depends on Satellite ticket issue/funding (02-03).
-- A replacement rotates only the private code. The ticket row, serial,
-- recipient history, face value and source funding obligation do not change.
-- ROLLBACK: revoke this RPC in a reviewed forward migration; keep rotation
-- history and current codes. Never restore an invalidated secret code.

CREATE TABLE IF NOT EXISTS public.satellite_ticket_code_rotations (
  request_id uuid PRIMARY KEY,
  ticket_id uuid NOT NULL REFERENCES public.satellite_tickets(id) ON DELETE RESTRICT,
  old_code uuid NOT NULL UNIQUE,
  new_code uuid NOT NULL UNIQUE,
  reason text NOT NULL CHECK (length(btrim(reason)) BETWEEN 8 AND 240),
  rotated_by uuid NOT NULL REFERENCES auth.users(id),
  rotated_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT satellite_rotation_changes_code CHECK (old_code <> new_code)
);
CREATE INDEX IF NOT EXISTS satellite_ticket_rotations_ticket_idx
  ON public.satellite_ticket_code_rotations(ticket_id,rotated_at DESC);
ALTER TABLE public.satellite_ticket_code_rotations ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_ticket_code_rotations FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.satellite_rotation_immutable_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  RAISE EXCEPTION 'satellite_rotation_immutable' USING ERRCODE = '23514';
END;
$$;
DROP TRIGGER IF EXISTS satellite_rotation_immutable ON public.satellite_ticket_code_rotations;
CREATE TRIGGER satellite_rotation_immutable BEFORE UPDATE OR DELETE
  ON public.satellite_ticket_code_rotations FOR EACH ROW
  EXECUTE FUNCTION public.satellite_rotation_immutable_v1();
REVOKE ALL ON FUNCTION public.satellite_rotation_immutable_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.satellite_reject_retired_code_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF EXISTS (SELECT 1 FROM public.satellite_ticket_code_rotations r
             WHERE r.old_code=NEW.redemption_code) THEN
    RAISE EXCEPTION 'satellite_retired_code_cannot_reissue' USING ERRCODE = '23505';
  END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS satellite_reject_retired_code ON public.satellite_tickets;
CREATE TRIGGER satellite_reject_retired_code BEFORE INSERT OR UPDATE OF redemption_code
  ON public.satellite_tickets FOR EACH ROW
  EXECUTE FUNCTION public.satellite_reject_retired_code_v1();
REVOKE ALL ON FUNCTION public.satellite_reject_retired_code_v1()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.satellite_rotate_ticket_code_v1(
  p_source_tournament_id uuid,
  p_serial integer,
  p_expected_code uuid,
  p_reason text,
  p_request_id uuid
)
RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club uuid;
  v_ticket public.satellite_tickets%ROWTYPE;
  v_existing public.satellite_ticket_code_rotations%ROWTYPE;
  v_new_code uuid;
  v_try integer;
BEGIN
  IF v_actor IS NULL OR p_source_tournament_id IS NULL OR p_serial IS NULL
     OR p_serial<1 OR p_expected_code IS NULL OR p_request_id IS NULL
     OR length(btrim(coalesce(p_reason,''))) NOT BETWEEN 8 AND 240 THEN
    RAISE EXCEPTION 'satellite_rotation_invalid_request' USING ERRCODE = '22023';
  END IF;
  SELECT t.club_id INTO v_club FROM public.tournaments t
    WHERE t.id=p_source_tournament_id FOR UPDATE;
  IF v_club IS NULL OR NOT EXISTS(
    SELECT 1 FROM public.clubs c WHERE c.id=v_club AND c.owner_id=v_actor
  ) THEN
    RAISE EXCEPTION 'satellite_owner_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_ticket FROM public.satellite_tickets st
    WHERE st.source_tournament_id=p_source_tournament_id
      AND st.serial_no=p_serial AND st.club_id=v_club FOR UPDATE;
  IF v_ticket.id IS NULL THEN
    RAISE EXCEPTION 'satellite_ticket_not_found' USING ERRCODE = '22023';
  END IF;
  SELECT * INTO v_existing FROM public.satellite_ticket_code_rotations r
    WHERE r.request_id=p_request_id;
  IF v_existing.request_id IS NOT NULL THEN
    IF v_existing.ticket_id IS DISTINCT FROM v_ticket.id
       OR v_existing.old_code IS DISTINCT FROM p_expected_code
       OR v_existing.reason IS DISTINCT FROM btrim(p_reason)
       OR v_existing.rotated_by IS DISTINCT FROM v_actor THEN
      RAISE EXCEPTION 'satellite_rotation_request_conflict' USING ERRCODE = '23505';
    END IF;
    IF v_ticket.redemption_code IS DISTINCT FROM v_existing.new_code THEN
      RAISE EXCEPTION 'satellite_rotation_superseded' USING ERRCODE = '23505';
    END IF;
    RETURN jsonb_build_object('ok',true,'idempotent',true,'serial',p_serial,
      'code',v_existing.new_code,'rotationCount',(
        SELECT count(*) FROM public.satellite_ticket_code_rotations r
        WHERE r.ticket_id=v_ticket.id));
  END IF;
  IF v_ticket.status IS DISTINCT FROM 'issued'
     OR v_ticket.redemption_code IS DISTINCT FROM p_expected_code THEN
    RAISE EXCEPTION 'satellite_ticket_not_replaceable_or_stale' USING ERRCODE = '23505';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM public.satellite_award_funding f
                 WHERE f.source_tournament_id=p_source_tournament_id) THEN
    RAISE EXCEPTION 'satellite_funding_not_locked' USING ERRCODE = '23514';
  END IF;
  FOR v_try IN 1..5 LOOP
    v_new_code := gen_random_uuid();
    EXIT WHEN v_new_code<>p_expected_code
      AND NOT EXISTS(SELECT 1 FROM public.satellite_tickets st
                     WHERE st.redemption_code=v_new_code)
      AND NOT EXISTS(SELECT 1 FROM public.satellite_ticket_code_rotations r
                     WHERE r.old_code=v_new_code OR r.new_code=v_new_code);
  END LOOP;
  IF v_new_code=p_expected_code
     OR EXISTS(SELECT 1 FROM public.satellite_tickets st
               WHERE st.redemption_code=v_new_code)
     OR EXISTS(SELECT 1 FROM public.satellite_ticket_code_rotations r
               WHERE r.old_code=v_new_code OR r.new_code=v_new_code) THEN
    RAISE EXCEPTION 'satellite_new_code_collision' USING ERRCODE = '23505';
  END IF;
  UPDATE public.satellite_tickets SET redemption_code=v_new_code
    WHERE id=v_ticket.id AND status='issued' AND redemption_code=p_expected_code;
  INSERT INTO public.satellite_ticket_code_rotations
    (request_id,ticket_id,old_code,new_code,reason,rotated_by)
  VALUES (p_request_id,v_ticket.id,p_expected_code,v_new_code,btrim(p_reason),v_actor);
  RETURN jsonb_build_object('ok',true,'idempotent',false,'serial',p_serial,
    'code',v_new_code,'rotationCount',(
      SELECT count(*) FROM public.satellite_ticket_code_rotations r
      WHERE r.ticket_id=v_ticket.id));
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_rotate_ticket_code_v1(uuid,integer,uuid,text,uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_rotate_ticket_code_v1(uuid,integer,uuid,text,uuid)
  TO authenticated;
