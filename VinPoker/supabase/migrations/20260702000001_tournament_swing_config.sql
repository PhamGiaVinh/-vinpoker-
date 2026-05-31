-- ═══════════════════════════════════════════════════════════════════════════════
-- Migration: Tournament swing configuration with hierarchical resolution
--
-- Hierarchy:
--   Table override (swing_configs) → Tournament config (tournaments)
--   → Club default (swing_configs.club) → Club legacy (swing_config) → 45min
--
-- Tables added:
--   1. tournaments — swing duration per tournament
--   2. tournament_tables — link tables to tournaments
--   3. swing_configs — club default + table-level override
--   4. swing_config_audit — change log
--
-- Functions added:
--   get_effective_swing_config(UUID) → full config with source
--   get_table_swing_duration(UUID) → just duration (for RPCs)
--
-- RPCs modified:
--   perform_swing — use table-specific swing_due_at
--   execute_pre_assigned_swing — use table-specific swing_due_at
-- ═══════════════════════════════════════════════════════════════════════════════

BEGIN;

-- ══════════════════════════════════════════════════════════════════════════════
-- 1. TOURNAMENTS TABLE
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.tournaments (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
    name TEXT NOT NULL,
    description TEXT,
    status TEXT NOT NULL DEFAULT 'active'
        CHECK (status IN ('active', 'completed', 'cancelled')),
    swing_duration_minutes INT NOT NULL DEFAULT 45
        CHECK (swing_duration_minutes >= 1),
    warn_at_minutes INT NOT NULL DEFAULT 5
        CHECK (warn_at_minutes >= 0),
    crit_at_minutes INT NOT NULL DEFAULT 2
        CHECK (crit_at_minutes >= 0),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now()
);

CREATE INDEX idx_tournaments_club_id ON public.tournaments(club_id);
CREATE INDEX idx_tournaments_status ON public.tournaments(status);

ALTER TABLE public.tournaments ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tournaments_select" ON public.tournaments
    FOR SELECT
    USING (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );

CREATE POLICY "tournaments_insert" ON public.tournaments
    FOR INSERT
    WITH CHECK (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );

CREATE POLICY "tournaments_update" ON public.tournaments
    FOR UPDATE
    USING (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );

CREATE POLICY "tournaments_delete" ON public.tournaments
    FOR DELETE
    USING (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );

-- ══════════════════════════════════════════════════════════════════════════════
-- 2. TOURNAMENT_TABLES — Link tables to tournaments
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.tournament_tables (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    tournament_id UUID NOT NULL REFERENCES public.tournaments(id) ON DELETE CASCADE,
    table_id UUID NOT NULL REFERENCES public.game_tables(id) ON DELETE CASCADE,
    created_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(table_id)  -- một bàn chỉ thuộc 1 tournament tại 1 thời điểm
);

CREATE INDEX idx_tournament_tables_tournament_id
    ON public.tournament_tables(tournament_id);

ALTER TABLE public.tournament_tables ENABLE ROW LEVEL SECURITY;

CREATE POLICY "tournament_tables_select" ON public.tournament_tables
    FOR SELECT
    USING (
        EXISTS (
            SELECT 1 FROM public.tournaments t
            WHERE t.id = tournament_id
            AND (
                public.is_club_dealer_control(auth.uid(), t.club_id)
                OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
            )
        )
    );

CREATE POLICY "tournament_tables_insert" ON public.tournament_tables
    FOR INSERT
    WITH CHECK (
        EXISTS (
            SELECT 1 FROM public.tournaments t
            WHERE t.id = tournament_id
            AND (
                public.is_club_dealer_control(auth.uid(), t.club_id)
                OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
            )
        )
    );

CREATE POLICY "tournament_tables_delete" ON public.tournament_tables
    FOR DELETE
    USING (
        EXISTS (
            SELECT 1 FROM public.tournaments t
            WHERE t.id = tournament_id
            AND (
                public.is_club_dealer_control(auth.uid(), t.club_id)
                OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
            )
        )
    );

-- ══════════════════════════════════════════════════════════════════════════════
-- 3. SWING_CONFIGS — Club default + Table-level override (optional)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.swing_configs (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
    scope_type TEXT NOT NULL CHECK (scope_type IN ('club', 'table')),
    scope_id UUID,  -- NULL khi scope_type = 'club', = table_id khi scope_type = 'table'
    swing_duration_minutes INT NOT NULL
        CHECK (swing_duration_minutes >= 1),
    warn_at_minutes INT NOT NULL DEFAULT 5
        CHECK (warn_at_minutes >= 0),
    crit_at_minutes INT NOT NULL DEFAULT 2
        CHECK (crit_at_minutes >= 0),
    created_at TIMESTAMPTZ DEFAULT now(),
    updated_at TIMESTAMPTZ DEFAULT now(),
    UNIQUE(club_id, scope_type, COALESCE(scope_id, '00000000-0000-0000-0000-000000000000'))
);

ALTER TABLE public.swing_configs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "swing_configs_select" ON public.swing_configs
    FOR SELECT
    USING (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );

CREATE POLICY "swing_configs_modify" ON public.swing_configs
    FOR INSERT
    WITH CHECK (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );

CREATE POLICY "swing_configs_update" ON public.swing_configs
    FOR UPDATE
    USING (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );

CREATE POLICY "swing_configs_delete" ON public.swing_configs
    FOR DELETE
    USING (
        public.is_club_dealer_control(auth.uid(), club_id)
        OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    );

-- ══════════════════════════════════════════════════════════════════════════════
-- 4. SWING_CONFIG_AUDIT — Change log
-- ══════════════════════════════════════════════════════════════════════════════

CREATE TABLE public.swing_config_audit (
    id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    changed_by UUID REFERENCES auth.users(id),
    club_id UUID NOT NULL REFERENCES public.clubs(id),
    entity_type TEXT NOT NULL,
    entity_id UUID,
    old_values JSONB,
    new_values JSONB,
    changed_at TIMESTAMPTZ DEFAULT now()
);

-- ══════════════════════════════════════════════════════════════════════════════
-- 5. AUDIT TRIGGER for tournaments
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.trg_tournament_audit()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_user_id UUID;
BEGIN
  v_user_id := auth.uid();

  IF TG_OP = 'INSERT' THEN
    INSERT INTO swing_config_audit (changed_by, club_id, entity_type, entity_id, new_values)
    VALUES (v_user_id, NEW.club_id, 'tournament', NEW.id, row_to_json(NEW)::jsonb);
    RETURN NEW;

  ELSIF TG_OP = 'UPDATE' THEN
    INSERT INTO swing_config_audit (changed_by, club_id, entity_type, entity_id, old_values, new_values)
    VALUES (v_user_id, NEW.club_id, 'tournament', NEW.id, row_to_json(OLD)::jsonb, row_to_json(NEW)::jsonb);
    RETURN NEW;

  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO swing_config_audit (changed_by, club_id, entity_type, entity_id, old_values)
    VALUES (v_user_id, OLD.club_id, 'tournament', OLD.id, row_to_json(OLD)::jsonb);
    RETURN OLD;
  END IF;
END;
$$;

CREATE TRIGGER trg_tournament_audit
    AFTER INSERT OR UPDATE OR DELETE ON public.tournaments
    FOR EACH ROW EXECUTE FUNCTION public.trg_tournament_audit();

-- ══════════════════════════════════════════════════════════════════════════════
-- 6. RESOLVER: get_effective_swing_config(p_table_id)
--    Table override → Tournament → Club default (swing_configs)
--    → Club legacy (swing_config) → Hardcoded 45min fallback
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_effective_swing_config(p_table_id UUID)
RETURNS TABLE (
    swing_duration_minutes INT,
    warn_at_minutes INT,
    crit_at_minutes INT,
    source TEXT
) LANGUAGE plpgsql STABLE
SET search_path = public
AS $$
DECLARE
    v_club_id UUID;
    v_tournament_id UUID;
    v_result RECORD;
BEGIN
    -- Get club_id from table
    SELECT gt.club_id INTO v_club_id
    FROM game_tables gt
    WHERE gt.id = p_table_id;

    IF v_club_id IS NULL THEN
        RETURN;
    END IF;

    -- Priority 1: Table-level override
    SELECT
        sc.swing_duration_minutes,
        sc.warn_at_minutes,
        sc.crit_at_minutes,
        'table'::TEXT as source
    INTO v_result
    FROM swing_configs sc
    WHERE sc.scope_type = 'table'
      AND sc.scope_id = p_table_id
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY SELECT
            v_result.swing_duration_minutes,
            v_result.warn_at_minutes,
            v_result.crit_at_minutes,
            v_result.source;
        RETURN;
    END IF;

    -- Priority 2: Tournament config
    SELECT t.id INTO v_tournament_id
    FROM tournament_tables tt
    JOIN tournaments t ON t.id = tt.tournament_id
    WHERE tt.table_id = p_table_id
      AND t.status = 'active'
    LIMIT 1;

    IF v_tournament_id IS NOT NULL THEN
        SELECT
            t.swing_duration_minutes,
            t.warn_at_minutes,
            t.crit_at_minutes,
            'tournament'::TEXT as source
        INTO v_result
        FROM tournaments t
        WHERE t.id = v_tournament_id;

        IF FOUND THEN
            RETURN QUERY SELECT
                v_result.swing_duration_minutes,
                v_result.warn_at_minutes,
                v_result.crit_at_minutes,
                v_result.source;
            RETURN;
        END IF;
    END IF;

    -- Priority 3: Club default (new swing_configs table)
    SELECT
        sc.swing_duration_minutes,
        sc.warn_at_minutes,
        sc.crit_at_minutes,
        'club'::TEXT as source
    INTO v_result
    FROM swing_configs sc
    WHERE sc.club_id = v_club_id
      AND sc.scope_type = 'club'
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY SELECT
            v_result.swing_duration_minutes,
            v_result.warn_at_minutes,
            v_result.crit_at_minutes,
            v_result.source;
        RETURN;
    END IF;

    -- Priority 4: Club default from legacy swing_config table
    SELECT
        sc.swing_duration_minutes,
        sc.warn_at_minutes,
        sc.crit_at_minutes,
        'club_legacy'::TEXT as source
    INTO v_result
    FROM swing_config sc
    WHERE sc.club_id = v_club_id
      AND sc.table_type = 'tournament'
    LIMIT 1;

    IF FOUND THEN
        RETURN QUERY SELECT
            v_result.swing_duration_minutes,
            v_result.warn_at_minutes,
            v_result.crit_at_minutes,
            v_result.source;
        RETURN;
    END IF;

    -- Fallback: hardcoded default
    RETURN QUERY SELECT
        45::INT as swing_duration_minutes,
        5::INT as warn_at_minutes,
        2::INT as crit_at_minutes,
        'default'::TEXT as source;
END;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 7. HELPER: get_table_swing_duration(p_table_id)
--    Returns just the swing duration in minutes (for RPC use)
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.get_table_swing_duration(p_table_id UUID)
RETURNS INT LANGUAGE sql STABLE
SET search_path = public
AS $$
    SELECT swing_duration_minutes
    FROM public.get_effective_swing_config(p_table_id)
    LIMIT 1;
$$;

-- ══════════════════════════════════════════════════════════════════════════════
-- 8. MODIFY perform_swing RPC — use table-specific swing_due_at
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.perform_swing(
    p_assignment_id uuid,
    p_version integer,
    p_next_attendance_id uuid DEFAULT NULL::uuid,
    p_send_to_break boolean DEFAULT false,
    p_break_duration_minutes integer DEFAULT NULL::integer,
    p_swing_duration_minutes integer DEFAULT 90,
    p_swing_due_at timestamp with time zone DEFAULT NULL::timestamp with time zone
)
 RETURNS jsonb
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
DECLARE
    v_old_attendance_id  UUID;
    v_table_id           UUID;
    v_club_id            UUID;
    v_current_version    INT;
    v_ot_started_at      TIMESTAMPTZ;
    v_is_new_ot          BOOLEAN;
    v_new_assignment_id  UUID;
    v_ot_minutes         INT;
    v_comp_break         INT;
    v_now                TIMESTAMPTZ := NOW();
    v_swing_due_at       TIMESTAMPTZ;
    v_assigned_at        TIMESTAMPTZ;
    v_actual_worked_min  INT;
    v_table_duration     INT;
BEGIN
    -- Resolve table-specific swing_duration BEFORE computing swing_due_at
    -- Priority: table override → tournament config → passed value → hardcoded
    v_table_duration := get_table_swing_duration(
        (SELECT table_id FROM dealer_assignments WHERE id = p_assignment_id)
    );

    v_swing_due_at := COALESCE(
        v_now + (v_table_duration || ' minutes')::INTERVAL,
        p_swing_due_at,
        v_now + (p_swing_duration_minutes || ' minutes')::INTERVAL
    );

    -- Load + lock assignment row in one shot
    SELECT
        da.attendance_id,
        da.table_id,
        da.version,
        da.overtime_started_at,
        da.assigned_at,
        gt.club_id
    INTO
        v_old_attendance_id,
        v_table_id,
        v_current_version,
        v_ot_started_at,
        v_assigned_at,
        v_club_id
    FROM dealer_assignments da
    JOIN game_tables gt ON gt.id = da.table_id
    WHERE da.id = p_assignment_id
      AND da.status = 'assigned'
      AND da.swing_processed_at IS NULL
    FOR UPDATE;

    IF NOT FOUND THEN
        RETURN jsonb_build_object('outcome', 'race_lost');
    END IF;

    IF v_current_version != p_version THEN
        RETURN jsonb_build_object('outcome', 'race_lost');
    END IF;

    -- ── NO DEALER AVAILABLE: start or continue OT tracking ───────────────────
    IF p_next_attendance_id IS NULL THEN
        v_is_new_ot := (v_ot_started_at IS NULL);

        UPDATE dealer_assignments
        SET overtime_started_at     = COALESCE(overtime_started_at, v_now),
            swing_retry_count       = 0,
            last_swing_attempted_at = v_now,
            swing_due_at            = v_now + INTERVAL '55 seconds',
            version                 = version + 1
        WHERE id = p_assignment_id;

        UPDATE dealer_attendance
        SET priority_break_flag = true
        WHERE id = v_old_attendance_id;

        RETURN jsonb_build_object(
            'outcome',           'no_dealer',
            'is_new_overtime',   v_is_new_ot,
            'overtime_started_at', COALESCE(v_ot_started_at, v_now)
        );
    END IF;

    -- ── DEALER FOUND: execute swing with compensatory break if OT ────────────
    IF v_ot_started_at IS NOT NULL THEN
        v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_ot_started_at))::INT / 60);
        v_comp_break := LEAST(p_break_duration_minutes + (v_ot_minutes / 2), 60);
    ELSE
        v_ot_minutes := 0;
        v_comp_break := p_break_duration_minutes;
    END IF;

    -- Calculate actual worked minutes for old dealer this assignment
    v_actual_worked_min := GREATEST(0, EXTRACT(EPOCH FROM (v_now - COALESCE(v_assigned_at, v_now)))::INT / 60);

    -- Release old assignment
    UPDATE dealer_assignments
    SET status             = 'completed',
        swing_processed_at = v_now,
        released_at        = v_now,
        overtime_started_at = NULL,
        version            = version + 1
    WHERE id = p_assignment_id;

    -- Update old dealer: accumulate OT + clear priority flag + total_worked
    UPDATE dealer_attendance
    SET overtime_minutes            = overtime_minutes + v_ot_minutes,
        priority_break_flag         = false,
        total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
    WHERE id = v_old_attendance_id;

    -- Send old dealer to break (compensatory if OT, standard otherwise)
    IF p_send_to_break THEN
        UPDATE dealer_attendance
        SET current_state = 'on_break'
        WHERE id = v_old_attendance_id;

        INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes)
        VALUES (p_assignment_id, v_now, v_comp_break);
    ELSE
        UPDATE dealer_attendance
        SET current_state = 'available'
        WHERE id = v_old_attendance_id;
    END IF;

    -- Create new assignment with table-specific swing_due_at
    INSERT INTO dealer_assignments (
        attendance_id, table_id, status, assigned_at, swing_due_at, version
    ) VALUES (
        p_next_attendance_id, v_table_id, 'assigned',
        v_now, v_swing_due_at, 1
    )
    ON CONFLICT (attendance_id) WHERE (status = 'assigned') DO NOTHING
    RETURNING id INTO v_new_assignment_id;

    -- Concurrent assignment conflict: rollback
    IF v_new_assignment_id IS NULL THEN
        UPDATE dealer_assignments
        SET status = 'assigned', swing_processed_at = NULL,
            released_at = NULL, overtime_started_at = v_ot_started_at,
            version = p_version
        WHERE id = p_assignment_id;
        UPDATE dealer_attendance
        SET current_state = 'assigned', priority_break_flag = (v_ot_started_at IS NOT NULL),
            overtime_minutes = GREATEST(0, overtime_minutes - v_ot_minutes),
            total_worked_minutes_today = GREATEST(0, COALESCE(total_worked_minutes_today, 0) - v_actual_worked_min)
        WHERE id = v_old_attendance_id;
        RETURN jsonb_build_object('outcome', 'race_lost');
    END IF;

    -- Update new dealer state + total_worked tracking
    UPDATE dealer_attendance
    SET current_state = 'assigned',
        total_worked_minutes_today = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min
    WHERE id = p_next_attendance_id;

    INSERT INTO swing_audit_logs (club_id, table_id, action, details, triggered_by)
    VALUES (v_club_id, v_table_id, 'swing_executed',
        jsonb_build_object(
            'ot_minutes', v_ot_minutes,
            'comp_break_minutes', v_comp_break,
            'was_overtime', v_ot_started_at IS NOT NULL,
            'swing_due_at', v_swing_due_at
        ), 'system');

    RETURN jsonb_build_object(
        'outcome',               'swung',
        'new_assignment_id',     v_new_assignment_id,
        'ot_minutes',            v_ot_minutes,
        'comp_break_minutes',    v_comp_break,
        'old_dealer_on_break',   p_send_to_break
    );
END;
$function$;

GRANT EXECUTE ON FUNCTION perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT, TIMESTAMPTZ)
    TO service_role;

-- ══════════════════════════════════════════════════════════════════════════════
-- 9. MODIFY execute_pre_assigned_swing RPC — use table-specific swing_due_at
-- ══════════════════════════════════════════════════════════════════════════════

CREATE OR REPLACE FUNCTION public.execute_pre_assigned_swing(
    p_old_assignment_id   UUID,
    p_next_attendance_id  UUID,
    p_swing_due_at        TIMESTAMPTZ,
    p_duration_minutes    INT,
    p_send_to_break       BOOLEAN DEFAULT false
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
    v_now               TIMESTAMPTZ := NOW();
    v_club_id           UUID;
    v_table_id          UUID;
    v_old_attendance_id UUID;
    v_new_assignment_id UUID;
    v_rows_updated      INT;
    v_actual_worked_min INT;
    v_last_break_end    TIMESTAMPTZ;
    v_check_in_time     TIMESTAMPTZ;
    v_incoming_name     TEXT;
    v_old_overtime_min  INT;
    v_ot_minutes        INT;
    v_overtime_started  TIMESTAMPTZ;
    v_comp_break        INT;
    v_effective_due_at  TIMESTAMPTZ;
    v_table_duration    INT;
BEGIN
    -- ==========================================
    -- GUARD: Validate inputs
    -- ==========================================
    IF p_old_assignment_id IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_old_assignment_id is null');
    END IF;

    IF p_next_attendance_id IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_next_attendance_id is null');
    END IF;

    IF p_duration_minutes IS NULL OR p_duration_minutes <= 0 THEN
        RETURN jsonb_build_object('status', 'error', 'error', 'INVALID_INPUT: p_duration_minutes must be > 0');
    END IF;

    -- ==========================================
    -- [1] Lấy thông tin old assignment + resolve table-specific swing_due_at
    -- ==========================================
    SELECT
        gt.club_id,
        da.table_id,
        da.attendance_id,
        da.overtime_started_at
    INTO
        v_club_id,
        v_table_id,
        v_old_attendance_id,
        v_overtime_started
    FROM dealer_assignments da
    JOIN game_tables gt ON gt.id = da.table_id
    WHERE da.id = p_old_assignment_id;

    IF v_table_id IS NULL THEN
        RETURN jsonb_build_object('status', 'error', 'error', 'OLD_ASSIGNMENT_NOT_FOUND');
    END IF;

    -- Resolve table-specific swing_due_at:
    -- Priority: table override → tournament config → passed value → hardcoded
    v_table_duration := get_table_swing_duration(v_table_id);

    v_effective_due_at := COALESCE(
        v_now + (v_table_duration || ' minutes')::INTERVAL,
        p_swing_due_at,
        v_now + (p_duration_minutes || ' minutes')::INTERVAL
    );

    -- ==========================================
    -- [2] Resolve incoming dealer name (for Telegram)
    -- ==========================================
    SELECT full_name INTO v_incoming_name
    FROM dealers WHERE id = (SELECT dealer_id FROM dealer_attendance WHERE id = p_next_attendance_id);

    -- ==========================================
    -- [3] Lock dealer + double-check available & checked in
    -- ==========================================
    UPDATE dealer_attendance
    SET current_state = 'assigned'
    WHERE id            = p_next_attendance_id
      AND current_state = 'available'
      AND status        = 'checked_in';

    GET DIAGNOSTICS v_rows_updated = ROW_COUNT;

    IF v_rows_updated = 0 THEN
        UPDATE dealer_assignments
        SET pre_assigned_attendance_id = NULL, pre_assigned_at = NULL, updated_at = v_now
        WHERE id = p_old_assignment_id;

        RETURN jsonb_build_object(
            'status', 'race_lost',
            'detail', 'Dealer ' || p_next_attendance_id || ' no longer available or checked out',
            'incoming_name', v_incoming_name
        );
    END IF;

    -- ==========================================
    -- [4] Calculate OT + compensatory break if applicable
    -- ==========================================
    IF v_overtime_started IS NOT NULL THEN
        v_ot_minutes := GREATEST(0, EXTRACT(EPOCH FROM (v_now - v_overtime_started))::INT / 60);
        SELECT overtime_minutes INTO v_old_overtime_min
        FROM dealer_attendance WHERE id = v_old_attendance_id;
        v_comp_break := LEAST(15 + (v_ot_minutes / 2), 60);
    ELSE
        v_ot_minutes := 0;
        v_comp_break := 15;
    END IF;

    -- ==========================================
    -- [5] Tính worked_minutes thực tế cho dealer CŨ
    -- ==========================================
    SELECT MAX(db.break_end) INTO v_last_break_end
    FROM dealer_breaks db
    JOIN dealer_assignments da2 ON da2.id = db.assignment_id
    WHERE da2.attendance_id = v_old_attendance_id AND db.break_end IS NOT NULL;

    SELECT check_in_time INTO v_check_in_time
    FROM dealer_attendance WHERE id = v_old_attendance_id;

    v_actual_worked_min := GREATEST(0,
        EXTRACT(EPOCH FROM (v_now - COALESCE(v_last_break_end, v_check_in_time)))::INT / 60
    );

    -- ==========================================
    -- [6] Close old assignment
    -- ==========================================
    UPDATE dealer_assignments
    SET
        status              = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'completed' END,
        swing_processed_at  = v_now,
        overtime_started_at = NULL,
        updated_at          = v_now
    WHERE id = p_old_assignment_id;

    -- ==========================================
    -- [7] Update state + OT accumulation for old dealer
    -- ==========================================
    UPDATE dealer_attendance
    SET
        current_state               = CASE WHEN p_send_to_break THEN 'on_break' ELSE 'available' END,
        worked_minutes_since_last_break = CASE WHEN p_send_to_break THEN 0 ELSE v_actual_worked_min END,
        overtime_minutes            = COALESCE(overtime_minutes, 0) + v_ot_minutes,
        priority_break_flag         = false,
        total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_actual_worked_min,
        updated_at                  = v_now
    WHERE id = v_old_attendance_id;

    -- ==========================================
    -- [7b] Insert break record if sending to break
    -- ==========================================
    IF p_send_to_break THEN
        INSERT INTO dealer_breaks (assignment_id, break_start, expected_duration_minutes, reason, created_at)
        VALUES (p_old_assignment_id, v_now, v_comp_break, 'auto_break_on_swing', v_now);
    END IF;

    -- ==========================================
    -- [8] Insert new assignment with table-specific swing_due_at
    -- ==========================================
    INSERT INTO dealer_assignments (
        attendance_id, table_id, status, swing_due_at, duration_minutes, created_at, updated_at
    ) VALUES (
        p_next_attendance_id, v_table_id, 'assigned',
        v_effective_due_at,
        COALESCE(v_table_duration, p_duration_minutes),
        v_now, v_now
    )
    ON CONFLICT (attendance_id) WHERE status = 'assigned'
    DO NOTHING
    RETURNING id INTO v_new_assignment_id;

    -- ==========================================
    -- [9] Rollback on duplicate
    -- ==========================================
    IF v_new_assignment_id IS NULL THEN
        UPDATE dealer_attendance
        SET current_state = 'available', updated_at = v_now
        WHERE id = p_next_attendance_id;

        UPDATE dealer_assignments
        SET status = 'assigned', swing_processed_at = NULL,
            overtime_started_at = v_overtime_started, updated_at = v_now
        WHERE id = p_old_assignment_id;

        UPDATE dealer_attendance
        SET current_state = 'assigned',
            overtime_minutes = GREATEST(0, COALESCE(overtime_minutes, 0) - v_ot_minutes),
            priority_break_flag = (v_overtime_started IS NOT NULL),
            updated_at = v_now
        WHERE id = v_old_attendance_id;

        IF p_send_to_break THEN
            DELETE FROM dealer_breaks WHERE assignment_id = p_old_assignment_id AND break_start = v_now;
        END IF;

        RETURN jsonb_build_object(
            'status', 'race_lost',
            'detail', 'Dealer ' || p_next_attendance_id || ' already assigned elsewhere (ON CONFLICT)',
            'incoming_name', v_incoming_name
        );
    END IF;

    -- ==========================================
    -- [10] Update worked_minutes for incoming dealer
    -- ==========================================
    DECLARE
        v_new_last_break  TIMESTAMPTZ;
        v_new_check_in    TIMESTAMPTZ;
        v_new_worked      INT;
    BEGIN
        SELECT MAX(db.break_end) INTO v_new_last_break
        FROM dealer_breaks db
        JOIN dealer_assignments da2 ON da2.id = db.assignment_id
        WHERE da2.attendance_id = p_next_attendance_id AND db.break_end IS NOT NULL;

        SELECT check_in_time INTO v_new_check_in
        FROM dealer_attendance WHERE id = p_next_attendance_id;

        v_new_worked := GREATEST(0,
            EXTRACT(EPOCH FROM (v_now - COALESCE(v_new_last_break, v_new_check_in)))::INT / 60
        );

        UPDATE dealer_attendance
        SET
            current_state               = 'assigned',
            worked_minutes_since_last_break = 0,
            total_worked_minutes_today  = COALESCE(total_worked_minutes_today, 0) + v_new_worked,
            updated_at                  = v_now
        WHERE id = p_next_attendance_id;
    END;

    -- ==========================================
    -- [11] Audit log
    -- ==========================================
    INSERT INTO swing_audit_logs (club_id, table_id, action, details, triggered_by)
    VALUES (v_club_id, v_table_id, 'pre_assigned_swing_executed',
        jsonb_build_object(
            'ot_minutes', v_ot_minutes,
            'comp_break_minutes', v_comp_break,
            'was_overtime', v_overtime_started IS NOT NULL,
            'swing_due_at', v_effective_due_at,
            'incoming_name', v_incoming_name
        ), 'cron');

    -- ==========================================
    -- [12] Return success
    -- ==========================================
    RETURN jsonb_build_object(
        'status',             'success',
        'new_assignment_id',  v_new_assignment_id,
        'old_assignment_id',  p_old_assignment_id,
        'incoming_name',      v_incoming_name,
        'sent_to_break',      p_send_to_break,
        'worked_minutes',     v_actual_worked_min,
        'ot_minutes',         v_ot_minutes,
        'comp_break_minutes', v_comp_break,
        'swing_due_at',       v_effective_due_at,
        'duration_minutes',   COALESCE(v_table_duration, p_duration_minutes)
    );

EXCEPTION WHEN OTHERS THEN
    RETURN jsonb_build_object(
        'status',   'error',
        'error',    'UNHANDLED_EXCEPTION',
        'detail',   SQLERRM,
        'sqlstate', SQLSTATE
    );
END;
$$;

GRANT EXECUTE ON FUNCTION execute_pre_assigned_swing(UUID, UUID, TIMESTAMPTZ, INT, BOOLEAN)
    TO service_role;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Verify migration
-- ═══════════════════════════════════════════════════════════════════════════════
DO $$
BEGIN
    -- Verify tables exist
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournaments'),
        'tournaments table missing';
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'tournament_tables'),
        'tournament_tables table missing';
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'swing_configs'),
        'swing_configs table missing';
    ASSERT EXISTS (SELECT 1 FROM information_schema.tables WHERE table_name = 'swing_config_audit'),
        'swing_config_audit table missing';

    -- Verify functions exist
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_effective_swing_config'),
        'get_effective_swing_config function missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'get_table_swing_duration'),
        'get_table_swing_duration function missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'perform_swing'),
        'perform_swing function missing';
    ASSERT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'execute_pre_assigned_swing'),
        'execute_pre_assigned_swing function missing';

    -- Verify trigger exists
    ASSERT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_tournament_audit'),
        'trg_tournament_audit trigger missing';

    RAISE NOTICE '✅ Migration 20260702000001 OK — all checks passed';
END $$;

COMMIT;
