-- CLI-created20261010090041, reserved forward45 after catalog/live36 checks.
-- Restrict only the legacy universal SELECT; preserve existing write policy.
-- ROLLBACK: do not restore universal SELECT. Roll back affected UI first;
-- forward-fix a proven missing legitimate role, preserving tenant isolation.
BEGIN;
SET LOCAL lock_timeout='5s';
SET LOCAL statement_timeout='30s';
DO $$ BEGIN
 IF to_regprocedure('public.can_read_floor_seat_tickets_v1(uuid)') IS NOT NULL THEN
   RAISE EXCEPTION 'seat_ticket_select_helper_already_exists';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='seat_draw_receipts'
   AND policyname='seat_draw_receipts_select_authenticated' AND cmd='SELECT'
   AND roles=ARRAY['authenticated']::name[] AND qual='true') THEN
   RAISE EXCEPTION 'seat_ticket_select_policy_drift';
 END IF;
 IF NOT EXISTS(SELECT 1 FROM pg_proc WHERE oid=to_regprocedure('floor_private.floor_table_v3_actor_is_tournament_operator(uuid,uuid)')
   AND md5(replace(prosrc,chr(13),''))='6da977cdcf751746189b2b46a2a563e5'
   AND prosecdef AND proconfig=ARRAY['search_path=""']::text[]) THEN
   RAISE EXCEPTION 'seat_ticket_select_authority_drift';
 END IF;
END $$;
-- RLS callers cannot invoke private helpers. This narrowly exposed boolean
-- derives actor internally, returns false for absent/unauthorized tournaments,
-- and does not grant access to the private helper or expose receipt contents.
CREATE FUNCTION public.can_read_floor_seat_tickets_v1(p_tournament_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT auth.uid() IS NOT NULL AND EXISTS (
   SELECT 1 FROM public.tournaments t WHERE t.id=p_tournament_id
     AND floor_private.floor_table_v3_actor_is_tournament_operator(auth.uid(),t.club_id)
 );
$$;
ALTER FUNCTION public.can_read_floor_seat_tickets_v1(uuid) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.can_read_floor_seat_tickets_v1(uuid) FROM PUBLIC,anon,service_role;
GRANT EXECUTE ON FUNCTION public.can_read_floor_seat_tickets_v1(uuid) TO authenticated;
ALTER POLICY seat_draw_receipts_select_authenticated ON public.seat_draw_receipts
 USING (public.can_read_floor_seat_tickets_v1(tournament_id));
COMMIT;
