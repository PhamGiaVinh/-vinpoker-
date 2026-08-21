-- Tracker Voice + Floor Alerts + Player Analytics V0.
--
-- CRITICAL / RED / SOURCE-ONLY. Merging this migration does not apply it.
-- Production apply, Edge deployment, secrets and feature activation require
-- separate owner-controlled gates and TEST evidence.
--
-- Rollback: use a forward migration that disables every tracker_voice_configs
-- row and revokes the public RPC grants. Keep immutable event/audit history.

BEGIN;

-- ---------------------------------------------------------------------------
-- Configuration and operational correction state. A row is deliberately
-- disabled by default, so an applied migration cannot activate Voice.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracker_voice_configs (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  tournament_table_id UUID NOT NULL REFERENCES public.tournament_tables(id) ON DELETE CASCADE,
  physical_table_id UUID NOT NULL REFERENCES public.game_tables(id) ON DELETE CASCADE,
  enabled BOOLEAN NOT NULL DEFAULT FALSE,
  configured_mode TEXT NOT NULL DEFAULT 'shadow'
    CHECK (configured_mode IN ('shadow', 'assist', 'auto')),
  provider_model TEXT NOT NULL DEFAULT 'gpt-live-transcribe',
  spoken_amount_unit BIGINT NOT NULL DEFAULT 1
    CHECK (spoken_amount_unit IN (1, 1000)),
  amount_unit_confirmed BOOLEAN NOT NULL DEFAULT FALSE,
  provider_confidence_threshold NUMERIC(5,4)
    CHECK (provider_confidence_threshold IS NULL OR provider_confidence_threshold BETWEEN 0 AND 1),
  server_auto_allowed BOOLEAN NOT NULL DEFAULT FALSE,
  auto_validation_mode TEXT NOT NULL DEFAULT 'enforce'
    CHECK (auto_validation_mode = 'enforce'),
  auto_turn_order_compatible BOOLEAN NOT NULL DEFAULT FALSE,
  auto_capability_version TEXT,
  correction_state TEXT NOT NULL DEFAULT 'ready'
    CHECK (correction_state IN ('ready', 'correction_pending')),
  correction_alert_id UUID,
  updated_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (tournament_id, tournament_table_id),
  UNIQUE (tournament_table_id, physical_table_id)
);

CREATE INDEX IF NOT EXISTS idx_tracker_voice_configs_club
  ON public.tracker_voice_configs(club_id, enabled);

-- Fixed-window, database-backed session mint limiter. This is operational
-- state only; it never stores audio, transcript text or provider credentials.
CREATE TABLE IF NOT EXISTS public.tracker_voice_session_limits (
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  tournament_table_id UUID NOT NULL REFERENCES public.tournament_tables(id) ON DELETE CASCADE,
  window_started_at TIMESTAMPTZ NOT NULL,
  request_count INTEGER NOT NULL DEFAULT 1 CHECK (request_count BETWEEN 1 AND 5),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (actor_user_id, tournament_table_id)
);

CREATE INDEX IF NOT EXISTS idx_tracker_voice_session_limits_expiry
  ON public.tracker_voice_session_limits(window_started_at);

-- ---------------------------------------------------------------------------
-- Immutable event stream. A final transcript/validation is one row. A later
-- canonical receipt is a second row referencing the first; no row is updated.
-- Audio and partial transcripts are never persisted.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracker_voice_events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  root_event_id UUID REFERENCES public.tracker_voice_events(id) ON DELETE RESTRICT,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  tournament_table_id UUID NOT NULL REFERENCES public.tournament_tables(id) ON DELETE CASCADE,
  physical_table_id UUID NOT NULL REFERENCES public.game_tables(id) ON DELETE CASCADE,
  hand_id UUID REFERENCES public.tournament_hands(id) ON DELETE RESTRICT,
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL REFERENCES public.dealer_assignments(id) ON DELETE RESTRICT,
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  actor_player_id UUID,
  event_kind TEXT NOT NULL
    CHECK (event_kind IN ('final_transcript', 'canonical_receipt')),
  provider_name TEXT NOT NULL DEFAULT 'openai_realtime'
    CHECK (provider_name IN ('openai_realtime', 'mock')),
  provider_model TEXT NOT NULL,
  provider_event_id TEXT,
  provider_confidence NUMERIC(8,7)
    CHECK (provider_confidence IS NULL OR provider_confidence BETWEEN 0 AND 1),
  final_transcript TEXT,
  normalized_command JSONB NOT NULL DEFAULT '{}'::JSONB,
  state_version TEXT NOT NULL CHECK (state_version ~ '^[0-9a-f]{64}$'),
  execution_mode TEXT NOT NULL CHECK (execution_mode IN ('shadow', 'assist', 'auto')),
  execution_result TEXT NOT NULL
    CHECK (execution_result IN (
      'validated', 'rejected', 'alert_opened', 'buffered',
      'committed', 'duplicate', 'failed'
    )),
  validation_mode TEXT NOT NULL DEFAULT 'enforce'
    CHECK (validation_mode IN ('off', 'warn', 'enforce')),
  turn_order_enforced BOOLEAN NOT NULL DEFAULT FALSE,
  capability_version TEXT,
  idempotency_key TEXT NOT NULL
    CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$'),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  trace_id TEXT NOT NULL CHECK (char_length(trace_id) BETWEEN 8 AND 255),
  receipt JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  CHECK (
    (event_kind = 'final_transcript'
      AND root_event_id IS NULL
      AND final_transcript IS NOT NULL
      AND char_length(final_transcript) BETWEEN 1 AND 500)
    OR
    (event_kind = 'canonical_receipt'
      AND root_event_id IS NOT NULL
      AND final_transcript IS NULL)
  ),
  UNIQUE (actor_user_id, idempotency_key, event_kind)
);

CREATE UNIQUE INDEX IF NOT EXISTS idx_tracker_voice_events_provider_event
  ON public.tracker_voice_events(actor_user_id, provider_name, provider_event_id)
  WHERE event_kind = 'final_transcript' AND provider_event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_tracker_voice_events_hand_created
  ON public.tracker_voice_events(hand_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_tracker_voice_events_assignment_created
  ON public.tracker_voice_events(assignment_id, created_at DESC);

-- ---------------------------------------------------------------------------
-- Floor queue. Lifecycle updates are only possible through the transition RPC.
-- transition_receipts stores the small, bounded idempotency receipt map while
-- the full before/after evidence is appended to audit_logs.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracker_floor_alerts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  tournament_table_id UUID NOT NULL REFERENCES public.tournament_tables(id) ON DELETE CASCADE,
  physical_table_id UUID NOT NULL REFERENCES public.game_tables(id) ON DELETE CASCADE,
  hand_id UUID REFERENCES public.tournament_hands(id) ON DELETE SET NULL,
  voice_event_id UUID REFERENCES public.tracker_voice_events(id) ON DELETE RESTRICT
    DEFERRABLE INITIALLY DEFERRED,
  dealer_id UUID NOT NULL REFERENCES public.dealers(id) ON DELETE RESTRICT,
  assignment_id UUID NOT NULL REFERENCES public.dealer_assignments(id) ON DELETE RESTRICT,
  reported_by UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  alert_kind TEXT NOT NULL CHECK (alert_kind IN ('wrong_action', 'call_floor')),
  priority TEXT NOT NULL CHECK (priority IN ('high', 'urgent')),
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'acknowledged', 'in_progress', 'resolved', 'dismissed')),
  version INTEGER NOT NULL DEFAULT 1 CHECK (version > 0),
  correction_required BOOLEAN NOT NULL DEFAULT FALSE,
  title TEXT NOT NULL CHECK (char_length(title) BETWEEN 1 AND 120),
  message TEXT CHECK (message IS NULL OR char_length(message) <= 500),
  acknowledged_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  acknowledged_at TIMESTAMPTZ,
  resolved_by UUID REFERENCES auth.users(id) ON DELETE SET NULL,
  resolved_at TIMESTAMPTZ,
  resolution_note TEXT CHECK (resolution_note IS NULL OR char_length(resolution_note) <= 500),
  transition_receipts JSONB NOT NULL DEFAULT '{}'::JSONB,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_tracker_floor_alerts_queue
  ON public.tracker_floor_alerts(club_id, status, priority, created_at);
CREATE INDEX IF NOT EXISTS idx_tracker_floor_alerts_table
  ON public.tracker_floor_alerts(tournament_table_id, status, created_at DESC);

ALTER TABLE public.tracker_voice_configs
  DROP CONSTRAINT IF EXISTS tracker_voice_configs_correction_alert_id_fkey;
ALTER TABLE public.tracker_voice_configs
  ADD CONSTRAINT tracker_voice_configs_correction_alert_id_fkey
  FOREIGN KEY (correction_alert_id)
  REFERENCES public.tracker_floor_alerts(id)
  ON DELETE SET NULL;

ALTER TABLE public.hand_actions
  ADD COLUMN IF NOT EXISTS source TEXT NOT NULL DEFAULT 'manual';
ALTER TABLE public.hand_actions
  ADD COLUMN IF NOT EXISTS voice_event_id UUID
    REFERENCES public.tracker_voice_events(id) ON DELETE RESTRICT;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint
    WHERE conrelid = 'public.hand_actions'::regclass
      AND conname = 'hand_actions_source_check'
  ) THEN
    ALTER TABLE public.hand_actions
      ADD CONSTRAINT hand_actions_source_check
      CHECK (source IN ('manual', 'voice'));
  END IF;
END;
$$;

CREATE UNIQUE INDEX IF NOT EXISTS idx_hand_actions_voice_event
  ON public.hand_actions(voice_event_id)
  WHERE voice_event_id IS NOT NULL;

ALTER TABLE public.tracker_voice_configs ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_voice_session_limits ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_voice_events ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.tracker_floor_alerts ENABLE ROW LEVEL SECURITY;

REVOKE ALL ON TABLE public.tracker_voice_configs FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.tracker_voice_session_limits FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.tracker_voice_events FROM PUBLIC, anon, authenticated, service_role;
REVOKE ALL ON TABLE public.tracker_floor_alerts FROM PUBLIC, anon, authenticated, service_role;
GRANT SELECT ON TABLE public.tracker_voice_configs TO authenticated;
GRANT SELECT ON TABLE public.tracker_voice_events TO authenticated;
GRANT SELECT ON TABLE public.tracker_floor_alerts TO authenticated;

DROP POLICY IF EXISTS tracker_voice_configs_select_ops ON public.tracker_voice_configs;
CREATE POLICY tracker_voice_configs_select_ops
  ON public.tracker_voice_configs FOR SELECT TO authenticated
  USING (
    public.is_club_tracker(auth.uid(), club_id)
    OR public.is_club_floor(auth.uid(), club_id)
    OR EXISTS (
      SELECT 1
      FROM public.dealers d
      JOIN public.dealer_assignments da ON da.dealer_id = d.id
      WHERE d.user_id = auth.uid()
        AND d.id = da.dealer_id
        AND d.club_id = tracker_voice_configs.club_id
        AND da.id = (
          SELECT da2.id
          FROM public.dealer_assignments da2
          WHERE da2.id = da.id
            AND da2.table_id = tracker_voice_configs.physical_table_id
            AND da2.status = 'assigned'
            AND da2.released_at IS NULL
        )
    )
  );

DROP POLICY IF EXISTS tracker_voice_events_select_ops ON public.tracker_voice_events;
CREATE POLICY tracker_voice_events_select_ops
  ON public.tracker_voice_events FOR SELECT TO authenticated
  USING (
    public.is_club_tracker(auth.uid(), club_id)
    OR public.is_club_floor(auth.uid(), club_id)
    OR actor_user_id = auth.uid()
  );

DROP POLICY IF EXISTS tracker_floor_alerts_select_ops ON public.tracker_floor_alerts;
CREATE POLICY tracker_floor_alerts_select_ops
  ON public.tracker_floor_alerts FOR SELECT TO authenticated
  USING (
    public.is_club_tracker(auth.uid(), club_id)
    OR public.is_club_floor(auth.uid(), club_id)
    OR (
      reported_by = auth.uid()
      AND EXISTS (
        SELECT 1 FROM public.dealer_assignments da
        WHERE da.id = tracker_floor_alerts.assignment_id
          AND da.status = 'assigned'
          AND da.released_at IS NULL
      )
    )
  );

CREATE OR REPLACE FUNCTION public.reject_tracker_voice_event_mutation()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = pg_catalog, public, pg_temp
AS $function$
BEGIN
  RAISE EXCEPTION 'TRACKER_VOICE_EVENT_IMMUTABLE' USING ERRCODE = '55000';
END;
$function$;

DROP TRIGGER IF EXISTS trg_tracker_voice_events_immutable
  ON public.tracker_voice_events;
CREATE TRIGGER trg_tracker_voice_events_immutable
  BEFORE UPDATE OR DELETE ON public.tracker_voice_events
  FOR EACH ROW EXECUTE FUNCTION public.reject_tracker_voice_event_mutation();

REVOKE ALL ON FUNCTION public.reject_tracker_voice_event_mutation()
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._tracker_voice_request_hash(p_payload JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SET search_path = public
AS $function$
  SELECT public._tracker_unified_ops_request_hash_v2(COALESCE(p_payload, '{}'::JSONB));
$function$;

REVOKE ALL ON FUNCTION public._tracker_voice_request_hash(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._tracker_voice_hand_state_version(p_hand_id UUID)
RETURNS TEXT
LANGUAGE SQL
STABLE
SET search_path = public
AS $function$
  SELECT public._tracker_voice_request_hash(jsonb_build_object(
    'hand', jsonb_build_object(
      'id', h.id,
      'tournament_id', h.tournament_id,
      'table_id', h.table_id,
      'status', h.status,
      'street', COALESCE((
        SELECT ha.street
        FROM public.hand_actions ha
        WHERE ha.hand_id = h.id
        ORDER BY ha.action_order DESC, ha.id DESC
        LIMIT 1
      ), 'preflop'),
      'community_cards', COALESCE(h.community_cards, '[]'::JSONB),
      -- Lock ownership is validated separately by the canonical writer.
      -- It must not invalidate an otherwise unchanged Voice proposal when
      -- its authenticated operator claims or refreshes the hand lock.
      'source_revision', COALESCE(h.source_revision, 1)
    ),
    'players', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'player_id', hp.player_id,
        'entry_number', hp.entry_number,
        'seat_number', hp.seat_number,
        'starting_stack', hp.starting_stack,
        'hole_cards', COALESCE(hp.hole_cards, '[]'::JSONB)
      ) ORDER BY hp.seat_number, hp.player_id, hp.entry_number)
      FROM public.hand_players hp
      WHERE hp.hand_id = h.id
    ), '[]'::JSONB),
    'actions', COALESCE((
      SELECT jsonb_agg(jsonb_build_object(
        'id', ha.id,
        'player_id', ha.player_id,
        'entry_number', ha.entry_number,
        'street', COALESCE(ha.street, 'preflop'),
        'action_type', ha.action_type,
        'action_amount', COALESCE(ha.action_amount, 0),
        'action_order', ha.action_order
      ) ORDER BY ha.action_order, ha.id)
      FROM public.hand_actions ha
      WHERE ha.hand_id = h.id
    ), '[]'::JSONB)
  ))
  FROM public.tournament_hands h
  WHERE h.id = p_hand_id;
$function$;

REVOKE ALL ON FUNCTION public._tracker_voice_hand_state_version(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- Exact assignment resolver. Physical/canonical table identity and the active
-- assignment count are derived server-side; no caller-supplied dealer is used.
CREATE OR REPLACE FUNCTION public._tracker_voice_assignment_context(
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_actor UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tour RECORD;
  v_tt RECORD;
  v_assignment_count INTEGER := 0;
  v_assignment RECORD;
BEGIN
  SELECT t.id, t.club_id, t.name INTO v_tour
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT tt.id, tt.table_id, tt.status, tt.table_name INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id;
  IF NOT FOUND OR v_tt.table_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;

  SELECT count(*)::INTEGER INTO v_assignment_count
  FROM public.dealers d
  JOIN public.dealer_assignments da ON da.dealer_id = d.id
  WHERE d.user_id = p_actor
    AND d.club_id = v_tour.club_id
    AND d.status = 'active'
    AND da.table_id = v_tt.table_id
    AND da.status = 'assigned'
    AND da.released_at IS NULL;

  IF v_assignment_count <> 1 THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', CASE WHEN v_assignment_count = 0 THEN 'dealer_assignment_missing' ELSE 'dealer_assignment_ambiguous' END,
      'assignment_count', v_assignment_count,
      'tournament_id', v_tour.id,
      'tournament_table_id', v_tt.id,
      'physical_table_id', v_tt.table_id,
      'club_id', v_tour.club_id
    );
  END IF;

  SELECT da.id AS assignment_id, d.id AS dealer_id
  INTO v_assignment
  FROM public.dealers d
  JOIN public.dealer_assignments da ON da.dealer_id = d.id
  WHERE d.user_id = p_actor
    AND d.club_id = v_tour.club_id
    AND d.status = 'active'
    AND da.table_id = v_tt.table_id
    AND da.status = 'assigned'
    AND da.released_at IS NULL
  ORDER BY da.assigned_at DESC, da.id
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'club_id', v_tour.club_id,
    'tournament_id', v_tour.id,
    'tournament_name', v_tour.name,
    'tournament_table_id', v_tt.id,
    'physical_table_id', v_tt.table_id,
    'table_name', v_tt.table_name,
    'table_status', v_tt.status,
    'dealer_id', v_assignment.dealer_id,
    'assignment_id', v_assignment.assignment_id
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._tracker_voice_assignment_context(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._tracker_voice_consume_session_rate_limit(
  p_actor_user_id UUID,
  p_tournament_id UUID,
  p_tournament_table_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_assignment JSONB;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_window TIMESTAMPTZ := date_trunc('minute', clock_timestamp());
  v_count INTEGER;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'edge_service_role_required');
  END IF;
  IF p_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  v_assignment := public._tracker_voice_assignment_context(
    p_tournament_id, p_tournament_table_id, p_actor_user_id
  );
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_assignment;
  END IF;

  SELECT * INTO v_config
  FROM public.tracker_voice_configs c
  WHERE c.tournament_id = p_tournament_id
    AND c.tournament_table_id = p_tournament_table_id;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_not_enabled');
  END IF;

  INSERT INTO public.tracker_voice_session_limits (
    actor_user_id, tournament_id, tournament_table_id,
    window_started_at, request_count, updated_at
  ) VALUES (
    p_actor_user_id, p_tournament_id, p_tournament_table_id,
    v_window, 1, now()
  )
  ON CONFLICT (actor_user_id, tournament_table_id)
  DO UPDATE
    SET tournament_id = EXCLUDED.tournament_id,
        window_started_at = CASE
          WHEN public.tracker_voice_session_limits.window_started_at < EXCLUDED.window_started_at
            THEN EXCLUDED.window_started_at
          ELSE public.tracker_voice_session_limits.window_started_at
        END,
        request_count = CASE
          WHEN public.tracker_voice_session_limits.window_started_at < EXCLUDED.window_started_at
            THEN 1
          ELSE public.tracker_voice_session_limits.request_count + 1
        END,
        updated_at = now()
    WHERE public.tracker_voice_session_limits.window_started_at < EXCLUDED.window_started_at
       OR public.tracker_voice_session_limits.request_count < 5
  RETURNING request_count INTO v_count;

  IF v_count IS NULL THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'voice_session_rate_limited',
      'retry_after_seconds', GREATEST(
        1,
        60 - floor(extract(epoch FROM (clock_timestamp() - v_window)))::INTEGER
      )
    );
  END IF;

  RETURN v_assignment || jsonb_build_object(
    'ok', true,
    'request_count', v_count,
    'limit', 5,
    'window_started_at', v_window
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._tracker_voice_consume_session_rate_limit(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tracker_voice_consume_session_rate_limit(UUID, UUID, UUID)
  TO service_role;

CREATE OR REPLACE FUNCTION public.get_tracker_voice_runtime_context(
  p_tournament_id UUID,
  p_tournament_table_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_assignment JSONB;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_hand RECORD;
  v_state_version TEXT;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  v_assignment := public._tracker_voice_assignment_context(
    p_tournament_id, p_tournament_table_id, v_actor
  );
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_assignment || jsonb_build_object('can_mint_session', false, 'read_only', true);
  END IF;

  SELECT * INTO v_config
  FROM public.tracker_voice_configs c
  WHERE c.tournament_id = p_tournament_id
    AND c.tournament_table_id = p_tournament_table_id;

  SELECT h.id, h.hand_number, h.status INTO v_hand
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND h.table_id = p_tournament_table_id
    AND h.status = 'in_progress'
  ORDER BY h.hand_time DESC, h.created_at DESC, h.id
  LIMIT 1;

  IF FOUND THEN
    v_state_version := public._tracker_voice_hand_state_version(v_hand.id);
  END IF;

  RETURN v_assignment || jsonb_build_object(
    'ok', true,
    'can_mint_session', COALESCE(v_config.enabled, false),
    'read_only', NOT COALESCE(v_config.enabled, false),
    'config', jsonb_build_object(
      'enabled', COALESCE(v_config.enabled, false),
      'configured_mode', COALESCE(v_config.configured_mode, 'shadow'),
      'provider_model', COALESCE(v_config.provider_model, 'gpt-live-transcribe'),
      'spoken_amount_unit', COALESCE(v_config.spoken_amount_unit, 1),
      'amount_unit_confirmed', COALESCE(v_config.amount_unit_confirmed, false),
      'provider_confidence_threshold', v_config.provider_confidence_threshold,
      'server_auto_allowed', COALESCE(v_config.server_auto_allowed, false),
      'correction_state', COALESCE(v_config.correction_state, 'ready')
    ),
    'active_hand', CASE WHEN v_hand.id IS NULL THEN NULL ELSE jsonb_build_object(
      'hand_id', v_hand.id,
      'hand_number', v_hand.hand_number,
      'status', v_hand.status,
      'state_version', v_state_version
    ) END,
    'correction_pending', COALESCE(v_config.correction_state = 'correction_pending', false)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_tracker_voice_runtime_context(UUID, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_tracker_voice_runtime_context(UUID, UUID)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tracker_voice_validation_snapshot(
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_hand_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_assignment JSONB;
  v_hand RECORD;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_state_version TEXT;
  v_players JSONB;
  v_actions JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  v_assignment := public._tracker_voice_assignment_context(
    p_tournament_id, p_tournament_table_id, v_actor
  );
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_assignment;
  END IF;

  SELECT h.id, h.button_seat, h.status, h.is_voided, h.community_cards,
         h.locked_by_user_id, h.locked_at
  INTO v_hand
  FROM public.tournament_hands h
  WHERE h.id = p_hand_id
    AND h.tournament_id = p_tournament_id
    AND h.table_id = p_tournament_table_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_scope_mismatch');
  END IF;
  IF v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_in_progress');
  END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, v_actor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lock_lost');
  END IF;

  SELECT * INTO v_config
  FROM public.tracker_voice_configs c
  WHERE c.tournament_id = p_tournament_id
    AND c.tournament_table_id = p_tournament_table_id;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_not_enabled');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id', hp.player_id,
    'entry_number', hp.entry_number,
    'seat_number', hp.seat_number,
    'starting_stack', hp.starting_stack
  ) ORDER BY hp.seat_number, hp.player_id, hp.entry_number), '[]'::JSONB)
  INTO v_players
  FROM public.hand_players hp
  WHERE hp.hand_id = p_hand_id;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'player_id', ha.player_id,
    'entry_number', ha.entry_number,
    'street', COALESCE(ha.street, 'preflop'),
    'action_type', ha.action_type,
    'action_amount', COALESCE(ha.action_amount, 0),
    'action_order', ha.action_order
  ) ORDER BY ha.action_order, ha.id), '[]'::JSONB)
  INTO v_actions
  FROM public.hand_actions ha
  WHERE ha.hand_id = p_hand_id;

  v_state_version := public._tracker_voice_hand_state_version(p_hand_id);
  RETURN v_assignment || jsonb_build_object(
    'ok', true,
    'hand_id', p_hand_id,
    'button_seat', v_hand.button_seat,
    'community_cards', COALESCE(v_hand.community_cards, '[]'::JSONB),
    'state_version', v_state_version,
    'correction_pending', v_config.correction_state = 'correction_pending',
    'configured_mode', v_config.configured_mode,
    'provider_model', v_config.provider_model,
    'spoken_amount_unit', v_config.spoken_amount_unit,
    'amount_unit_confirmed', v_config.amount_unit_confirmed,
    'players', v_players,
    'actions', v_actions
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.get_tracker_voice_validation_snapshot(UUID, UUID, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_tracker_voice_validation_snapshot(UUID, UUID, UUID)
  TO authenticated;

-- Persist one final transcript after the Edge has run the canonical validation
-- engine. The database re-derives actor, assignment, table mapping and state
-- version, and it refuses any Auto request without every server-side gate.
CREATE OR REPLACE FUNCTION public._tracker_voice_register_validated_event(
  p_actor_user_id UUID,
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_hand_id UUID,
  p_provider_name TEXT,
  p_provider_model TEXT,
  p_provider_event_id TEXT,
  p_provider_confidence NUMERIC,
  p_final_transcript TEXT,
  p_normalized_command JSONB,
  p_expected_state_version TEXT,
  p_execution_mode TEXT,
  p_idempotency_key TEXT,
  p_trace_id TEXT,
  p_validation_mode TEXT,
  p_turn_order_enforced BOOLEAN,
  p_capability_version TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := p_actor_user_id;
  v_assignment JSONB;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_hand RECORD;
  v_state_version TEXT;
  v_kind TEXT;
  v_actor_player_id UUID;
  v_request JSONB;
  v_request_hash TEXT;
  v_existing public.tracker_voice_events%ROWTYPE;
  v_event_id UUID;
  v_alert_id UUID;
  v_result TEXT := 'validated';
  v_receipt JSONB;
BEGIN
  IF COALESCE(auth.jwt()->>'role', '') <> 'service_role' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'edge_service_role_required');
  END IF;
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  END IF;
  IF p_trace_id IS NULL OR char_length(p_trace_id) NOT BETWEEN 8 AND 255 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_trace_id');
  END IF;
  IF p_final_transcript IS NULL OR char_length(p_final_transcript) NOT BETWEEN 1 AND 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_final_transcript');
  END IF;
  IF p_provider_name NOT IN ('openai_realtime', 'mock')
     OR NULLIF(btrim(COALESCE(p_provider_model, '')), '') IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_provider');
  END IF;
  IF p_provider_confidence IS NOT NULL AND (p_provider_confidence < 0 OR p_provider_confidence > 1) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_provider_confidence');
  END IF;
  IF p_execution_mode NOT IN ('shadow', 'assist', 'auto') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_execution_mode');
  END IF;
  IF p_validation_mode NOT IN ('off', 'warn', 'enforce') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_validation_mode');
  END IF;
  IF p_expected_state_version IS NULL OR p_expected_state_version !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_state_version');
  END IF;

  v_kind := p_normalized_command->>'kind';
  IF v_kind NOT IN ('fold', 'check', 'call', 'bet_to', 'raise_to', 'all_in', 'report_wrong_action', 'call_floor') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_command');
  END IF;
  IF jsonb_typeof(COALESCE(p_normalized_command, 'null'::JSONB)) <> 'object' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_voice_command');
  END IF;

  -- Idempotent replay must not depend on mutable hand/assignment state. The
  -- immutable request hash proves this is the exact request already accepted.
  -- A second lookup after the tournament lock closes the concurrent first-call
  -- race before any current-state validation or write occurs.
  v_request := jsonb_build_object(
    'tournament_id', p_tournament_id,
    'tournament_table_id', p_tournament_table_id,
    'hand_id', p_hand_id,
    'provider_name', p_provider_name,
    'provider_model', p_provider_model,
    'provider_event_id', p_provider_event_id,
    'provider_confidence', p_provider_confidence,
    'final_transcript', p_final_transcript,
    'normalized_command', p_normalized_command,
    'state_version', p_expected_state_version,
    'execution_mode', p_execution_mode,
    'validation_mode', p_validation_mode,
    'turn_order_enforced', p_turn_order_enforced,
    'capability_version', p_capability_version
  );
  v_request_hash := public._tracker_voice_request_hash(v_request);

  SELECT e.* INTO v_existing
  FROM public.tracker_voice_events e
  WHERE e.actor_user_id = v_actor
    AND e.idempotency_key = p_idempotency_key
    AND e.event_kind = 'final_transcript';
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
    END IF;
    RETURN v_existing.receipt || jsonb_build_object('duplicate', true);
  END IF;

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);

  SELECT e.* INTO v_existing
  FROM public.tracker_voice_events e
  WHERE e.actor_user_id = v_actor
    AND e.idempotency_key = p_idempotency_key
    AND e.event_kind = 'final_transcript'
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
    END IF;
    RETURN v_existing.receipt || jsonb_build_object('duplicate', true);
  END IF;

  v_assignment := public._tracker_voice_assignment_context(
    p_tournament_id, p_tournament_table_id, v_actor
  );
  IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
    RETURN v_assignment;
  END IF;

  SELECT * INTO v_config
  FROM public.tracker_voice_configs c
  WHERE c.tournament_id = p_tournament_id
    AND c.tournament_table_id = p_tournament_table_id
  FOR UPDATE;
  IF NOT FOUND OR v_config.enabled IS NOT TRUE THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_not_enabled');
  END IF;
  IF v_config.physical_table_id <> (v_assignment->>'physical_table_id')::UUID
     OR v_config.club_id <> (v_assignment->>'club_id')::UUID THEN
    RETURN jsonb_build_object('ok', false, 'error', 'voice_config_scope_mismatch');
  END IF;

  SELECT h.id, h.tournament_id, h.table_id, h.status, h.is_voided,
         h.locked_by_user_id, h.locked_at
  INTO v_hand
  FROM public.tournament_hands h
  WHERE h.id = p_hand_id
  FOR UPDATE;
  IF NOT FOUND
     OR v_hand.tournament_id <> p_tournament_id
     OR v_hand.table_id <> p_tournament_table_id THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_scope_mismatch');
  END IF;
  IF v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'hand_not_in_progress');
  END IF;
  IF public.tracker_lock_blocks(v_hand.locked_by_user_id, v_hand.locked_at, v_actor) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'lock_lost');
  END IF;

  v_state_version := public._tracker_voice_hand_state_version(p_hand_id);
  IF v_state_version IS NULL OR v_state_version <> p_expected_state_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'stale_state_version',
      'state_version', v_state_version
    );
  END IF;

  IF v_kind NOT IN ('report_wrong_action', 'call_floor')
     AND v_config.correction_state = 'correction_pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'correction_pending');
  END IF;

  IF p_execution_mode = 'assist' AND v_config.configured_mode = 'shadow' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'assist_not_allowed');
  END IF;
  IF p_execution_mode = 'auto' THEN
    IF v_config.configured_mode <> 'auto'
       OR v_config.server_auto_allowed IS NOT TRUE
       OR p_validation_mode <> 'enforce'
       OR p_turn_order_enforced IS NOT TRUE
       OR v_config.auto_turn_order_compatible IS NOT TRUE
       OR p_provider_confidence IS NULL
       OR v_config.provider_confidence_threshold IS NULL
       OR p_provider_confidence < v_config.provider_confidence_threshold
       OR NULLIF(v_config.auto_capability_version, '') IS NULL
       OR v_config.auto_capability_version IS DISTINCT FROM p_capability_version THEN
      RETURN jsonb_build_object('ok', false, 'error', 'auto_capability_missing');
    END IF;
  END IF;

  IF v_kind NOT IN ('report_wrong_action', 'call_floor') THEN
    BEGIN
      v_actor_player_id := (p_normalized_command->>'actor_player_id')::UUID;
    EXCEPTION WHEN invalid_text_representation THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_actor_player');
    END;
    IF v_actor_player_id IS NULL
       OR NOT EXISTS (
         SELECT 1 FROM public.hand_players hp
         WHERE hp.hand_id = p_hand_id
           AND hp.player_id = v_actor_player_id
       ) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_actor_player');
    END IF;
    IF p_normalized_command->>'canonical_action' NOT IN ('fold', 'check', 'call', 'bet', 'raise', 'all_in')
       OR COALESCE(p_normalized_command->>'action_order', '') !~ '^[1-9][0-9]*$'
       OR COALESCE(p_normalized_command->>'action_amount', '') !~ '^[0-9]+$' THEN
      RETURN jsonb_build_object('ok', false, 'error', 'invalid_canonical_action');
    END IF;
  END IF;

  v_event_id := gen_random_uuid();
  IF v_kind = 'report_wrong_action' THEN
    v_result := 'alert_opened';
    v_alert_id := gen_random_uuid();
    INSERT INTO public.tracker_floor_alerts (
      id, club_id, tournament_id, tournament_table_id, physical_table_id,
      hand_id, voice_event_id, dealer_id, assignment_id, reported_by,
      alert_kind, priority, correction_required, title, message
    ) VALUES (
      v_alert_id,
      (v_assignment->>'club_id')::UUID,
      p_tournament_id,
      p_tournament_table_id,
      (v_assignment->>'physical_table_id')::UUID,
      p_hand_id,
      v_event_id,
      (v_assignment->>'dealer_id')::UUID,
      (v_assignment->>'assignment_id')::UUID,
      v_actor,
      'wrong_action',
      'high',
      true,
      'Sai action tren Tracker',
      left(p_final_transcript, 500)
    );
    UPDATE public.tracker_voice_configs
    SET correction_state = 'correction_pending',
        correction_alert_id = v_alert_id,
        updated_at = now(),
        updated_by = v_actor
    WHERE id = v_config.id;
  ELSIF v_kind = 'call_floor' THEN
    v_result := 'alert_opened';
    v_alert_id := gen_random_uuid();
    INSERT INTO public.tracker_floor_alerts (
      id, club_id, tournament_id, tournament_table_id, physical_table_id,
      hand_id, voice_event_id, dealer_id, assignment_id, reported_by,
      alert_kind, priority, correction_required, title, message
    ) VALUES (
      v_alert_id,
      (v_assignment->>'club_id')::UUID,
      p_tournament_id,
      p_tournament_table_id,
      (v_assignment->>'physical_table_id')::UUID,
      p_hand_id,
      v_event_id,
      (v_assignment->>'dealer_id')::UUID,
      (v_assignment->>'assignment_id')::UUID,
      v_actor,
      'call_floor',
      'urgent',
      false,
      'Dealer goi Floor',
      left(p_final_transcript, 500)
    );
  END IF;

  v_receipt := jsonb_build_object(
    'ok', true,
    'voice_event_id', v_event_id,
    'idempotency_key', p_idempotency_key,
    'trace_id', p_trace_id,
    'state_version', v_state_version,
    'execution_mode', p_execution_mode,
    'execution_result', v_result,
    'correction_pending', v_kind = 'report_wrong_action'
      OR v_config.correction_state = 'correction_pending',
    'alert_id', v_alert_id
  );

  INSERT INTO public.tracker_voice_events (
    id, club_id, tournament_id, tournament_table_id, physical_table_id,
    hand_id, dealer_id, assignment_id, actor_user_id, actor_player_id,
    event_kind, provider_name, provider_model, provider_event_id,
    provider_confidence, final_transcript, normalized_command, state_version,
    execution_mode, execution_result, validation_mode, turn_order_enforced,
    capability_version, idempotency_key, request_hash, trace_id, receipt
  ) VALUES (
    v_event_id,
    (v_assignment->>'club_id')::UUID,
    p_tournament_id,
    p_tournament_table_id,
    (v_assignment->>'physical_table_id')::UUID,
    p_hand_id,
    (v_assignment->>'dealer_id')::UUID,
    (v_assignment->>'assignment_id')::UUID,
    v_actor,
    v_actor_player_id,
    'final_transcript',
    p_provider_name,
    p_provider_model,
    NULLIF(p_provider_event_id, ''),
    p_provider_confidence,
    p_final_transcript,
    p_normalized_command,
    v_state_version,
    p_execution_mode,
    v_result,
    p_validation_mode,
    COALESCE(p_turn_order_enforced, false),
    p_capability_version,
    p_idempotency_key,
    v_request_hash,
    p_trace_id,
    v_receipt
  );

  IF v_alert_id IS NOT NULL THEN
    INSERT INTO public.audit_logs (
      club_id, actor_id, action, entity_type, entity_id, payload
    ) VALUES (
      (v_assignment->>'club_id')::UUID,
      v_actor,
      'tracker_floor_alert_opened',
      'tracker_floor_alert',
      v_alert_id,
      jsonb_build_object(
        'kind', v_kind,
        'voice_event_id', v_event_id,
        'tournament_table_id', p_tournament_table_id,
        'hand_id', p_hand_id
      )
    );
  END IF;

  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public._tracker_voice_register_validated_event(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT,
  TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public._tracker_voice_register_validated_event(
  UUID, UUID, UUID, UUID, TEXT, TEXT, TEXT, NUMERIC, TEXT, JSONB, TEXT,
  TEXT, TEXT, TEXT, TEXT, BOOLEAN, TEXT
) TO service_role;

-- Canonical action writer. The signature remains the existing 10-argument
-- contract, so every manual caller keeps the same route. Assigned Dealers can
-- only enter through a matching immutable Voice event; no second action writer
-- exists.
CREATE OR REPLACE FUNCTION public.heartbeat_lock(
  p_hand_id UUID,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_hand RECORD;
  v_is_tracker BOOLEAN := FALSE;
  v_assignment JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthorized');
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
    RETURN jsonb_build_object('error', 'actor_mismatch');
  END IF;

  SELECT h.id, h.tournament_id, h.table_id, h.status, h.is_voided,
         h.locked_by_user_id, h.locked_at, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found');
  END IF;
  IF v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress');
  END IF;

  v_is_tracker := public.is_club_tracker(v_actor, v_hand.club_id);
  IF NOT v_is_tracker THEN
    v_assignment := public._tracker_voice_assignment_context(
      v_hand.tournament_id, v_hand.table_id, v_actor
    );
    IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE THEN
      RETURN jsonb_build_object('error', 'actor_not_allowed');
    END IF;
  END IF;

  IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NOT NULL THEN
    RETURN jsonb_build_object('error', 'tracker_lock_ambiguous');
  END IF;
  IF v_hand.locked_by_user_id IS NOT NULL
     AND v_hand.locked_by_user_id <> v_actor
     AND v_hand.locked_at IS NOT NULL
     AND v_hand.locked_at > now() - public.tracker_lock_ttl() THEN
    RETURN jsonb_build_object(
      'error', 'tracker_lock_owned_by_another',
      'locked_by', v_hand.locked_by_user_id
    );
  END IF;

  UPDATE public.tournament_hands
  SET locked_by_user_id = v_actor,
      locked_at = now()
  WHERE id = p_hand_id;

  RETURN jsonb_build_object('status', 'success', 'locked_by', v_actor, 'locked_at', now());
END;
$function$;

REVOKE ALL ON FUNCTION public.heartbeat_lock(UUID, UUID) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.heartbeat_lock(UUID, UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.record_action(
  p_hand_id UUID,
  p_player_id UUID,
  p_action_type TEXT,
  p_action_order INTEGER,
  p_entry_number INTEGER DEFAULT 1,
  p_street TEXT DEFAULT 'preflop',
  p_action_amount INTEGER DEFAULT 0,
  p_idempotency_key TEXT DEFAULT NULL,
  p_trace_id TEXT DEFAULT NULL,
  p_user_id UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_hand RECORD;
  v_club_id UUID;
  v_is_tracker BOOLEAN := FALSE;
  v_locked_by UUID;
  v_locked_at TIMESTAMPTZ;
  v_existing public.hand_actions%ROWTYPE;
  v_voice public.tracker_voice_events%ROWTYPE;
  v_assignment JSONB;
  v_config public.tracker_voice_configs%ROWTYPE;
  v_state_version TEXT;
  v_source TEXT := 'manual';
  v_has_voice BOOLEAN := FALSE;
  v_action_id UUID;
  v_receipt JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('error', 'unauthorized', 'trace_id', p_trace_id);
  END IF;
  IF p_user_id IS NOT NULL AND p_user_id <> v_actor THEN
    RETURN jsonb_build_object('error', 'actor_mismatch', 'trace_id', p_trace_id);
  END IF;

  SELECT h.id, h.tournament_id, h.table_id, h.status, h.is_voided,
         h.locked_by_user_id, h.locked_at, t.club_id
  INTO v_hand
  FROM public.tournament_hands h
  JOIN public.tournaments t ON t.id = h.tournament_id
  WHERE h.id = p_hand_id
  FOR UPDATE OF h;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('error', 'Hand not found', 'trace_id', p_trace_id);
  END IF;
  v_club_id := v_hand.club_id;
  v_is_tracker := public.is_club_tracker(v_actor, v_club_id);

  IF v_hand.status <> 'in_progress' OR COALESCE(v_hand.is_voided, false) THEN
    RETURN jsonb_build_object('error', 'Hand is not in progress', 'trace_id', p_trace_id);
  END IF;
  IF v_hand.locked_by_user_id IS NULL AND v_hand.locked_at IS NULL THEN
    RETURN jsonb_build_object('error', 'tracker_lock_required', 'trace_id', p_trace_id);
  END IF;
  IF v_hand.locked_by_user_id IS NULL OR v_hand.locked_at IS NULL THEN
    RETURN jsonb_build_object('error', 'tracker_lock_ambiguous', 'trace_id', p_trace_id);
  END IF;
  IF v_hand.locked_at <= now() - public.tracker_lock_ttl() THEN
    RETURN jsonb_build_object('error', 'tracker_lock_expired', 'trace_id', p_trace_id);
  END IF;
  IF v_hand.locked_by_user_id <> v_actor THEN
    RETURN jsonb_build_object(
      'error', 'tracker_lock_owned_by_another',
      'locked_by', v_hand.locked_by_user_id,
      'trace_id', p_trace_id
    );
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT * INTO v_existing
    FROM public.hand_actions
    WHERE hand_id = p_hand_id
      AND idempotency_key = p_idempotency_key
    LIMIT 1;
    IF FOUND THEN
      IF v_existing.player_id = p_player_id
         AND v_existing.entry_number = p_entry_number
         AND COALESCE(v_existing.street, 'preflop') = COALESCE(p_street, 'preflop')
         AND v_existing.action_type = p_action_type
         AND COALESCE(v_existing.action_amount, 0) = COALESCE(p_action_amount, 0)
         AND v_existing.action_order = p_action_order THEN
        IF v_existing.source = 'voice' THEN
          IF v_existing.voice_event_id IS NULL OR NOT EXISTS (
            SELECT 1
            FROM public.tracker_voice_events e
            WHERE e.id = v_existing.voice_event_id
              AND e.actor_user_id = v_actor
              AND e.idempotency_key = p_idempotency_key
          ) THEN
            RETURN jsonb_build_object('error', 'actor_not_allowed', 'trace_id', p_trace_id);
          END IF;
        ELSIF NOT v_is_tracker THEN
          RETURN jsonb_build_object('error', 'actor_not_allowed', 'trace_id', p_trace_id);
        END IF;
        RETURN jsonb_build_object(
          'status', 'success',
          'duplicate', true,
          'action_id', v_existing.id,
          'source', v_existing.source,
          'voice_event_id', v_existing.voice_event_id,
          'trace_id', p_trace_id
        );
      END IF;
      RETURN jsonb_build_object('error', 'idempotency_key_conflict', 'trace_id', p_trace_id);
    END IF;
  END IF;

  IF p_idempotency_key IS NOT NULL THEN
    SELECT e.* INTO v_voice
    FROM public.tracker_voice_events e
    WHERE e.actor_user_id = v_actor
      AND e.idempotency_key = p_idempotency_key
      AND e.event_kind = 'final_transcript'
    LIMIT 1;
    v_has_voice := FOUND;
  END IF;

  IF v_has_voice THEN
    v_source := 'voice';
    IF v_voice.hand_id <> p_hand_id
       OR v_voice.actor_player_id <> p_player_id
       OR v_voice.execution_result <> 'validated'
       OR v_voice.execution_mode NOT IN ('assist', 'auto')
       OR v_voice.normalized_command->>'canonical_action' <> p_action_type
       OR COALESCE(v_voice.normalized_command->>'street', 'preflop') <> COALESCE(p_street, 'preflop')
       OR COALESCE(v_voice.normalized_command->>'entry_number', '1') <> p_entry_number::TEXT
       OR COALESCE(v_voice.normalized_command->>'action_order', '') <> p_action_order::TEXT
       OR COALESCE(v_voice.normalized_command->>'action_amount', '') <> COALESCE(p_action_amount, 0)::TEXT THEN
      RETURN jsonb_build_object('error', 'voice_event_payload_mismatch', 'trace_id', p_trace_id);
    END IF;

    v_assignment := public._tracker_voice_assignment_context(
      v_hand.tournament_id, v_hand.table_id, v_actor
    );
    IF COALESCE((v_assignment->>'ok')::BOOLEAN, false) IS NOT TRUE
       OR (v_assignment->>'assignment_id')::UUID <> v_voice.assignment_id
       OR (v_assignment->>'dealer_id')::UUID <> v_voice.dealer_id THEN
      RETURN jsonb_build_object('error', 'dealer_assignment_lost', 'trace_id', p_trace_id);
    END IF;

    SELECT * INTO v_config
    FROM public.tracker_voice_configs c
    WHERE c.tournament_id = v_hand.tournament_id
      AND c.tournament_table_id = v_hand.table_id;
    IF NOT FOUND OR v_config.enabled IS NOT TRUE THEN
      RETURN jsonb_build_object('error', 'voice_not_enabled', 'trace_id', p_trace_id);
    END IF;
    IF v_config.correction_state = 'correction_pending' THEN
      RETURN jsonb_build_object('error', 'correction_pending', 'trace_id', p_trace_id);
    END IF;
    IF v_voice.execution_mode = 'auto' AND (
      v_config.configured_mode <> 'auto'
      OR v_config.server_auto_allowed IS NOT TRUE
      OR v_voice.validation_mode <> 'enforce'
      OR v_voice.turn_order_enforced IS NOT TRUE
      OR v_config.auto_turn_order_compatible IS NOT TRUE
      OR v_voice.provider_confidence IS NULL
      OR v_config.provider_confidence_threshold IS NULL
      OR v_voice.provider_confidence < v_config.provider_confidence_threshold
      OR v_voice.capability_version IS DISTINCT FROM v_config.auto_capability_version
    ) THEN
      RETURN jsonb_build_object('error', 'auto_capability_missing', 'trace_id', p_trace_id);
    END IF;
  ELSIF NOT v_is_tracker THEN
    RETURN jsonb_build_object('error', 'actor_not_allowed', 'trace_id', p_trace_id);
  END IF;

  IF NOT EXISTS (
    SELECT 1 FROM public.hand_players hp
    WHERE hp.hand_id = p_hand_id
      AND hp.player_id = p_player_id
      AND hp.entry_number = p_entry_number
  ) THEN
    RETURN jsonb_build_object('error', 'Player not found in this hand', 'trace_id', p_trace_id);
  END IF;
  IF p_action_order IS NULL OR p_action_order < 1 THEN
    RETURN jsonb_build_object('error', 'Invalid action_order', 'trace_id', p_trace_id);
  END IF;

  IF v_source = 'voice' THEN
    v_state_version := public._tracker_voice_hand_state_version(p_hand_id);
    IF v_state_version IS NULL OR v_state_version <> v_voice.state_version THEN
      RETURN jsonb_build_object(
        'error', 'stale_state_version',
        'state_version', v_state_version,
        'trace_id', p_trace_id
      );
    END IF;
  END IF;

  BEGIN
    INSERT INTO public.hand_actions (
      hand_id, player_id, entry_number, street, action_type, action_amount,
      action_order, idempotency_key, trace_id, source, voice_event_id
    ) VALUES (
      p_hand_id, p_player_id, p_entry_number, COALESCE(p_street, 'preflop'),
      p_action_type, COALESCE(p_action_amount, 0), p_action_order,
      p_idempotency_key, p_trace_id, v_source,
      CASE WHEN v_source = 'voice' THEN v_voice.id ELSE NULL END
    )
    RETURNING id INTO v_action_id;
  EXCEPTION WHEN unique_violation THEN
    IF p_idempotency_key IS NOT NULL THEN
      SELECT * INTO v_existing
      FROM public.hand_actions ha
      WHERE ha.hand_id = p_hand_id
        AND ha.idempotency_key = p_idempotency_key
      LIMIT 1;
      IF FOUND THEN
        IF v_existing.player_id = p_player_id
           AND v_existing.entry_number = p_entry_number
           AND COALESCE(v_existing.street, 'preflop') = COALESCE(p_street, 'preflop')
           AND v_existing.action_type = p_action_type
           AND COALESCE(v_existing.action_amount, 0) = COALESCE(p_action_amount, 0)
           AND v_existing.action_order = p_action_order
           AND v_existing.source = v_source
           AND (
             v_source <> 'voice'
             OR v_existing.voice_event_id = v_voice.id
           ) THEN
          RETURN jsonb_build_object(
            'status', 'success',
            'duplicate', true,
            'action_id', v_existing.id,
            'source', v_existing.source,
            'voice_event_id', v_existing.voice_event_id,
            'trace_id', p_trace_id
          );
        END IF;
        RETURN jsonb_build_object('error', 'idempotency_key_conflict', 'trace_id', p_trace_id);
      END IF;
    END IF;
    RETURN jsonb_build_object(
      'error', 'action_order_conflict',
      'reason', 'Another action already exists at this action_order',
      'trace_id', p_trace_id
    );
  END;

  v_receipt := jsonb_build_object(
    'status', 'success',
    'duplicate', false,
    'action_id', v_action_id,
    'source', v_source,
    'voice_event_id', CASE WHEN v_source = 'voice' THEN v_voice.id ELSE NULL END,
    'trace_id', p_trace_id
  );

  IF v_source = 'voice' THEN
    INSERT INTO public.tracker_voice_events (
      root_event_id, club_id, tournament_id, tournament_table_id,
      physical_table_id, hand_id, dealer_id, assignment_id, actor_user_id,
      actor_player_id, event_kind, provider_name, provider_model,
      provider_confidence, normalized_command, state_version, execution_mode,
      execution_result, validation_mode, turn_order_enforced,
      capability_version, idempotency_key, request_hash, trace_id, receipt
    ) VALUES (
      v_voice.id, v_voice.club_id, v_voice.tournament_id,
      v_voice.tournament_table_id, v_voice.physical_table_id, v_voice.hand_id,
      v_voice.dealer_id, v_voice.assignment_id, v_voice.actor_user_id,
      v_voice.actor_player_id, 'canonical_receipt', v_voice.provider_name,
      v_voice.provider_model, v_voice.provider_confidence,
      v_voice.normalized_command, v_voice.state_version, v_voice.execution_mode,
      'committed', v_voice.validation_mode, v_voice.turn_order_enforced,
      v_voice.capability_version, v_voice.idempotency_key,
      public._tracker_voice_request_hash(v_receipt), v_voice.trace_id, v_receipt
    );
  END IF;

  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public.record_action(
  UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TEXT, UUID
) FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.record_action(
  UUID, UUID, TEXT, INTEGER, INTEGER, TEXT, INTEGER, TEXT, TEXT, UUID
) TO authenticated;

CREATE OR REPLACE FUNCTION public.list_tracker_floor_alerts(
  p_tournament_id UUID,
  p_status TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_club_id UUID;
  v_items JSONB;
BEGIN
  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_actor IS NULL OR NOT (
    public.is_club_floor(v_actor, v_club_id)
    OR public.is_club_tracker(v_actor, v_club_id)
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  IF p_status IS NOT NULL
     AND p_status NOT IN ('open', 'acknowledged', 'in_progress', 'resolved', 'dismissed') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_alert_status');
  END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'id', a.id,
    'tournament_id', a.tournament_id,
    'tournament_table_id', a.tournament_table_id,
    'physical_table_id', a.physical_table_id,
    'hand_id', a.hand_id,
    'dealer_id', a.dealer_id,
    'dealer_name', d.full_name,
    'alert_kind', a.alert_kind,
    'priority', a.priority,
    'status', a.status,
    'version', a.version,
    'correction_required', a.correction_required,
    'title', a.title,
    'message', a.message,
    'created_at', a.created_at,
    'updated_at', a.updated_at
  ) ORDER BY
    CASE a.priority WHEN 'urgent' THEN 0 ELSE 1 END,
    a.created_at), '[]'::JSONB)
  INTO v_items
  FROM public.tracker_floor_alerts a
  JOIN public.dealers d ON d.id = a.dealer_id
  WHERE a.tournament_id = p_tournament_id
    AND (p_status IS NULL OR a.status = p_status);

  RETURN jsonb_build_object('ok', true, 'alerts', v_items);
END;
$function$;

REVOKE ALL ON FUNCTION public.list_tracker_floor_alerts(UUID, TEXT)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_tracker_floor_alerts(UUID, TEXT)
  TO authenticated;

CREATE OR REPLACE FUNCTION public.transition_tracker_floor_alert(
  p_alert_id UUID,
  p_expected_version INTEGER,
  p_transition TEXT,
  p_note TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_alert public.tracker_floor_alerts%ROWTYPE;
  v_before JSONB;
  v_after JSONB;
  v_request_hash TEXT;
  v_stored JSONB;
  v_next_status TEXT;
  v_receipt JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  IF p_idempotency_key IS NULL
     OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key');
  END IF;
  IF p_note IS NOT NULL AND char_length(p_note) > 500 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'note_too_long');
  END IF;

  SELECT * INTO v_alert
  FROM public.tracker_floor_alerts a
  WHERE a.id = p_alert_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'alert_not_found');
  END IF;
  IF NOT public.is_club_floor(v_actor, v_alert.club_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  v_request_hash := public._tracker_voice_request_hash(jsonb_build_object(
    'alert_id', p_alert_id,
    'expected_version', p_expected_version,
    'transition', p_transition,
    'note', COALESCE(p_note, '')
  ));
  v_stored := v_alert.transition_receipts->p_idempotency_key;
  IF v_stored IS NOT NULL THEN
    IF v_stored->>'request_hash' <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch');
    END IF;
    RETURN (v_stored->'receipt') || jsonb_build_object('duplicate', true);
  END IF;

  IF v_alert.version <> p_expected_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'stale_alert_version',
      'version', v_alert.version,
      'status', v_alert.status
    );
  END IF;

  v_next_status := CASE
    WHEN v_alert.status = 'open' AND p_transition = 'acknowledge' THEN 'acknowledged'
    WHEN v_alert.status IN ('open', 'acknowledged') AND p_transition = 'start' THEN 'in_progress'
    WHEN v_alert.status IN ('acknowledged', 'in_progress') AND p_transition = 'resolve' THEN 'resolved'
    WHEN v_alert.status IN ('open', 'acknowledged', 'in_progress') AND p_transition = 'dismiss' THEN 'dismissed'
    ELSE NULL
  END;
  IF v_next_status IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_alert_transition');
  END IF;

  v_before := jsonb_build_object(
    'status', v_alert.status,
    'version', v_alert.version,
    'acknowledged_by', v_alert.acknowledged_by,
    'resolved_by', v_alert.resolved_by
  );
  v_receipt := jsonb_build_object(
    'ok', true,
    'alert_id', v_alert.id,
    'status', v_next_status,
    'version', v_alert.version + 1,
    'duplicate', false
  );

  UPDATE public.tracker_floor_alerts
  SET status = v_next_status,
      version = version + 1,
      acknowledged_by = CASE
        WHEN v_next_status IN ('acknowledged', 'in_progress', 'resolved')
          THEN COALESCE(acknowledged_by, v_actor)
        ELSE acknowledged_by
      END,
      acknowledged_at = CASE
        WHEN v_next_status IN ('acknowledged', 'in_progress', 'resolved')
          THEN COALESCE(acknowledged_at, now())
        ELSE acknowledged_at
      END,
      resolved_by = CASE WHEN v_next_status IN ('resolved', 'dismissed') THEN v_actor ELSE resolved_by END,
      resolved_at = CASE WHEN v_next_status IN ('resolved', 'dismissed') THEN now() ELSE resolved_at END,
      resolution_note = CASE WHEN v_next_status IN ('resolved', 'dismissed') THEN NULLIF(btrim(p_note), '') ELSE resolution_note END,
      transition_receipts = transition_receipts || jsonb_build_object(
        p_idempotency_key,
        jsonb_build_object('request_hash', v_request_hash, 'receipt', v_receipt)
      ),
      updated_at = now()
  WHERE id = v_alert.id
  RETURNING jsonb_build_object(
    'status', status,
    'version', version,
    'acknowledged_by', acknowledged_by,
    'resolved_by', resolved_by
  ) INTO v_after;

  IF v_alert.correction_required AND v_next_status IN ('resolved', 'dismissed') THEN
    UPDATE public.tracker_voice_configs
    SET correction_state = 'ready',
        correction_alert_id = NULL,
        updated_at = now(),
        updated_by = v_actor
    WHERE tournament_id = v_alert.tournament_id
      AND tournament_table_id = v_alert.tournament_table_id
      AND correction_alert_id = v_alert.id;
  END IF;

  INSERT INTO public.audit_logs (
    club_id, actor_id, action, entity_type, entity_id, payload
  ) VALUES (
    v_alert.club_id,
    v_actor,
    'tracker_floor_alert_transition',
    'tracker_floor_alert',
    v_alert.id,
    jsonb_build_object(
      'before', v_before,
      'after', v_after,
      'transition', p_transition,
      'note', NULLIF(btrim(p_note), ''),
      'idempotency_key', p_idempotency_key
    )
  );

  RETURN v_receipt;
END;
$function$;

REVOKE ALL ON FUNCTION public.transition_tracker_floor_alert(UUID, INTEGER, TEXT, TEXT, TEXT)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.transition_tracker_floor_alert(UUID, INTEGER, TEXT, TEXT, TEXT)
  TO authenticated;

-- Narrow authorization seam for the operational analytics Edge. The browser
-- receives no hand/action rows through this RPC; it only proves caller scope.
CREATE OR REPLACE FUNCTION public.authorize_tracker_player_analytics(
  p_tournament_id UUID,
  p_player_id UUID
)
RETURNS JSONB
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_club_id UUID;
  v_allowed BOOLEAN := FALSE;
  v_player RECORD;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;
  SELECT t.club_id INTO v_club_id
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF NOT EXISTS (
    SELECT 1
    FROM public.tournament_hands h
    JOIN public.hand_players hp ON hp.hand_id = h.id
    WHERE h.tournament_id = p_tournament_id
      AND hp.player_id = p_player_id
  ) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'player_not_in_tournament');
  END IF;

  v_allowed := public.is_club_tracker(v_actor, v_club_id)
    OR public.is_club_floor(v_actor, v_club_id)
    OR EXISTS (
      SELECT 1
      FROM public.dealers d
      JOIN public.dealer_assignments da ON da.dealer_id = d.id
      JOIN public.tournament_tables tt
        ON tt.table_id = da.table_id
       AND tt.tournament_id = p_tournament_id
      WHERE d.user_id = v_actor
        AND d.club_id = v_club_id
        AND d.status = 'active'
        AND da.status = 'assigned'
        AND da.released_at IS NULL
    );
  IF NOT v_allowed THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  SELECT hp.player_name, hp.avatar_url, hp.seat_number
  INTO v_player
  FROM public.tournament_hands h
  JOIN public.hand_players hp ON hp.hand_id = h.id
  WHERE h.tournament_id = p_tournament_id
    AND hp.player_id = p_player_id
  ORDER BY h.hand_time DESC NULLS LAST, h.created_at DESC, h.id DESC
  LIMIT 1;

  RETURN jsonb_build_object(
    'ok', true,
    'club_id', v_club_id,
    'tournament_id', p_tournament_id,
    'player_id', p_player_id,
    'player_name', COALESCE(NULLIF(v_player.player_name, ''), 'Người chơi'),
    'avatar_url', v_player.avatar_url,
    'seat_number', v_player.seat_number
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.authorize_tracker_player_analytics(UUID, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.authorize_tracker_player_analytics(UUID, UUID)
  TO authenticated;

COMMIT;
