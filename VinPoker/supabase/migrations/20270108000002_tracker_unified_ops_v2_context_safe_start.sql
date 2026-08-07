-- Tracker Unified Ops V2: context + safe start (PR2A, source-only).
--
-- This migration intentionally does not replace legacy start_hand, mutate
-- settlement, or implement stack correction/void (PR2B/PR2C). V2 accepts only
-- tournament_tables.id and derives all hand state from locked server rows.

BEGIN;

-- ---------------------------------------------------------------------------
-- Durable V2 hand snapshots and lock version.
-- ---------------------------------------------------------------------------
ALTER TABLE public.tournament_hands
  ADD COLUMN IF NOT EXISTS tracker_context_version TEXT,
  ADD COLUMN IF NOT EXISTS tracker_level_id UUID,
  ADD COLUMN IF NOT EXISTS tracker_level_number INTEGER,
  ADD COLUMN IF NOT EXISTS tracker_small_blind INTEGER,
  ADD COLUMN IF NOT EXISTS tracker_big_blind INTEGER,
  ADD COLUMN IF NOT EXISTS tracker_bba INTEGER,
  ADD COLUMN IF NOT EXISTS tracker_is_break BOOLEAN,
  ADD COLUMN IF NOT EXISTS tracker_lock_version BIGINT NOT NULL DEFAULT 0;

CREATE INDEX IF NOT EXISTS idx_tournament_hands_tracker_context
  ON public.tournament_hands (tournament_id, table_id, hand_number DESC);

-- Lock ownership changes are context changes, while heartbeat timestamps are
-- deliberately not. This keeps context_version stable during a heartbeat.
CREATE OR REPLACE FUNCTION public.tracker_unified_ops_bump_lock_version()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
BEGIN
  IF NEW.locked_by_user_id IS DISTINCT FROM OLD.locked_by_user_id THEN
    NEW.tracker_lock_version := GREATEST(COALESCE(OLD.tracker_lock_version, 0), 0) + 1;
  END IF;
  RETURN NEW;
END;
$function$;

DROP TRIGGER IF EXISTS trg_tracker_unified_ops_lock_version
  ON public.tournament_hands;
CREATE TRIGGER trg_tracker_unified_ops_lock_version
  BEFORE UPDATE OF locked_by_user_id ON public.tournament_hands
  FOR EACH ROW
  EXECUTE FUNCTION public.tracker_unified_ops_bump_lock_version();

REVOKE ALL ON FUNCTION public.tracker_unified_ops_bump_lock_version()
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Idempotency receipts are private implementation state. They are written
-- only inside V2 SECURITY DEFINER transactions and never exposed to clients.
-- ---------------------------------------------------------------------------
CREATE TABLE IF NOT EXISTS public.tracker_unified_ops_receipts (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  operation TEXT NOT NULL CHECK (operation IN ('start_hand', 'correct_stack', 'ack_stack_correction', 'void_hand')),
  actor_user_id UUID NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
  idempotency_key TEXT NOT NULL CHECK (idempotency_key ~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$'),
  request_hash TEXT NOT NULL CHECK (request_hash ~ '^[0-9a-f]{64}$'),
  response JSONB NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE (operation, actor_user_id, tournament_id, idempotency_key)
);

CREATE INDEX IF NOT EXISTS idx_tracker_unified_ops_receipts_tournament
  ON public.tracker_unified_ops_receipts (tournament_id, operation, created_at DESC);

ALTER TABLE public.tracker_unified_ops_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.tracker_unified_ops_receipts
  FROM PUBLIC, anon, authenticated, service_role;

-- One advisory key is shared by all V2 mutations. Existing legacy writers are
-- retained unchanged for rollback; their lock-compatibility audit is a
-- separate gate before any V2 flag enablement.
CREATE OR REPLACE FUNCTION public.tracker_unified_ops_lock_tournament(p_tournament_id UUID)
RETURNS VOID
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $function$
BEGIN
  IF p_tournament_id IS NULL THEN
    RAISE EXCEPTION 'tournament_id_required' USING ERRCODE = '22023';
  END IF;
  PERFORM pg_advisory_xact_lock(
    hashtextextended('tracker-unified-ops:' || p_tournament_id::TEXT, 0)
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.tracker_unified_ops_lock_tournament(UUID)
  FROM PUBLIC, anon, authenticated, service_role;

CREATE OR REPLACE FUNCTION public._tracker_unified_ops_request_hash_v2(p_payload JSONB)
RETURNS TEXT
LANGUAGE SQL
IMMUTABLE
SECURITY INVOKER
SET search_path = public
AS $function$
  SELECT public._series_sha256_jsonb_v1(p_payload);
$function$;

REVOKE ALL ON FUNCTION public._tracker_unified_ops_request_hash_v2(JSONB)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Internal context projector. The hash payload is intentionally assembled
-- separately from the display payload so names, avatars, warnings and lease
-- timestamps can never become CAS inputs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public._tracker_unified_ops_context_v2(
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_actor UUID DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_tour RECORD;
  v_tt RECORD;
  v_level RECORD;
  v_active RECORD;
  v_roster JSONB := '[]'::JSONB;
  v_roster_hash JSONB := '[]'::JSONB;
  v_level_json JSONB;
  v_level_hash_json JSONB;
  v_active_json JSONB;
  v_active_hash JSONB;
  v_hash_input JSONB;
  v_context_version TEXT;
  v_blockers JSONB := '[]'::JSONB;
  v_warnings JSONB := '[]'::JSONB;
  v_capabilities JSONB := '[]'::JSONB;
  v_table_status TEXT;
  v_next_hand_number INTEGER := 1;
  v_valid_roster_count INTEGER := 0;
  v_bad_projection_count INTEGER := 0;
  v_non_positive_count INTEGER := 0;
  v_missing_entry_count INTEGER := 0;
  v_mismatched_entry_count INTEGER := 0;
  v_duplicate_player_count INTEGER := 0;
  v_duplicate_seat_count INTEGER := 0;
  v_chip_set_bound BOOLEAN := FALSE;
  v_template_count INTEGER := 0;
  v_issued_template_count INTEGER := 0;
  v_inventory_conserved BOOLEAN := FALSE;
  v_inventory_total BIGINT := 0;
  v_inventory_reconciliation BIGINT := 0;
  v_is_tracker BOOLEAN := FALSE;
  v_is_floor BOOLEAN := FALSE;
  v_has_active BOOLEAN := FALSE;
  v_has_level BOOLEAN := FALSE;
  v_lock_state TEXT;
  v_allowed_action TEXT;
BEGIN
  SELECT t.id, t.name, t.status, t.club_id, t.current_level,
         t.current_level_id, t.clock_paused_at
  INTO v_tour
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;

  SELECT tt.id, tt.tournament_id, tt.table_id, tt.table_number, tt.status,
         tt.floor_control_mode, tt.floor_control_revision,
         gt.table_name
  INTO v_tt
  FROM public.tournament_tables tt
  JOIN public.game_tables gt ON gt.id = tt.table_id
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id;

  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.tournament_tables tt WHERE tt.id = p_tournament_table_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'table_tournament_mismatch');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found');
  END IF;

  v_is_tracker := public.is_club_tracker(p_actor, v_tour.club_id);
  v_is_floor := public.is_club_floor(p_actor, v_tour.club_id);
  IF v_is_tracker OR v_is_floor THEN
    v_capabilities := v_capabilities || jsonb_build_array(
      'read_context', 'view_chipmaster_projection'
    );
  END IF;
  IF v_is_tracker THEN
    v_capabilities := v_capabilities || jsonb_build_array(
      'start_hand', 'record_hand', 'void_hand'
    );
  END IF;
  IF v_is_floor THEN
    v_capabilities := v_capabilities || jsonb_build_array(
      'set_control_mode', 'manage_roster', 'correct_stack'
    );
  END IF;
  IF v_is_tracker OR v_is_floor THEN
    v_capabilities := v_capabilities || jsonb_build_array('edit_display_identity');
  END IF;

  v_table_status := CASE v_tt.status
    WHEN 'broken' THEN 'paused'
    ELSE v_tt.status
  END;

  SELECT COALESCE(MAX(h.hand_number), 0) + 1
  INTO v_next_hand_number
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND h.table_id IN (v_tt.id, v_tt.table_id);

  SELECT h.id, h.hand_number, h.status, h.hand_time, h.locked_by_user_id,
         h.locked_at, COALESCE(h.tracker_lock_version, 0) AS tracker_lock_version
  INTO v_active
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND h.table_id IN (v_tt.id, v_tt.table_id)
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false
  ORDER BY h.hand_number DESC, h.id DESC
  LIMIT 1;

  v_has_active := FOUND;
  IF v_has_active THEN
    IF v_active.locked_by_user_id IS NULL
       OR v_active.locked_at IS NULL
       OR v_active.locked_at <= now() - interval '5 minutes' THEN
      v_lock_state := 'stale';
      v_allowed_action := 'explicit_void';
    ELSIF p_actor IS NOT NULL AND v_active.locked_by_user_id = p_actor THEN
      v_lock_state := 'mine';
      v_allowed_action := 'resume';
    ELSE
      v_lock_state := 'other';
      v_allowed_action := 'request_takeover';
    END IF;

    v_active_json := jsonb_build_object(
      'hand_id', v_active.id,
      'hand_number', v_active.hand_number,
      'status', 'in_progress',
      'started_at', v_active.hand_time,
      'locked_by_user_id', v_active.locked_by_user_id,
      'locked_at', v_active.locked_at,
      'lock_version', v_active.tracker_lock_version,
      'lock_state', v_lock_state,
      'allowed_action', v_allowed_action
    );
    v_active_hash := jsonb_build_object(
      'hand_id', v_active.id,
      'hand_number', v_active.hand_number,
      'status', 'in_progress',
      'locked_by_user_id', v_active.locked_by_user_id,
      'lock_version', v_active.tracker_lock_version
    );
  ELSE
    v_active_json := 'null'::JSONB;
    v_active_hash := 'null'::JSONB;
  END IF;

  SELECT tl.id, tl.level_number, tl.small_blind, tl.big_blind, tl.ante,
         tl.is_break
  INTO v_level
  FROM public.tournament_levels tl
  WHERE tl.tournament_id = p_tournament_id
    AND (
      (v_tour.current_level_id IS NOT NULL AND tl.id = v_tour.current_level_id)
      OR (
        v_tour.current_level_id IS NULL
        AND v_tour.current_level IS NOT NULL
        AND tl.level_number = v_tour.current_level
      )
    )
  ORDER BY tl.level_number
  LIMIT 1;

  v_has_level := FOUND;
  IF v_has_level THEN
    v_level_json := jsonb_build_object(
      'id', v_level.id,
      'number', v_level.level_number,
      'small_blind', v_level.small_blind,
      'big_blind', v_level.big_blind,
      'ante', v_level.ante,
      'is_break', v_level.is_break,
      'clock_paused', v_tour.clock_paused_at IS NOT NULL
    );
    v_level_hash_json := jsonb_build_object(
      'id', v_level.id,
      'number', GREATEST(v_level.level_number, 0),
      'small_blind', GREATEST(v_level.small_blind, 0),
      'big_blind', GREATEST(v_level.big_blind, 0),
      'ante', GREATEST(v_level.ante, 0),
      'is_break', v_level.is_break,
      'clock_paused', v_tour.clock_paused_at IS NOT NULL
    );
  ELSE
    v_level_json := 'null'::JSONB;
    v_level_hash_json := 'null'::JSONB;
  END IF;

  SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.seat_number, x.seat_id), '[]'::JSONB)
  INTO v_roster
  FROM (
    SELECT
      s.id AS seat_id,
      s.seat_number,
      jsonb_build_object(
        'seat_id', s.id,
        'entry_id', s.entry_id,
        'player_id', s.player_id,
        'entry_number', s.entry_number,
        'seat_number', s.seat_number,
        'seat_stack', s.chip_count,
        'tracker_stack', COALESCE(tcc.chip_count, 0),
        'entry_stack', COALESCE(e.current_stack, 0),
        'display_name', COALESCE(NULLIF(btrim(p.display_name), ''), format('Người chơi ghế %s', s.seat_number)),
        'avatar_url', COALESCE(s.avatar_url, p.avatar_url)
      ) AS row_json
    FROM public.tournament_seats s
    LEFT JOIN public.tournament_entries e
      ON e.id = s.entry_id
     AND e.tournament_id = s.tournament_id
    LEFT JOIN public.tournament_chip_counts tcc
      ON tcc.tournament_id = s.tournament_id
     AND tcc.player_id = s.player_id
     AND tcc.entry_number = s.entry_number
    LEFT JOIN public.profiles p ON p.user_id = s.player_id
    WHERE s.tournament_id = p_tournament_id
      AND s.table_id = v_tt.id
      AND s.is_active
      AND s.status = 'active'
      AND s.entry_id IS NOT NULL
  ) x;

  SELECT COALESCE(jsonb_agg(x.row_json ORDER BY x.seat_number, x.seat_id), '[]'::JSONB)
  INTO v_roster_hash
  FROM (
    SELECT
      s.id AS seat_id,
      s.seat_number,
      jsonb_build_object(
        'seat_id', s.id,
        'entry_id', s.entry_id,
        'player_id', s.player_id,
        'entry_number', GREATEST(s.entry_number, 0),
        'seat_number', GREATEST(s.seat_number, 0),
        'seat_stack', GREATEST(s.chip_count, 0),
        'tracker_stack', GREATEST(COALESCE(tcc.chip_count, 0), 0),
        'entry_stack', GREATEST(COALESCE(e.current_stack, 0), 0)
      ) AS row_json
    FROM public.tournament_seats s
    LEFT JOIN public.tournament_entries e
      ON e.id = s.entry_id
     AND e.tournament_id = s.tournament_id
    LEFT JOIN public.tournament_chip_counts tcc
      ON tcc.tournament_id = s.tournament_id
     AND tcc.player_id = s.player_id
     AND tcc.entry_number = s.entry_number
    WHERE s.tournament_id = p_tournament_id
      AND s.table_id = v_tt.id
      AND s.is_active
      AND s.status = 'active'
      AND s.entry_id IS NOT NULL
  ) x;

  SELECT count(*)::INTEGER
  INTO v_valid_roster_count
  FROM public.tournament_seats s
  JOIN public.tournament_entries e
    ON e.id = s.entry_id
   AND e.tournament_id = s.tournament_id
   AND e.player_id = s.player_id
   AND e.entry_no = s.entry_number
    AND e.table_id IS NOT DISTINCT FROM v_tt.table_id
   AND e.seat_id IS NOT DISTINCT FROM s.id
   AND e.status = 'seated'
  WHERE s.tournament_id = p_tournament_id
    AND s.table_id = v_tt.id
    AND s.is_active
    AND s.status = 'active'
    AND s.entry_id IS NOT NULL;

  SELECT count(*)::INTEGER
  INTO v_missing_entry_count
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id
    AND s.table_id = v_tt.id
    AND s.is_active
    AND s.status = 'active'
    AND s.entry_id IS NULL;

  SELECT count(*)::INTEGER
  INTO v_mismatched_entry_count
  FROM public.tournament_seats s
  LEFT JOIN public.tournament_entries e
    ON e.id = s.entry_id
   AND e.tournament_id = s.tournament_id
  WHERE s.tournament_id = p_tournament_id
    AND s.table_id = v_tt.id
    AND s.is_active
    AND s.status = 'active'
    AND s.entry_id IS NOT NULL
    AND (
      e.id IS NULL
      OR e.player_id IS DISTINCT FROM s.player_id
      OR e.entry_no IS DISTINCT FROM s.entry_number
      OR e.table_id IS DISTINCT FROM v_tt.table_id
      OR e.seat_id IS DISTINCT FROM s.id
      OR e.status IS DISTINCT FROM 'seated'
    );

  SELECT count(*)::INTEGER
  INTO v_duplicate_player_count
  FROM (
    SELECT s.player_id
    FROM public.tournament_seats s
    JOIN public.tournament_entries e
      ON e.id = s.entry_id
     AND e.tournament_id = s.tournament_id
     AND e.player_id = s.player_id
     AND e.entry_no = s.entry_number
     AND e.table_id IS NOT DISTINCT FROM v_tt.table_id
     AND e.seat_id IS NOT DISTINCT FROM s.id
     AND e.status = 'seated'
    WHERE s.tournament_id = p_tournament_id
      AND s.table_id = v_tt.id
      AND s.is_active
      AND s.status = 'active'
    GROUP BY s.player_id
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*)::INTEGER
  INTO v_duplicate_seat_count
  FROM (
    SELECT s.seat_number
    FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id
      AND s.table_id = v_tt.id
      AND s.is_active
      AND s.status = 'active'
    GROUP BY s.seat_number
    HAVING count(*) > 1
  ) duplicates;

  SELECT count(*)::INTEGER
  INTO v_non_positive_count
  FROM public.tournament_seats s
  JOIN public.tournament_entries e
    ON e.id = s.entry_id
   AND e.tournament_id = s.tournament_id
   AND e.player_id = s.player_id
   AND e.entry_no = s.entry_number
   AND e.table_id IS NOT DISTINCT FROM v_tt.table_id
   AND e.seat_id IS NOT DISTINCT FROM s.id
   AND e.status = 'seated'
  LEFT JOIN public.tournament_chip_counts tcc
    ON tcc.tournament_id = s.tournament_id
   AND tcc.player_id = s.player_id
   AND tcc.entry_number = s.entry_number
  WHERE s.tournament_id = p_tournament_id
    AND s.table_id = v_tt.id
    AND s.is_active
    AND s.status = 'active'
    AND (s.chip_count <= 0 OR COALESCE(tcc.chip_count, 0) <= 0 OR e.current_stack <= 0);

  SELECT count(*)::INTEGER
  INTO v_bad_projection_count
  FROM public.tournament_seats s
  JOIN public.tournament_entries e
    ON e.id = s.entry_id
   AND e.tournament_id = s.tournament_id
   AND e.player_id = s.player_id
   AND e.entry_no = s.entry_number
   AND e.table_id IS NOT DISTINCT FROM v_tt.table_id
   AND e.seat_id IS NOT DISTINCT FROM s.id
   AND e.status = 'seated'
  LEFT JOIN public.tournament_chip_counts tcc
    ON tcc.tournament_id = s.tournament_id
   AND tcc.player_id = s.player_id
   AND tcc.entry_number = s.entry_number
  WHERE s.tournament_id = p_tournament_id
    AND s.table_id = v_tt.id
    AND s.is_active
    AND s.status = 'active'
    AND (
      s.chip_count IS DISTINCT FROM COALESCE(tcc.chip_count, 0)
      OR s.chip_count IS DISTINCT FROM e.current_stack
      OR COALESCE(tcc.chip_count, 0) IS DISTINCT FROM e.current_stack
    );

  IF v_table_status <> 'active' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'table_not_active', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.tableNotActive',
      'target', jsonb_build_object('tournament_table_id', v_tt.id, 'physical_table_id', v_tt.table_id),
      'remediation', 'open_floor_table'
    ));
  END IF;

  IF v_tt.floor_control_mode <> 'tracker' THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tracker_mode_required', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.trackerModeRequired',
      'target', jsonb_build_object('tournament_table_id', v_tt.id),
      'remediation', 'open_floor_mode'
    ));
  END IF;

  IF v_missing_entry_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'seat_entry_missing', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.seatEntryMissing',
      'target', jsonb_build_object('tournament_table_id', v_tt.id),
      'remediation', 'open_floor_seat'
    ));
  END IF;

  IF v_mismatched_entry_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'seat_entry_mismatch', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.seatEntryMismatch',
      'target', jsonb_build_object('tournament_table_id', v_tt.id),
      'remediation', 'open_floor_seat'
    ));
  END IF;

  IF v_duplicate_player_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'duplicate_active_player', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.duplicateActivePlayer',
      'target', jsonb_build_object('tournament_table_id', v_tt.id),
      'remediation', 'open_floor_seat'
    ));
  END IF;

  IF v_duplicate_seat_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'duplicate_seat', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.duplicateSeat',
      'target', jsonb_build_object('tournament_table_id', v_tt.id),
      'remediation', 'open_floor_seat'
    ));
  END IF;

  IF v_valid_roster_count < 2 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'not_enough_players', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.notEnoughPlayers',
      'target', jsonb_build_object('tournament_table_id', v_tt.id),
      'remediation', 'open_floor_seat'
    ));
  END IF;

  IF v_non_positive_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'stack_non_positive', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.stackNonPositive',
      'target', jsonb_build_object('tournament_table_id', v_tt.id),
      'remediation', 'open_floor_stack'
    ));
  END IF;

  IF v_bad_projection_count > 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'stack_projection_mismatch', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.stackProjectionMismatch',
      'target', jsonb_build_object('tournament_table_id', v_tt.id),
      'remediation', 'open_floor_stack'
    ));
  END IF;

  IF NOT v_has_level THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'current_level_missing', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.currentLevelMissing',
      'target', jsonb_build_object('tournament_id', p_tournament_id),
      'remediation', 'open_floor_level'
    ));
  ELSIF v_level.is_break THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'tournament_break_active', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.tournamentBreakActive',
      'target', jsonb_build_object('tournament_id', p_tournament_id),
      'remediation', 'open_floor_level'
    ));
  ELSIF v_level.small_blind <= 0
     OR v_level.big_blind <= 0
     OR v_level.ante < 0
     OR v_level.big_blind < v_level.small_blind
     OR v_level.level_number <= 0 THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'current_level_invalid', 'severity', 'blocker', 'owner', 'floor',
      'message_key', 'tracker.readiness.currentLevelInvalid',
      'target', jsonb_build_object('tournament_id', p_tournament_id),
      'remediation', 'open_floor_level'
    ));
  END IF;

  IF v_tour.clock_paused_at IS NOT NULL THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'clock_paused', 'severity', 'warning', 'owner', 'floor',
      'message_key', 'tracker.readiness.clockPaused',
      'target', jsonb_build_object('tournament_id', p_tournament_id),
      'remediation', 'none'
    ));
  END IF;

  IF v_has_active THEN
    v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
      'code', 'active_hand_exists', 'severity', 'blocker', 'owner', 'tracker',
      'message_key', 'tracker.readiness.activeHandExists',
      'target', jsonb_build_object('tournament_table_id', v_tt.id, 'hand_id', v_active.id),
      'remediation', CASE v_allowed_action
        WHEN 'resume' THEN 'resume_hand'
        WHEN 'request_takeover' THEN 'request_takeover'
        ELSE 'refresh_context'
      END
    ));
    IF v_lock_state = 'other' THEN
      v_blockers := v_blockers || jsonb_build_array(jsonb_build_object(
        'code', 'lock_owned_by_other', 'severity', 'blocker', 'owner', 'tracker',
        'message_key', 'tracker.readiness.lockOwnedByOther',
        'target', jsonb_build_object('tournament_table_id', v_tt.id, 'hand_id', v_active.id),
        'remediation', 'request_takeover'
      ));
    END IF;
  END IF;

  SELECT EXISTS (
    SELECT 1
    FROM public.tournament_chip_set tcs
    WHERE tcs.tournament_id = p_tournament_id
  ) INTO v_chip_set_bound;

  SELECT count(*)::INTEGER
  INTO v_template_count
  FROM public.stack_template st
  WHERE st.tournament_id = p_tournament_id;

  SELECT count(*)::INTEGER
  INTO v_issued_template_count
  FROM public.stack_template st
  JOIN public.stack_template_issuance sti ON sti.stack_template_id = st.id
  WHERE st.tournament_id = p_tournament_id
    AND sti.issued_count > 0;

  SELECT
    COALESCE(SUM(d.value * l.count::BIGINT * COALESCE(sti.issued_count, 0)), 0)::BIGINT,
    COALESCE(SUM(st.stack_value * COALESCE(sti.issued_count, 0)), 0)::BIGINT
  INTO v_inventory_total, v_inventory_reconciliation
  FROM public.stack_template st
  LEFT JOIN public.stack_template_line l ON l.stack_template_id = st.id
  LEFT JOIN public.chip_set_denomination d ON d.id = l.denomination_id
  LEFT JOIN public.stack_template_issuance sti ON sti.stack_template_id = st.id
  WHERE st.tournament_id = p_tournament_id;

  v_inventory_conserved := v_template_count > 0
    AND v_inventory_total = v_inventory_reconciliation;

  IF NOT v_chip_set_bound THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'chip_set_not_bound', 'severity', 'warning', 'owner', 'chipmaster',
      'message_key', 'tracker.readiness.chipSetNotBound',
      'target', jsonb_build_object('tournament_id', p_tournament_id),
      'remediation', 'open_chipmaster'
    ));
  END IF;
  IF v_template_count = 0 THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'stack_template_missing', 'severity', 'warning', 'owner', 'chipmaster',
      'message_key', 'tracker.readiness.stackTemplateMissing',
      'target', jsonb_build_object('tournament_id', p_tournament_id),
      'remediation', 'open_chipmaster'
    ));
  END IF;
  IF v_issued_template_count < v_template_count THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'issuance_missing', 'severity', 'warning', 'owner', 'chipmaster',
      'message_key', 'tracker.readiness.issuanceMissing',
      'target', jsonb_build_object('tournament_id', p_tournament_id),
      'remediation', 'open_chipmaster'
    ));
  END IF;
  IF NOT v_inventory_conserved THEN
    v_warnings := v_warnings || jsonb_build_array(jsonb_build_object(
      'code', 'denomination_inventory_not_conserved', 'severity', 'warning', 'owner', 'chipmaster',
      'message_key', 'tracker.readiness.denominationInventoryNotConserved',
      'target', jsonb_build_object('tournament_id', p_tournament_id),
      'remediation', 'open_chipmaster'
    ));
  END IF;

  v_hash_input := jsonb_build_object(
    'context_hash_version', 'tracker-context-v1',
    'tournament', jsonb_build_object('id', v_tour.id, 'status', v_tour.status),
    'table', jsonb_build_object(
      'tournament_table_id', v_tt.id,
      'physical_table_id', v_tt.table_id,
      'status', v_table_status,
      'control_mode', v_tt.floor_control_mode,
      'control_revision', GREATEST(v_tt.floor_control_revision, 0)
    ),
    'roster', v_roster_hash,
    'active_hand', v_active_hash,
    'next_hand_number', v_next_hand_number,
    'level', v_level_hash_json
  );

  v_context_version := public._tracker_unified_ops_request_hash_v2(v_hash_input);

  RETURN jsonb_build_object(
    'ok', true,
    'contract_version', 'tracker-unified-ops-v2',
    'tournament_id', v_tour.id,
    'tournament_name', v_tour.name,
    'tournament_table_id', v_tt.id,
    'physical_table_id', v_tt.table_id,
    'table_name', v_tt.table_name,
    'table_number', v_tt.table_number,
    'table_status', v_table_status,
    'control_mode', v_tt.floor_control_mode,
    'control_revision', v_tt.floor_control_revision,
    'context_version', v_context_version,
    'next_hand_number', v_next_hand_number,
    'roster', v_roster,
    'active_hand', v_active_json,
    'level', v_level_json,
    'readiness', jsonb_build_object(
      'state', CASE WHEN jsonb_array_length(v_blockers) = 0 THEN 'ready' ELSE 'blocked' END,
      'blockers', v_blockers,
      'warnings', v_warnings
    ),
    'chipmaster', jsonb_build_object(
      'chip_set_bound', v_chip_set_bound,
      'template_count', v_template_count,
      'issued_template_count', v_issued_template_count,
      'denomination_inventory_conserved', v_inventory_conserved,
      'pending_correction_count', 0
    ),
    'capabilities', v_capabilities
  );
END;
$function$;

REVOKE ALL ON FUNCTION public._tracker_unified_ops_context_v2(UUID, UUID, UUID)
  FROM PUBLIC, anon, authenticated, service_role;

-- ---------------------------------------------------------------------------
-- Read-only list/context RPCs.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.list_tracker_tables_v2(p_tournament_id UUID)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_tour RECORD;
  v_tables JSONB := '[]'::JSONB;
  v_ctx JSONB;
  v_group TEXT;
BEGIN
  SELECT t.id, t.name, t.club_id INTO v_tour
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_actor IS NULL
     OR NOT (public.is_club_tracker(v_actor, v_tour.club_id) OR public.is_club_floor(v_actor, v_tour.club_id)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  FOR v_ctx IN
    SELECT public._tracker_unified_ops_context_v2(p_tournament_id, tt.id, v_actor)
    FROM public.tournament_tables tt
    WHERE tt.tournament_id = p_tournament_id
    ORDER BY tt.table_number NULLS LAST, tt.created_at, tt.id
  LOOP
    IF v_ctx->'active_hand' IS NOT NULL AND v_ctx->'active_hand' <> 'null'::JSONB THEN
      v_group := 'active_hand';
    ELSIF v_ctx->'readiness'->>'state' = 'blocked' THEN
      v_group := 'needs_floor';
    ELSE
      v_group := 'ready';
    END IF;

    v_tables := v_tables || jsonb_build_array(jsonb_build_object(
      'tournament_id', v_ctx->'tournament_id',
      'tournament_table_id', v_ctx->'tournament_table_id',
      'physical_table_id', v_ctx->'physical_table_id',
      'table_name', v_ctx->'table_name',
      'table_number', v_ctx->'table_number',
      'table_status', v_ctx->'table_status',
      'control_mode', v_ctx->'control_mode',
      'context_version', v_ctx->'context_version',
      'player_count', jsonb_array_length(v_ctx->'roster'),
      'next_hand_number', v_ctx->'next_hand_number',
      'active_hand', v_ctx->'active_hand',
      'launcher_group', v_group,
      'readiness', v_ctx->'readiness'
    ));
  END LOOP;

  RETURN jsonb_build_object(
    'ok', true,
    'contract_version', 'tracker-unified-ops-v2',
    'tournament_id', p_tournament_id,
    'tournament_name', v_tour.name,
    'tables', v_tables
  );
END;
$function$;

REVOKE ALL ON FUNCTION public.list_tracker_tables_v2(UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.list_tracker_tables_v2(UUID) TO authenticated;

CREATE OR REPLACE FUNCTION public.get_tracker_table_context_v2(
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
  v_club UUID;
BEGIN
  SELECT t.club_id INTO v_club
  FROM public.tournaments t
  WHERE t.id = p_tournament_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found');
  END IF;
  IF v_actor IS NULL
     OR NOT (public.is_club_tracker(v_actor, v_club) OR public.is_club_floor(v_actor, v_club)) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;
  RETURN public._tracker_unified_ops_context_v2(p_tournament_id, p_tournament_table_id, v_actor);
END;
$function$;

REVOKE ALL ON FUNCTION public.get_tracker_table_context_v2(UUID, UUID)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.get_tracker_table_context_v2(UUID, UUID) TO authenticated;

-- ---------------------------------------------------------------------------
-- Server-authoritative V2 start. This function never calls legacy start_hand.
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.start_tracker_hand_v2(
  p_tournament_id UUID,
  p_tournament_table_id UUID,
  p_button_seat INTEGER,
  p_expected_context_version TEXT,
  p_idempotency_key TEXT
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $function$
DECLARE
  v_actor UUID := auth.uid();
  v_tour RECORD;
  v_tt RECORD;
  v_existing RECORD;
  v_receipt_id UUID;
  v_request_hash TEXT;
  v_request JSONB;
  v_response JSONB;
  v_receipt JSONB;
  v_context JSONB;
  v_next_context JSONB;
  v_active RECORD;
  v_has_active BOOLEAN := FALSE;
  v_hand_id UUID;
  v_hand_number INTEGER;
  v_hand_time TIMESTAMPTZ := now();
  v_level JSONB;
  v_roster JSONB;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized', 'message_key', 'tracker.errors.unauthorized');
  END IF;
  IF p_tournament_id IS NULL OR p_tournament_table_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found', 'message_key', 'tracker.errors.tableNotFound');
  END IF;
  IF p_button_seat IS NULL OR p_button_seat < 1 OR p_button_seat > 10 THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_button_seat', 'message_key', 'tracker.errors.invalidButtonSeat');
  END IF;
  IF p_expected_context_version IS NULL
     OR p_expected_context_version !~ '^[0-9a-f]{64}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'stale_table_context', 'message_key', 'tracker.errors.staleTableContext');
  END IF;
  IF p_idempotency_key IS NULL OR p_idempotency_key !~ '^[A-Za-z0-9][A-Za-z0-9._:-]{11,255}$' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_idempotency_key', 'message_key', 'tracker.errors.invalidIdempotencyKey');
  END IF;

  v_request := jsonb_build_object(
    'tournament_id', p_tournament_id,
    'tournament_table_id', p_tournament_table_id,
    'button_seat', p_button_seat,
    'expected_context_version', p_expected_context_version
  );
  v_request_hash := public._tracker_unified_ops_request_hash_v2(v_request);

  PERFORM public.tracker_unified_ops_lock_tournament(p_tournament_id);

  SELECT t.id, t.club_id, t.status, t.current_level, t.current_level_id
  INTO v_tour
  FROM public.tournaments t
  WHERE t.id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_found', 'message_key', 'tracker.errors.tournamentNotFound');
  END IF;
  IF NOT public.is_club_tracker(v_actor, v_tour.club_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed', 'message_key', 'tracker.errors.actorNotAllowed');
  END IF;
  IF v_tour.status IN ('completed', 'cancelled') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'tournament_not_open', 'message_key', 'tracker.errors.tournamentNotOpen');
  END IF;

  -- Idempotency is checked after the tournament lock, so two tabs cannot race
  -- the same operation/key. A replay returns the persisted response unchanged
  -- except for the explicit replay marker.
  SELECT r.* INTO v_existing
  FROM public.tracker_unified_ops_receipts r
  WHERE r.operation = 'start_hand'
    AND r.actor_user_id = v_actor
    AND r.tournament_id = p_tournament_id
    AND r.idempotency_key = p_idempotency_key
  FOR UPDATE;
  IF FOUND THEN
    IF v_existing.request_hash <> v_request_hash THEN
      RETURN jsonb_build_object('ok', false, 'error', 'idempotency_mismatch', 'message_key', 'tracker.errors.idempotencyMismatch');
    END IF;
    RETURN jsonb_set(
      jsonb_set(v_existing.response, '{receipt,replayed}', 'true'::JSONB, true),
      '{replayed}', 'true'::JSONB, true
    );
  END IF;

  SELECT tt.id, tt.tournament_id, tt.table_id, tt.max_seats, tt.status, tt.floor_control_mode
  INTO v_tt
  FROM public.tournament_tables tt
  WHERE tt.id = p_tournament_table_id
    AND tt.tournament_id = p_tournament_id
  FOR UPDATE;
  IF NOT FOUND THEN
    IF EXISTS (SELECT 1 FROM public.tournament_tables tt WHERE tt.id = p_tournament_table_id) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'table_tournament_mismatch', 'message_key', 'tracker.errors.tableTournamentMismatch');
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'table_not_found', 'message_key', 'tracker.errors.tableNotFound');
  END IF;

  IF p_button_seat > v_tt.max_seats THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'invalid_button_seat',
      'message_key', 'tracker.errors.invalidButtonSeat',
      'max_seats', v_tt.max_seats
    );
  END IF;

  -- Fixed row-lock order after the tournament advisory lock.
  SELECT h.* INTO v_active
  FROM public.tournament_hands h
  WHERE h.tournament_id = p_tournament_id
    AND h.table_id IN (v_tt.id, v_tt.table_id)
    AND h.status = 'in_progress'
    AND COALESCE(h.is_voided, false) = false
  ORDER BY h.hand_number DESC, h.id DESC
  LIMIT 1
  FOR UPDATE;
  v_has_active := FOUND;

  PERFORM 1
  FROM public.tournament_seats s
  WHERE s.tournament_id = p_tournament_id
    AND s.table_id = v_tt.id
  FOR UPDATE;

  PERFORM 1
  FROM public.tournament_entries e
  WHERE e.id IN (
    SELECT s.entry_id
    FROM public.tournament_seats s
    WHERE s.tournament_id = p_tournament_id
      AND s.table_id = v_tt.id
      AND s.entry_id IS NOT NULL
  )
  FOR UPDATE;

  PERFORM 1
  FROM public.tournament_chip_counts c
  WHERE c.tournament_id = p_tournament_id
    AND EXISTS (
      SELECT 1
      FROM public.tournament_seats s
      WHERE s.tournament_id = c.tournament_id
        AND s.table_id = v_tt.id
        AND s.player_id = c.player_id
        AND s.entry_number = c.entry_number
    )
  FOR UPDATE;

  PERFORM 1
  FROM public.tournament_levels l
  WHERE l.tournament_id = p_tournament_id
    AND (
      (v_tour.current_level_id IS NOT NULL AND l.id = v_tour.current_level_id)
      OR (
        v_tour.current_level_id IS NULL
        AND v_tour.current_level IS NOT NULL
        AND l.level_number = v_tour.current_level
      )
    )
  FOR UPDATE;

  v_context := public._tracker_unified_ops_context_v2(p_tournament_id, p_tournament_table_id, v_actor);
  IF COALESCE(v_context->>'ok', 'false') <> 'true' THEN
    RETURN v_context;
  END IF;

  IF v_has_active THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'active_hand_exists',
      'message_key', 'tracker.errors.activeHandExists',
      'hand_id', v_context->'active_hand'->'hand_id',
      'lock_state', v_context->'active_hand'->'lock_state',
      'allowed_action', v_context->'active_hand'->'allowed_action',
      'context_version', v_context->>'context_version'
    );
  END IF;

  IF v_context->>'context_version' <> p_expected_context_version THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'stale_table_context',
      'message_key', 'tracker.errors.staleTableContext',
      'context_version', v_context->>'context_version'
    );
  END IF;

  IF v_context->'readiness'->>'state' <> 'ready' THEN
    RETURN jsonb_build_object(
      'ok', false,
      'error', 'readiness_blocked',
      'message_key', 'tracker.errors.readinessBlocked',
      'context_version', v_context->>'context_version',
      'readiness', v_context->'readiness'
    );
  END IF;

  v_hand_number := (v_context->>'next_hand_number')::INTEGER;
  v_level := v_context->'level';
  v_roster := v_context->'roster';

  INSERT INTO public.tournament_hands (
    tournament_id,
    table_id,
    hand_number,
    hand_time,
    status,
    created_by,
    locked_by_user_id,
    locked_at,
    button_seat,
    tracker_context_version,
    tracker_level_id,
    tracker_level_number,
    tracker_small_blind,
    tracker_big_blind,
    tracker_bba,
    tracker_is_break,
    tracker_lock_version
  )
  VALUES (
    p_tournament_id,
    v_tt.id,
    v_hand_number,
    v_hand_time,
    'in_progress',
    v_actor,
    v_actor,
    v_hand_time,
    p_button_seat,
    v_context->>'context_version',
    (v_level->>'id')::UUID,
    (v_level->>'number')::INTEGER,
    (v_level->>'small_blind')::INTEGER,
    (v_level->>'big_blind')::INTEGER,
    (v_level->>'ante')::INTEGER,
    (v_level->>'is_break')::BOOLEAN,
    1
  )
  RETURNING id INTO v_hand_id;

  INSERT INTO public.hand_players (
    hand_id,
    tournament_id,
    player_id,
    entry_number,
    seat_number,
    starting_stack,
    ending_stack,
    is_eliminated,
    side_pots,
    hole_cards,
    player_name,
    avatar_url
  )
  SELECT
    v_hand_id,
    p_tournament_id,
    (r->>'player_id')::UUID,
    (r->>'entry_number')::INTEGER,
    (r->>'seat_number')::INTEGER,
    (r->>'seat_stack')::INTEGER,
    NULL,
    false,
    '[]'::JSONB,
    '[]'::JSONB,
    r->>'display_name',
    NULLIF(r->>'avatar_url', '')
  FROM jsonb_array_elements(v_roster) r;

  v_next_context := public._tracker_unified_ops_context_v2(p_tournament_id, p_tournament_table_id, v_actor);
  v_receipt_id := gen_random_uuid();
  v_receipt := jsonb_build_object(
    'receipt_id', v_receipt_id,
    'operation', 'start_hand',
    'actor_user_id', v_actor,
    'tournament_id', p_tournament_id,
    'idempotency_key', p_idempotency_key,
    'request_hash', v_request_hash,
    'replayed', false
  );
  v_response := jsonb_build_object(
    'ok', true,
    'outcome', 'started',
    'hand_id', v_hand_id,
    'hand_number', v_hand_number,
    'hand_time', v_hand_time,
    'tournament_table_id', p_tournament_table_id,
    'physical_table_id', v_tt.table_id,
    'starting_context_version', v_context->>'context_version',
    'next_context_version', v_next_context->>'context_version',
    'level', v_level,
    'receipt', v_receipt,
    'replayed', false
  );

  INSERT INTO public.tracker_unified_ops_receipts (
    id, operation, actor_user_id, tournament_id, idempotency_key, request_hash, response
  )
  VALUES (
    v_receipt_id, 'start_hand', v_actor, p_tournament_id,
    p_idempotency_key, v_request_hash, v_response
  );

  RETURN v_response;
END;
$function$;

REVOKE ALL ON FUNCTION public.start_tracker_hand_v2(UUID, UUID, INTEGER, TEXT, TEXT)
  FROM PUBLIC, anon, service_role;
GRANT EXECUTE ON FUNCTION public.start_tracker_hand_v2(UUID, UUID, INTEGER, TEXT, TEXT)
  TO authenticated;

COMMIT;
