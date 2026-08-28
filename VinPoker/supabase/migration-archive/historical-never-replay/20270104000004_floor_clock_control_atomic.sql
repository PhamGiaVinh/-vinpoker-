-- Floor clock controls must not grant club operators direct UPDATE access to
-- the entire tournaments row. The existing Edge function runs with the
-- caller's JWT, so RLS correctly rejects its direct pause/resume/level writes
-- for club_floors. This caller-bound RPC locks one tournament and changes only
-- the clock fields required by the requested action.
-- SOURCE ONLY: production apply and Edge deployment remain separate owner gates.
--
-- ROLLBACK (only after the frontend and Edge consumers have been rolled back):
-- add a forward migration that restores the reviewed prior bodies and grants
-- for floor_start_tournament_clock and get_tournament_clock, then drops
-- floor_control_tournament_clock. Do not edit migration history.

BEGIN;

-- Forward hardening for the already-granted start RPC. The legacy enum includes
-- `finished`, while newer environments may also include `completed`; compare as
-- text so either schema shape fails closed without an invalid-enum exception.
CREATE OR REPLACE FUNCTION public.floor_start_tournament_clock(
  p_tournament_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour RECORD;
  v_level INTEGER;
  v_authorized BOOLEAN;
  v_started_at TIMESTAMPTZ;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  SELECT * INTO v_tour
  FROM public.tournaments
  WHERE id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      LEFT JOIN public.club_cashiers cc
        ON cc.club_id = c.id AND cc.user_id = v_actor
      WHERE c.id = v_tour.club_id
        AND (c.owner_id = v_actor OR cc.user_id IS NOT NULL)
    ) OR public.is_club_floor(v_actor, v_tour.club_id)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  IF v_tour.status::TEXT IN ('completed', 'cancelled', 'finished') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF EXISTS (
    SELECT 1 FROM public.tournament_close_report
    WHERE tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_already_closed');
  END IF;
  IF v_tour.clock_started_at IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clock_already_started');
  END IF;

  v_level := v_tour.current_level;
  IF v_level IS NULL THEN
    SELECT level_number INTO v_level
    FROM public.tournament_levels
    WHERE tournament_id = p_tournament_id
    ORDER BY level_number ASC
    LIMIT 1;
  END IF;
  IF v_level IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'no_tournament_level');
  END IF;

  UPDATE public.tournaments
  SET status = 'live',
      current_level = v_level,
      clock_started_at = clock_timestamp(),
      clock_paused_at = NULL,
      pause_accumulated = 0,
      updated_at = now()
  WHERE id = p_tournament_id
    AND clock_started_at IS NULL
  RETURNING clock_started_at INTO v_started_at;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clock_already_started');
  END IF;

  IF v_tour.status IS DISTINCT FROM 'live' THEN
    INSERT INTO public.tournament_state_transitions (
      tournament_id, previous_state, new_state, changed_by, reason
    ) VALUES (
      p_tournament_id, v_tour.status, 'live', v_actor, 'floor_clock_started'
    );
  END IF;

  INSERT INTO public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, payload
  ) VALUES (
    v_tour.club_id, v_actor, 'floor_tournament_clock_started', 'tournament', p_tournament_id,
    jsonb_build_object(
      'previous_status', v_tour.status,
      'current_level', v_level,
      'clock_started_at', v_started_at
    )
  );

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', 'clock_started',
    'current_level', v_level,
    'clock_started_at', v_started_at
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_start_tournament_clock(UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.floor_start_tournament_clock(UUID) TO authenticated;

-- Return an opaque revision derived from every mutable clock field. Browser
-- controls must echo this exact revision so two tabs sharing one rendered
-- snapshot cannot both commit a clock mutation.
CREATE OR REPLACE FUNCTION public.get_tournament_clock(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
AS $$
DECLARE
  v_tournament RECORD;
  v_elapsed INTEGER;
  v_remaining INTEGER;
  v_current_level RECORD;
  v_is_running BOOLEAN;
  v_is_break BOOLEAN;
  v_control_revision TEXT;
BEGIN
  SELECT * INTO v_tournament
  FROM public.tournaments
  WHERE id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Tournament not found');
  END IF;

  v_control_revision := md5(jsonb_build_array(
    v_tournament.current_level,
    EXTRACT(EPOCH FROM v_tournament.clock_started_at),
    EXTRACT(EPOCH FROM v_tournament.clock_paused_at),
    COALESCE(v_tournament.pause_accumulated, 0)
  )::TEXT);

  IF v_tournament.clock_started_at IS NULL THEN
    RETURN jsonb_build_object(
      'tournament_id', p_tournament_id,
      'status', v_tournament.status,
      'is_running', false,
      'elapsed_seconds', 0,
      'remaining_seconds', 0,
      'clock_paused_at', NULL,
      'current_level', NULL,
      'is_break', false,
      'message', 'Clock not started',
      'control_revision', v_control_revision
    );
  END IF;

  v_elapsed := EXTRACT(EPOCH FROM (
    COALESCE(v_tournament.clock_paused_at, now())
      - v_tournament.clock_started_at
  ))::INTEGER - COALESCE(v_tournament.pause_accumulated, 0);

  SELECT * INTO v_current_level
  FROM public.tournament_levels
  WHERE tournament_id = p_tournament_id
    AND level_number = v_tournament.current_level;

  IF NOT FOUND THEN
    RETURN jsonb_build_object(
      'tournament_id', p_tournament_id,
      'status', v_tournament.status,
      'is_running', false,
      'elapsed_seconds', v_elapsed,
      'remaining_seconds', 0,
      'clock_paused_at', v_tournament.clock_paused_at,
      'current_level', NULL,
      'is_break', false,
      'message', 'Current level not found',
      'control_revision', v_control_revision
    );
  END IF;

  v_remaining := (v_current_level.duration_minutes * 60) - v_elapsed;
  v_is_break := v_current_level.is_break;
  v_is_running := v_tournament.status::TEXT IN ('live', 'final_table')
    AND v_tournament.clock_paused_at IS NULL;

  RETURN jsonb_build_object(
    'tournament_id', p_tournament_id,
    'status', v_tournament.status,
    'is_running', v_is_running,
    'elapsed_seconds', v_elapsed,
    'remaining_seconds', GREATEST(v_remaining, 0),
    'clock_paused_at', v_tournament.clock_paused_at,
    'current_level', jsonb_build_object(
      'id', v_current_level.id,
      'level_number', v_current_level.level_number,
      'small_blind', v_current_level.small_blind,
      'big_blind', v_current_level.big_blind,
      'ante', v_current_level.ante,
      'duration_minutes', v_current_level.duration_minutes,
      'is_break', v_current_level.is_break
    ),
    'is_break', v_is_break,
    'next_level', (
      SELECT jsonb_build_object(
        'id', id,
        'level_number', level_number,
        'small_blind', small_blind,
        'big_blind', big_blind,
        'ante', ante,
        'duration_minutes', duration_minutes,
        'is_break', is_break
      )
      FROM public.tournament_levels
      WHERE tournament_id = p_tournament_id
        AND level_number = v_tournament.current_level + 1
    ),
    'control_revision', v_control_revision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_tournament_clock(UUID)
FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_tournament_clock(UUID)
TO anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public.floor_control_tournament_clock(
  p_tournament_id UUID,
  p_action TEXT,
  p_delta_seconds INTEGER DEFAULT NULL,
  p_expected_control_revision TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor UUID := auth.uid();
  v_tour public.tournaments%ROWTYPE;
  v_authorized BOOLEAN := false;
  v_now TIMESTAMPTZ;
  v_target_level INTEGER;
  v_level_duration_seconds INTEGER;
  v_elapsed_seconds INTEGER;
  v_current_remaining_seconds INTEGER;
  v_target_remaining_seconds INTEGER;
  v_target_elapsed_seconds INTEGER;
  v_paused_seconds INTEGER;
  v_reference_time TIMESTAMPTZ;
  v_new_started_at TIMESTAMPTZ;
  v_current_control_revision TEXT;
  v_outcome TEXT;
  v_changed BOOLEAN := false;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_action IS NULL OR p_action NOT IN (
    'pause', 'resume', 'next_level', 'previous_level', 'adjust_time'
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_action');
  END IF;
  IF p_action = 'adjust_time' AND p_delta_seconds IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delta_must_be_integer');
  END IF;
  IF p_action = 'adjust_time'
    AND (p_delta_seconds < -86400 OR p_delta_seconds > 86400) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'delta_too_large');
  END IF;

  SELECT *
  INTO v_tour
  FROM public.tournaments t
  WHERE t.id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT (
    EXISTS (
      SELECT 1
      FROM public.clubs c
      WHERE c.id = v_tour.club_id
        AND c.owner_id = v_actor
    )
    OR EXISTS (
      SELECT 1
      FROM public.club_cashiers cc
      WHERE cc.club_id = v_tour.club_id
        AND cc.user_id = v_actor
    )
    OR EXISTS (
      SELECT 1
      FROM public.club_floors cf
      WHERE cf.club_id = v_tour.club_id
        AND cf.user_id = v_actor
    )
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  IF v_tour.status::TEXT IN ('completed', 'cancelled', 'finished') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.tournament_close_report tcr
    WHERE tcr.tournament_id = p_tournament_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_already_closed');
  END IF;
  IF v_tour.clock_started_at IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'clock_not_started');
  END IF;
  v_current_control_revision := md5(jsonb_build_array(
    v_tour.current_level,
    EXTRACT(EPOCH FROM v_tour.clock_started_at),
    EXTRACT(EPOCH FROM v_tour.clock_paused_at),
    COALESCE(v_tour.pause_accumulated, 0)
  )::TEXT);
  IF p_expected_control_revision IS NULL
    OR p_expected_control_revision !~ '^[0-9a-f]{32}$' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'expected_control_revision_required'
    );
  END IF;
  IF v_current_control_revision IS DISTINCT FROM p_expected_control_revision THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_clock_state');
  END IF;

  v_now := clock_timestamp();

  CASE
    WHEN p_action = 'pause' THEN
      IF v_tour.clock_paused_at IS NULL THEN
        UPDATE public.tournaments
        SET clock_paused_at = v_now,
            updated_at = now()
        WHERE id = p_tournament_id;
        v_tour.clock_paused_at := v_now;
        v_changed := true;
        v_outcome := 'clock_paused';
      ELSE
        v_outcome := 'clock_already_paused';
      END IF;

    WHEN p_action = 'resume' THEN
      IF v_tour.clock_paused_at IS NOT NULL THEN
        v_paused_seconds := GREATEST(
          0,
          FLOOR(EXTRACT(EPOCH FROM (v_now - v_tour.clock_paused_at)))::INTEGER
        );
        UPDATE public.tournaments
        SET clock_paused_at = NULL,
            pause_accumulated = COALESCE(v_tour.pause_accumulated, 0) + v_paused_seconds,
            updated_at = now()
        WHERE id = p_tournament_id;
        v_tour.clock_paused_at := NULL;
        v_tour.pause_accumulated := COALESCE(v_tour.pause_accumulated, 0) + v_paused_seconds;
        v_changed := true;
        v_outcome := 'clock_resumed';
      ELSE
        v_outcome := 'clock_already_running';
      END IF;

    WHEN p_action IN ('next_level', 'previous_level') THEN
      v_target_level := v_tour.current_level
        + CASE WHEN p_action = 'next_level' THEN 1 ELSE -1 END;
      IF v_target_level < 1 THEN
        RETURN jsonb_build_object('ok', false, 'error', 'already_first_level');
      END IF;
      IF NOT EXISTS (
        SELECT 1
        FROM public.tournament_levels tl
        WHERE tl.tournament_id = p_tournament_id
          AND tl.level_number = v_target_level
      ) THEN
        RETURN jsonb_build_object('ok', false, 'error', 'target_level_missing');
      END IF;
      UPDATE public.tournaments
      SET current_level = v_target_level,
          clock_started_at = v_now,
          clock_paused_at = CASE
            WHEN v_tour.clock_paused_at IS NULL THEN NULL
            ELSE v_now
          END,
          pause_accumulated = 0,
          updated_at = now()
      WHERE id = p_tournament_id;
      v_tour.current_level := v_target_level;
      v_tour.clock_started_at := v_now;
      IF v_tour.clock_paused_at IS NOT NULL THEN
        v_tour.clock_paused_at := v_now;
      END IF;
      v_tour.pause_accumulated := 0;
      v_changed := true;
      v_outcome := CASE
        WHEN p_action = 'next_level' THEN 'clock_level_advanced'
        ELSE 'clock_level_rewound'
      END;

    WHEN p_action = 'adjust_time' THEN
      SELECT tl.duration_minutes * 60
      INTO v_level_duration_seconds
      FROM public.tournament_levels tl
      WHERE tl.tournament_id = p_tournament_id
        AND tl.level_number = v_tour.current_level;
      IF NOT FOUND OR v_level_duration_seconds IS NULL THEN
        RETURN jsonb_build_object('ok', false, 'error', 'current_level_missing');
      END IF;

      v_reference_time := COALESCE(v_tour.clock_paused_at, v_now);
      v_elapsed_seconds := FLOOR(EXTRACT(EPOCH FROM (
        v_reference_time - v_tour.clock_started_at
      )))::INTEGER - COALESCE(v_tour.pause_accumulated, 0);
      v_current_remaining_seconds := GREATEST(
        0,
        LEAST(v_level_duration_seconds, v_level_duration_seconds - v_elapsed_seconds)
      );
      v_target_remaining_seconds := GREATEST(
        0,
        LEAST(
          v_level_duration_seconds,
          v_current_remaining_seconds + p_delta_seconds
        )
      );
      v_target_elapsed_seconds := v_level_duration_seconds - v_target_remaining_seconds;

      IF v_target_remaining_seconds = v_current_remaining_seconds THEN
        v_outcome := 'clock_time_unchanged';
      ELSE
        v_new_started_at := v_reference_time
          - make_interval(
              secs => COALESCE(v_tour.pause_accumulated, 0) + v_target_elapsed_seconds
            );
        UPDATE public.tournaments
        SET clock_started_at = v_new_started_at,
            updated_at = now()
        WHERE id = p_tournament_id;
        v_tour.clock_started_at := v_new_started_at;
        v_changed := true;
        v_outcome := 'clock_time_adjusted';
      END IF;
  END CASE;

  IF v_changed THEN
    INSERT INTO public.audit_logs (
      club_id, actor_id, action, entity_type, entity_id, payload
    ) VALUES (
      v_tour.club_id,
      v_actor,
      'floor_tournament_clock_controlled',
      'tournament',
      p_tournament_id,
      jsonb_build_object(
        'clock_action', p_action,
        'outcome', v_outcome,
        'current_level', v_tour.current_level,
        'delta_seconds', CASE WHEN p_action = 'adjust_time' THEN p_delta_seconds ELSE NULL END
      )
    );
  END IF;

  v_current_control_revision := md5(jsonb_build_array(
    v_tour.current_level,
    EXTRACT(EPOCH FROM v_tour.clock_started_at),
    EXTRACT(EPOCH FROM v_tour.clock_paused_at),
    COALESCE(v_tour.pause_accumulated, 0)
  )::TEXT);

  RETURN jsonb_build_object(
    'ok', true,
    'outcome', v_outcome,
    'changed', v_changed,
    'current_level', v_tour.current_level,
    'clock_started_at', v_tour.clock_started_at,
    'clock_paused_at', v_tour.clock_paused_at,
    'pause_accumulated', COALESCE(v_tour.pause_accumulated, 0),
    'control_revision', v_current_control_revision
  );
END;
$$;

REVOKE ALL ON FUNCTION public.floor_control_tournament_clock(
  UUID, TEXT, INTEGER, TEXT
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.floor_control_tournament_clock(
  UUID, TEXT, INTEGER, TEXT
) TO authenticated;

COMMIT;
