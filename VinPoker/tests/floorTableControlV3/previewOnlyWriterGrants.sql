-- ============================================================================
-- Floor Table Control V3 — Preview/disposable-only authenticated writer grants
-- ============================================================================
-- Depends on: 20270113000011_floor_table_control_v3_final_contract.sql
--
-- This file is deliberately outside supabase/migrations and must never be
-- applied to production. It exists only for the disposable database suite and
-- an explicitly owner-gated Preview bootstrap after a safe Preview project has
-- been verified. The active migration catalog keeps all V3 writer EXECUTE
-- grants revoked, so a frontend feature flag cannot become a production
-- authorization bypass. The grants below are exact; no table grants, schema
-- grants, generic RPC grants, or service credentials are introduced. Every
-- function remains caller-bound and SECURITY DEFINER with a fixed search_path.
--
-- ROLLBACK (owner-gated): REVOKE these exact signatures FROM authenticated.
-- ============================================================================

BEGIN;

REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.operator_open_club_tables_v2(uuid[], text, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.operator_close_club_table_v2(uuid, bigint, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.validate_tracker_table_writer_context_v3(uuid, uuid, uuid, bigint)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_assign_entry_to_seat(uuid, uuid, integer, bigint, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_set_table_control_mode_v3(uuid, text, bigint, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.move_player_seat_v2(uuid, uuid, integer, bigint, bigint, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.close_tournament_table_v3(uuid, bigint, uuid)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_bust_player_v3(uuid, bigint, bigint, integer, uuid, text)
  FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid, uuid, integer, bigint, bigint, uuid)
  FROM PUBLIC, anon, service_role;

GRANT EXECUTE ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_open_club_tables_v2(uuid[], text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.operator_close_club_table_v2(uuid, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.validate_tracker_table_writer_context_v3(uuid, uuid, uuid, bigint) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_assign_entry_to_seat(uuid, uuid, integer, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_set_table_control_mode_v3(uuid, text, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.move_player_seat_v2(uuid, uuid, integer, bigint, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.close_tournament_table_v3(uuid, bigint, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_bust_player_v3(uuid, bigint, bigint, integer, uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) TO authenticated;

COMMIT;
