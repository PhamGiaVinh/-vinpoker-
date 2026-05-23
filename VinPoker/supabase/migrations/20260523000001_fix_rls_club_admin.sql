-- Club Admin can now read dealer swing data (tours, tables, attendance, etc.)
-- Previously only dealer_control and super_admin had access

-- Helper: is user a club admin (owner) for a given club?
CREATE OR REPLACE FUNCTION public.is_club_admin(_user_id UUID, _club_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = _club_id AND c.owner_id = _user_id
  );
$$;

-- ==============================================================
-- CLUB DEALER CONTROLS — club admin can also manage
-- ==============================================================
DROP POLICY IF EXISTS "club_dealer_controls_insert_super" ON public.club_dealer_controls;
CREATE POLICY "club_dealer_controls_insert_super"
  ON public.club_dealer_controls FOR INSERT
  WITH CHECK (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_dealer_controls.club_id AND c.owner_id = auth.uid())
  );

DROP POLICY IF EXISTS "club_dealer_controls_delete_super" ON public.club_dealer_controls;
CREATE POLICY "club_dealer_controls_delete_super"
  ON public.club_dealer_controls FOR DELETE
  USING (
    public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_dealer_controls.club_id AND c.owner_id = auth.uid())
  );

-- ==============================================================
-- DEALER SHIFTS (Tours) — club admin can read/write
-- ==============================================================
DROP POLICY IF EXISTS "dealer_shifts_select_control" ON public.dealer_shifts;
CREATE POLICY "dealer_shifts_select_control"
  ON public.dealer_shifts FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

DROP POLICY IF EXISTS "dealer_shifts_insert_control" ON public.dealer_shifts;
CREATE POLICY "dealer_shifts_insert_control"
  ON public.dealer_shifts FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

DROP POLICY IF EXISTS "dealer_shifts_update_control" ON public.dealer_shifts;
CREATE POLICY "dealer_shifts_update_control"
  ON public.dealer_shifts FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

DROP POLICY IF EXISTS "dealer_shifts_delete_control" ON public.dealer_shifts;
CREATE POLICY "dealer_shifts_delete_control"
  ON public.dealer_shifts FOR DELETE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

-- ==============================================================
-- DEALER ATTENDANCE
-- ==============================================================
DROP POLICY IF EXISTS "dealer_attendance_select_control" ON public.dealer_attendance;
CREATE POLICY "dealer_attendance_select_control"
  ON public.dealer_attendance FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_attendance.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_attendance.dealer_id))
  );

DROP POLICY IF EXISTS "dealer_attendance_insert_control" ON public.dealer_attendance;
CREATE POLICY "dealer_attendance_insert_control"
  ON public.dealer_attendance FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_attendance.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_attendance.dealer_id))
  );

DROP POLICY IF EXISTS "dealer_attendance_update_control" ON public.dealer_attendance;
CREATE POLICY "dealer_attendance_update_control"
  ON public.dealer_attendance FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_attendance.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_attendance.dealer_id))
  );

-- ==============================================================
-- GAME TABLES
-- ==============================================================
DROP POLICY IF EXISTS "game_tables_select_control" ON public.game_tables;
CREATE POLICY "game_tables_select_control"
  ON public.game_tables FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

DROP POLICY IF EXISTS "game_tables_insert_control" ON public.game_tables;
CREATE POLICY "game_tables_insert_control"
  ON public.game_tables FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

DROP POLICY IF EXISTS "game_tables_update_control" ON public.game_tables;
CREATE POLICY "game_tables_update_control"
  ON public.game_tables FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

-- ==============================================================
-- DEALER ASSIGNMENTS
-- ==============================================================
DROP POLICY IF EXISTS "dealer_assignments_select_control" ON public.dealer_assignments;
CREATE POLICY "dealer_assignments_select_control"
  ON public.dealer_assignments FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.game_tables WHERE id = dealer_assignments.table_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.game_tables WHERE id = dealer_assignments.table_id))
  );

DROP POLICY IF EXISTS "dealer_assignments_insert_control" ON public.dealer_assignments;
CREATE POLICY "dealer_assignments_insert_control"
  ON public.dealer_assignments FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.game_tables WHERE id = dealer_assignments.table_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.game_tables WHERE id = dealer_assignments.table_id))
  );

DROP POLICY IF EXISTS "dealer_assignments_update_control" ON public.dealer_assignments;
CREATE POLICY "dealer_assignments_update_control"
  ON public.dealer_assignments FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.game_tables WHERE id = dealer_assignments.table_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.game_tables WHERE id = dealer_assignments.table_id))
  );

-- ==============================================================
-- DEALER BREAKS (assignment_id → dealer_assignments → table_id → game_tables)
-- ==============================================================
DROP POLICY IF EXISTS "dealer_breaks_select_control" ON public.dealer_breaks;
CREATE POLICY "dealer_breaks_select_control"
  ON public.dealer_breaks FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (
      SELECT gt.club_id FROM public.game_tables gt
      JOIN public.dealer_assignments da ON da.table_id = gt.id
      WHERE da.id = dealer_breaks.assignment_id
    ))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (
      SELECT gt.club_id FROM public.game_tables gt
      JOIN public.dealer_assignments da ON da.table_id = gt.id
      WHERE da.id = dealer_breaks.assignment_id
    ))
  );

DROP POLICY IF EXISTS "dealer_breaks_insert_control" ON public.dealer_breaks;
CREATE POLICY "dealer_breaks_insert_control"
  ON public.dealer_breaks FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (
      SELECT gt.club_id FROM public.game_tables gt
      JOIN public.dealer_assignments da ON da.table_id = gt.id
      WHERE da.id = dealer_breaks.assignment_id
    ))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (
      SELECT gt.club_id FROM public.game_tables gt
      JOIN public.dealer_assignments da ON da.table_id = gt.id
      WHERE da.id = dealer_breaks.assignment_id
    ))
  );

DROP POLICY IF EXISTS "dealer_breaks_update_control" ON public.dealer_breaks;
CREATE POLICY "dealer_breaks_update_control"
  ON public.dealer_breaks FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), (
      SELECT gt.club_id FROM public.game_tables gt
      JOIN public.dealer_assignments da ON da.table_id = gt.id
      WHERE da.id = dealer_breaks.assignment_id
    ))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (
      SELECT gt.club_id FROM public.game_tables gt
      JOIN public.dealer_assignments da ON da.table_id = gt.id
      WHERE da.id = dealer_breaks.assignment_id
    ))
  );

-- ==============================================================
-- DEALER SKILLS
-- ==============================================================
DROP POLICY IF EXISTS "dealer_skills_select" ON public.dealer_skills;
CREATE POLICY "dealer_skills_select"
  ON public.dealer_skills FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_skills.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_skills.dealer_id))
  );

DROP POLICY IF EXISTS "dealer_skills_insert_control" ON public.dealer_skills;
CREATE POLICY "dealer_skills_insert_control"
  ON public.dealer_skills FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_skills.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_skills.dealer_id))
  );

DROP POLICY IF EXISTS "dealer_skills_update_control" ON public.dealer_skills;
CREATE POLICY "dealer_skills_update_control"
  ON public.dealer_skills FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_skills.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_skills.dealer_id))
  );

-- ==============================================================
-- SWING CONFIG
-- ==============================================================
DROP POLICY IF EXISTS "swing_config_select" ON public.swing_config;
CREATE POLICY "swing_config_select"
  ON public.swing_config FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

DROP POLICY IF EXISTS "swing_config_insert_control" ON public.swing_config;
CREATE POLICY "swing_config_insert_control"
  ON public.swing_config FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

DROP POLICY IF EXISTS "swing_config_update_control" ON public.swing_config;
CREATE POLICY "swing_config_update_control"
  ON public.swing_config FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

-- ==============================================================
-- AUDIT LOGS
-- ==============================================================
DROP POLICY IF EXISTS "audit_logs_select_control" ON public.audit_logs;
CREATE POLICY "audit_logs_select_control"
  ON public.audit_logs FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );

-- ==============================================================
-- DEALER INCIDENTS
-- ==============================================================
DROP POLICY IF EXISTS "dealer_incidents_select_control" ON public.dealer_incidents;
CREATE POLICY "dealer_incidents_select_control"
  ON public.dealer_incidents FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_incidents.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_incidents.dealer_id))
  );

DROP POLICY IF EXISTS "dealer_incidents_insert_control" ON public.dealer_incidents;
CREATE POLICY "dealer_incidents_insert_control"
  ON public.dealer_incidents FOR INSERT
  WITH CHECK (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_incidents.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_incidents.dealer_id))
  );

DROP POLICY IF EXISTS "dealer_incidents_update_control" ON public.dealer_incidents;
CREATE POLICY "dealer_incidents_update_control"
  ON public.dealer_incidents FOR UPDATE
  USING (
    public.is_club_dealer_control(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_incidents.dealer_id))
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), (SELECT club_id FROM public.dealers WHERE id = dealer_incidents.dealer_id))
  );

-- ==============================================================
-- DEALERS table read for club_admin
-- ==============================================================
DROP POLICY IF EXISTS "dealers_select_dealer_control" ON public.dealers;
CREATE POLICY "dealers_select_dealer_control"
  ON public.dealers FOR SELECT
  USING (
    EXISTS (SELECT 1 FROM public.club_dealer_controls cdc WHERE cdc.user_id = auth.uid() AND cdc.club_id = dealers.club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
    OR public.is_club_admin(auth.uid(), club_id)
  );
