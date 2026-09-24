-- Source only. Apply after 20270117000001; do not promote independently.
-- Every finishing place receives at most one ticket. Cash-only ranks are allowed.
-- ROLLBACK: owner-gated new migration may revoke v2; never reopen v1 writes
-- while ticket obligations or issued tickets exist.

CREATE OR REPLACE FUNCTION public.satellite_single_ticket_awards_v2(p_awards jsonb)
RETURNS boolean LANGUAGE plpgsql IMMUTABLE SET search_path = '' AS $$
DECLARE
  v_line jsonb;
BEGIN
  IF pg_catalog.jsonb_typeof(p_awards) IS DISTINCT FROM 'array' THEN RETURN false; END IF;
  FOR v_line IN SELECT value FROM pg_catalog.jsonb_array_elements(p_awards) LOOP
    IF pg_catalog.jsonb_typeof(v_line) IS DISTINCT FROM 'object'
       OR coalesce(v_line->>'ticketCount', '0') NOT IN ('0', '1') THEN
      RETURN false;
    END IF;
  END LOOP;
  RETURN true;
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_single_ticket_awards_v2(jsonb)
  FROM PUBLIC, anon, authenticated;

DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid = 'public.satellite_award_plans'::pg_catalog.regclass
      AND conname = 'satellite_award_one_ticket_per_rank_v2') THEN
    ALTER TABLE public.satellite_award_plans
      ADD CONSTRAINT satellite_award_one_ticket_per_rank_v2
      CHECK (public.satellite_single_ticket_awards_v2(award_lines));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION public.satellite_award_plan_v2(
  p_source_tournament_id uuid,
  p_target_tournament_id uuid,
  p_awards jsonb,
  p_lock boolean DEFAULT false
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NOT public.satellite_single_ticket_awards_v2(p_awards) THEN
    RAISE EXCEPTION 'satellite_one_ticket_per_rank' USING ERRCODE = '22023';
  END IF;
  RETURN public.satellite_award_plan_v1(
    p_source_tournament_id, p_target_tournament_id, p_awards, p_lock
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_award_plan_v1(uuid,uuid,jsonb,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON FUNCTION public.satellite_award_plan_v2(uuid,uuid,jsonb,boolean)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_award_plan_v2(uuid,uuid,jsonb,boolean)
  TO authenticated;
