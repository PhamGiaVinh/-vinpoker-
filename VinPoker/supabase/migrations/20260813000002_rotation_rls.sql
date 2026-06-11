-- Forward Rotation Scheduler — RLS + future dealer-app read contract.

BEGIN;

ALTER TABLE public.dealer_rotation_schedule ENABLE ROW LEVEL SECURITY;

-- Club staff (dealer control / club admin / super admin) can read the schedule.
DROP POLICY IF EXISTS "rotation_schedule_select_control" ON public.dealer_rotation_schedule;
CREATE POLICY "rotation_schedule_select_control"
  ON public.dealer_rotation_schedule FOR SELECT
  USING (
    public.is_club_dealer_control(auth.uid(), club_id)
    OR public.is_club_admin(auth.uid(), club_id)
    OR public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

-- A dealer can read rows where they are the incoming or outgoing dealer
-- (future dealer-app: "my upcoming swings").
DROP POLICY IF EXISTS "rotation_schedule_select_own" ON public.dealer_rotation_schedule;
CREATE POLICY "rotation_schedule_select_own"
  ON public.dealer_rotation_schedule FOR SELECT
  USING (
    EXISTS (
      SELECT 1
      FROM public.dealer_attendance a
      JOIN public.dealers d ON d.id = a.dealer_id
      WHERE a.id IN (dealer_rotation_schedule.in_attendance_id,
                     dealer_rotation_schedule.out_attendance_id)
        AND d.user_id = auth.uid()
    )
  );

-- The edge function (service_role) owns all writes.
DROP POLICY IF EXISTS "rotation_schedule_service_all" ON public.dealer_rotation_schedule;
CREATE POLICY "rotation_schedule_service_all"
  ON public.dealer_rotation_schedule FOR ALL
  USING (auth.role() = 'service_role')
  WITH CHECK (auth.role() = 'service_role');

-- Future dealer-app contract: the authed dealer's upcoming rotations.
CREATE OR REPLACE VIEW public.dealer_my_rotation
WITH (security_invoker = on) AS
SELECT
  s.id,
  s.club_id,
  s.table_id,
  gt.table_name,
  s.slot_index,
  s.status,
  s.planned_relief_at,
  s.announce_at,
  s.is_shortage,
  s.is_emergency,
  (ia.id IS NOT NULL AND din.user_id = auth.uid()) AS i_am_incoming
FROM public.dealer_rotation_schedule s
JOIN public.game_tables gt ON gt.id = s.table_id
LEFT JOIN public.dealer_attendance ia ON ia.id = s.in_attendance_id
LEFT JOIN public.dealers din ON din.id = ia.dealer_id
WHERE s.status IN ('predicted','announced','executing')
ORDER BY s.planned_relief_at;

GRANT SELECT ON public.dealer_my_rotation TO authenticated;

COMMIT;
