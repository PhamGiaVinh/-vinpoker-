-- Satellite ticket issuance. PENDING SOURCE ONLY; depends on award plan v1.
-- NOT READY TO PROMOTE: source prize/overlay funding and target voucher-tender
-- reconciliation are not implemented. No production apply, even independently.
-- TD locks a rank->winner snapshot; server issues exactly the planned quantity.
-- A random redemption code is separate from the sequential reconciliation serial.
-- ROLLBACK: keep issued rows for audit. Disable the client and revoke RPC EXECUTE
-- through a new reviewed migration; do not drop populated ticket history.

CREATE TABLE IF NOT EXISTS public.satellite_award_issues (
  source_tournament_id uuid PRIMARY KEY REFERENCES public.satellite_award_plans(source_tournament_id) ON DELETE RESTRICT,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  locked_results jsonb NOT NULL CHECK (jsonb_typeof(locked_results) = 'array'),
  ticket_total integer NOT NULL CHECK (ticket_total > 0 AND ticket_total <= 500),
  cash_total_vnd bigint NOT NULL CHECK (cash_total_vnd >= 0),
  issued_by uuid NOT NULL REFERENCES auth.users(id),
  issued_at timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.satellite_award_issues ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_award_issues FROM PUBLIC, anon, authenticated;

CREATE TABLE IF NOT EXISTS public.satellite_tickets (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  source_tournament_id uuid NOT NULL REFERENCES public.satellite_award_issues(source_tournament_id) ON DELETE RESTRICT,
  target_tournament_id uuid NOT NULL REFERENCES public.tournaments(id) ON DELETE RESTRICT,
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE RESTRICT,
  serial_no integer NOT NULL CHECK (serial_no > 0 AND serial_no <= 500),
  award_position integer NOT NULL CHECK (award_position > 0),
  winner_player_id uuid NOT NULL,
  target_entry_price_vnd bigint NOT NULL CHECK (target_entry_price_vnd > 0),
  redemption_code uuid NOT NULL DEFAULT gen_random_uuid(),
  status text NOT NULL DEFAULT 'issued' CHECK (status IN ('issued','redeemed','voided')),
  issued_at timestamptz NOT NULL DEFAULT now(),
  redeemed_at timestamptz,
  redeemed_by uuid REFERENCES auth.users(id),
  redeemed_for_player_id uuid,
  registration_id uuid REFERENCES public.tournament_registrations(id),
  voided_at timestamptz,
  voided_by uuid REFERENCES auth.users(id),
  void_reason text,
  CONSTRAINT satellite_tickets_serial_unique UNIQUE (source_tournament_id, serial_no),
  CONSTRAINT satellite_tickets_code_unique UNIQUE (redemption_code),
  CONSTRAINT satellite_tickets_status_shape CHECK (
    (status = 'issued' AND redeemed_at IS NULL AND redeemed_by IS NULL
      AND redeemed_for_player_id IS NULL AND registration_id IS NULL AND voided_at IS NULL)
    OR (status = 'redeemed' AND redeemed_at IS NOT NULL AND redeemed_by IS NOT NULL
      AND redeemed_for_player_id IS NOT NULL AND registration_id IS NOT NULL AND voided_at IS NULL)
    OR (status = 'voided' AND voided_at IS NOT NULL AND voided_by IS NOT NULL
      AND void_reason IS NOT NULL AND redeemed_at IS NULL AND registration_id IS NULL)
  )
);
CREATE INDEX IF NOT EXISTS satellite_tickets_target_status_idx
  ON public.satellite_tickets(target_tournament_id, status);
ALTER TABLE public.satellite_tickets ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.satellite_tickets FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.satellite_issue_tickets_v1(
  p_source_tournament_id uuid,
  p_results jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_source public.tournaments%ROWTYPE;
  v_target public.tournaments%ROWTYPE;
  v_plan public.satellite_award_plans%ROWTYPE;
  v_issue public.satellite_award_issues%ROWTYPE;
  v_id uuid;
  v_target_id uuid;
  v_row jsonb;
  v_award jsonb;
  v_recipient jsonb;
  v_results jsonb := '[]'::jsonb;
  v_position integer;
  v_player uuid;
  v_seen_positions integer[] := ARRAY[]::integer[];
  v_seen_players uuid[] := ARRAY[]::uuid[];
  v_serial integer := 0;
  v_count integer;
  v_cash_total numeric := 0;
  v_tickets jsonb;
BEGIN
  IF v_actor IS NULL OR p_source_tournament_id IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  IF jsonb_typeof(p_results) IS DISTINCT FROM 'array' THEN
    RAISE EXCEPTION 'satellite_results_invalid' USING ERRCODE = '22023';
  END IF;
  IF jsonb_array_length(p_results) NOT BETWEEN 1 AND 100 THEN
    RAISE EXCEPTION 'satellite_results_invalid' USING ERRCODE = '22023';
  END IF;

  -- Preserve the award-plan lock order: tournament rows by UUID, then plan.
  SELECT target_tournament_id INTO v_target_id FROM public.satellite_award_plans
    WHERE source_tournament_id = p_source_tournament_id;
  IF v_target_id IS NULL THEN
    RAISE EXCEPTION 'satellite_plan_not_locked' USING ERRCODE = '22023';
  END IF;
  FOR v_id IN SELECT t.id FROM public.tournaments t
    WHERE t.id IN (p_source_tournament_id, v_target_id) ORDER BY t.id
  LOOP
    PERFORM 1 FROM public.tournaments t WHERE t.id = v_id FOR UPDATE;
  END LOOP;
  SELECT * INTO v_plan FROM public.satellite_award_plans p
    WHERE p.source_tournament_id = p_source_tournament_id FOR UPDATE;
  SELECT * INTO v_source FROM public.tournaments t WHERE t.id = p_source_tournament_id;
  SELECT * INTO v_target FROM public.tournaments t WHERE t.id = v_plan.target_tournament_id;
  IF v_source.id IS NULL OR v_target.id IS NULL
     OR v_source.club_id IS DISTINCT FROM v_plan.club_id
     OR v_target.club_id IS DISTINCT FROM v_plan.club_id THEN
    RAISE EXCEPTION 'satellite_scope_invalid' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    EXISTS (SELECT 1 FROM public.clubs c
            WHERE c.id = v_plan.club_id AND c.owner_id = v_actor)
    OR public.is_club_floor(v_actor, v_plan.club_id)
    OR public.has_role(v_actor, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE = '42501';
  END IF;
  IF jsonb_array_length(p_results) <> jsonb_array_length(v_plan.award_lines) THEN
    RAISE EXCEPTION 'satellite_result_count_mismatch' USING ERRCODE = '22023';
  END IF;
  FOR v_row IN SELECT value FROM jsonb_array_elements(p_results) LOOP
    IF jsonb_typeof(v_row) IS DISTINCT FROM 'object'
       OR coalesce(v_row->>'position','') !~ '^[1-9][0-9]{0,4}$'
       OR coalesce(v_row->>'playerId','') !~ '^[0-9a-fA-F-]{36}$' THEN
      RAISE EXCEPTION 'satellite_result_row_invalid' USING ERRCODE = '22023';
    END IF;
    v_position := (v_row->>'position')::integer;
    v_player := (v_row->>'playerId')::uuid;
    IF v_position = ANY(v_seen_positions) OR v_player = ANY(v_seen_players) THEN
      RAISE EXCEPTION 'satellite_result_duplicate' USING ERRCODE = '22023';
    END IF;
    IF NOT EXISTS (
      SELECT 1 FROM public.tournament_registrations r
      WHERE r.tournament_id = p_source_tournament_id
        AND r.player_id = v_player AND r.status = 'confirmed'
    ) OR NOT EXISTS (
      SELECT 1 FROM public.tournament_entries e
      WHERE e.tournament_id = p_source_tournament_id AND e.player_id = v_player
        AND e.status <> 'cancelled'
    ) THEN
      RAISE EXCEPTION 'satellite_winner_not_registered' USING ERRCODE = '22023';
    END IF;
    v_seen_positions := array_append(v_seen_positions, v_position);
    v_seen_players := array_append(v_seen_players, v_player);
  END LOOP;

  FOR v_award IN SELECT value FROM jsonb_array_elements(v_plan.award_lines) LOOP
    v_position := (v_award->>'position')::integer;
    SELECT value INTO v_recipient FROM jsonb_array_elements(p_results)
      WHERE (value->>'position')::integer = v_position;
    IF v_recipient IS NULL THEN
      RAISE EXCEPTION 'satellite_result_rank_missing' USING ERRCODE = '22023';
    END IF;
    v_results := v_results || jsonb_build_array(jsonb_build_object(
      'position', v_position,
      'playerId', (v_recipient->>'playerId')::uuid::text,
      'ticketCount', (v_award->>'ticketCount')::integer,
      'cashVnd', v_award->>'cashVnd'
    ));
    v_cash_total := v_cash_total + (v_award->>'cashVnd')::numeric;
  END LOOP;
  SELECT jsonb_agg(x.value ORDER BY (x.value->>'position')::integer)
    INTO v_results FROM jsonb_array_elements(v_results) AS x(value);

  SELECT * INTO v_issue FROM public.satellite_award_issues i
    WHERE i.source_tournament_id = p_source_tournament_id;
  IF v_issue.source_tournament_id IS NOT NULL THEN
    IF v_issue.locked_results IS DISTINCT FROM v_results THEN
      RAISE EXCEPTION 'satellite_issued_results_different' USING ERRCODE = '23505';
    END IF;
  ELSE
    IF v_source.status::text <> 'completed'
       OR NOT EXISTS (SELECT 1 FROM public.tournament_close_report r
                      WHERE r.tournament_id = p_source_tournament_id)
       OR v_target.status::text NOT IN ('scheduled','live')
       OR v_target.registration_closed_at IS NOT NULL THEN
      RAISE EXCEPTION 'satellite_results_not_ready' USING ERRCODE = '22023';
    END IF;
    INSERT INTO public.satellite_award_issues (
      source_tournament_id, club_id, locked_results, ticket_total,
      cash_total_vnd, issued_by
    ) VALUES (
      p_source_tournament_id, v_plan.club_id, v_results,
      v_plan.ticket_total, v_cash_total::bigint, v_actor
    );
    FOR v_award IN SELECT value FROM jsonb_array_elements(v_results)
      ORDER BY (value->>'position')::integer
    LOOP
      v_count := (v_award->>'ticketCount')::integer;
      FOR i IN 1..v_count LOOP
        v_serial := v_serial + 1;
        INSERT INTO public.satellite_tickets (
          source_tournament_id, target_tournament_id, club_id,
          serial_no, award_position, winner_player_id, target_entry_price_vnd
        ) VALUES (
          p_source_tournament_id, v_plan.target_tournament_id, v_plan.club_id,
          v_serial, (v_award->>'position')::integer,
          (v_award->>'playerId')::uuid, v_plan.target_entry_price_vnd
        );
      END LOOP;
    END LOOP;
    IF v_serial <> v_plan.ticket_total OR v_cash_total <> v_plan.cash_total_vnd THEN
      RAISE EXCEPTION 'satellite_issue_total_mismatch' USING ERRCODE = '23514';
    END IF;
  END IF;

  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'serial', t.serial_no, 'code', t.redemption_code,
    'position', t.award_position, 'winnerPlayerId', t.winner_player_id,
    'targetTournamentId', t.target_tournament_id,
    'targetEntryPriceVnd', t.target_entry_price_vnd::text,
    'status', t.status
  ) ORDER BY t.serial_no), '[]'::jsonb) INTO v_tickets
  FROM public.satellite_tickets t
  WHERE t.source_tournament_id = p_source_tournament_id;
  RETURN jsonb_build_object(
    'ok', true, 'issued', true, 'sourceTournamentId', p_source_tournament_id,
    'targetTournamentId', v_plan.target_tournament_id,
    'ticketTotal', v_plan.ticket_total,
    'cashTotalVnd', v_plan.cash_total_vnd::text,
    'results', v_results, 'tickets', v_tickets
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_issue_tickets_v1(uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_issue_tickets_v1(uuid,jsonb)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.satellite_get_issuance_v1(p_source_tournament_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_issue public.satellite_award_issues%ROWTYPE;
  v_tickets jsonb;
BEGIN
  IF v_actor IS NULL OR p_source_tournament_id IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_issue FROM public.satellite_award_issues
    WHERE source_tournament_id = p_source_tournament_id;
  IF v_issue.source_tournament_id IS NULL THEN
    -- Scope-check via the existing plan RPC even before issuance.
    PERFORM public.satellite_get_award_plan_v1(p_source_tournament_id);
    RETURN jsonb_build_object('ok', true, 'issued', false);
  END IF;
  IF NOT (
    EXISTS (SELECT 1 FROM public.clubs c
            WHERE c.id = v_issue.club_id AND c.owner_id = v_actor)
    OR public.is_club_floor(v_actor, v_issue.club_id)
    OR public.has_role(v_actor, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'serial', t.serial_no, 'code', t.redemption_code,
    'position', t.award_position, 'winnerPlayerId', t.winner_player_id,
    'targetTournamentId', t.target_tournament_id,
    'targetEntryPriceVnd', t.target_entry_price_vnd::text,
    'status', t.status
  ) ORDER BY t.serial_no), '[]'::jsonb) INTO v_tickets
  FROM public.satellite_tickets t
  WHERE t.source_tournament_id = p_source_tournament_id;
  RETURN jsonb_build_object(
    'ok', true, 'issued', true, 'ticketTotal', v_issue.ticket_total,
    'cashTotalVnd', v_issue.cash_total_vnd::text,
    'results', v_issue.locked_results, 'tickets', v_tickets,
    'issuedAt', v_issue.issued_at
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_get_issuance_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_get_issuance_v1(uuid)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.satellite_get_award_candidates_v1(
  p_source_tournament_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_club_id uuid;
  v_players jsonb;
BEGIN
  IF v_actor IS NULL OR p_source_tournament_id IS NULL THEN
    RAISE EXCEPTION 'satellite_auth_required' USING ERRCODE = '42501';
  END IF;
  SELECT t.club_id INTO v_club_id FROM public.tournaments t
  WHERE t.id = p_source_tournament_id AND t.operations_mode = 'satellite';
  IF v_club_id IS NULL THEN
    RAISE EXCEPTION 'satellite_source_not_found' USING ERRCODE = '22023';
  END IF;
  IF NOT (
    EXISTS (SELECT 1 FROM public.clubs c
            WHERE c.id = v_club_id AND c.owner_id = v_actor)
    OR public.is_club_floor(v_actor, v_club_id)
    OR public.has_role(v_actor, 'super_admin'::public.app_role)
  ) THEN
    RAISE EXCEPTION 'satellite_actor_not_allowed' USING ERRCODE = '42501';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object(
    'playerId', r.player_id,
    'displayName', coalesce(
      (SELECT nullif(btrim(s.player_name),'') FROM public.tournament_seats s
       WHERE s.tournament_id = p_source_tournament_id
         AND s.player_id = r.player_id
       ORDER BY s.assigned_at DESC, s.id DESC LIMIT 1),
      (SELECT nullif(btrim(p.display_name),'') FROM public.profiles p
       WHERE p.user_id = r.player_id LIMIT 1),
      left(r.player_id::text, 8)
    )
  ) ORDER BY r.player_id), '[]'::jsonb) INTO v_players
  FROM (
    SELECT DISTINCT reg.player_id
    FROM public.tournament_registrations reg
    WHERE reg.tournament_id = p_source_tournament_id
      AND reg.status = 'confirmed'
      AND EXISTS (SELECT 1 FROM public.tournament_entries e
                  WHERE e.tournament_id = p_source_tournament_id
                    AND e.player_id = reg.player_id AND e.status <> 'cancelled')
  ) r;
  RETURN jsonb_build_object('ok', true, 'players', v_players);
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_get_award_candidates_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_get_award_candidates_v1(uuid)
  TO authenticated;
