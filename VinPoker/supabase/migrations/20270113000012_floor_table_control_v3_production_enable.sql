-- Floor Table Control V3 — Production authenticated writer enablement
--
-- This forward-only migration changes only EXECUTE ACLs for the exact V3
-- writer surface. Each function remains SECURITY DEFINER, caller-bound to
-- auth.uid(), and enforces club/tournament scope, revision/epoch fencing and
-- durable idempotency inside its existing body.
--
-- Emergency rollback (do not edit migration history): revoke precisely these
-- eleven signatures from authenticated, then redeploy a frontend build whose
-- VITE_FLOOR_TABLE_CONTROL_V3 and VITE_FLOOR_UAT_ENV do not both equal
-- "production".
--
-- REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.operator_open_club_tables_v2(uuid[], text, uuid) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.operator_close_club_table_v2(uuid, bigint, uuid) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.validate_tracker_table_writer_context_v3(uuid, uuid, uuid, bigint) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.floor_assign_entry_to_seat(uuid, uuid, integer, bigint, uuid) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.floor_set_table_control_mode_v3(uuid, text, bigint, uuid) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.move_player_seat_v2(uuid, uuid, integer, bigint, bigint, uuid) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.close_tournament_table_v3(uuid, bigint, uuid) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.floor_bust_player_v3(uuid, bigint, bigint, integer, uuid, text) FROM authenticated;
-- REVOKE ALL ON FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) FROM authenticated;

BEGIN;

REVOKE ALL ON FUNCTION public.floor_open_tournament_table_v3(uuid, uuid, text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.operator_open_club_tables_v2(uuid[], text, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.operator_close_club_table_v2(uuid, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.validate_tracker_table_writer_context_v3(uuid, uuid, uuid, bigint) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_assign_entry_to_seat(uuid, uuid, integer, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_set_table_control_mode_v3(uuid, text, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.move_player_seat_v2(uuid, uuid, integer, bigint, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.close_tournament_table_v3(uuid, bigint, uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_break_table_v3(uuid, bigint, uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_bust_player_v3(uuid, bigint, bigint, integer, uuid, text) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.floor_restore_busted_player_to_seat_v3(uuid, uuid, integer, bigint, bigint, uuid) FROM PUBLIC, anon, service_role;

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
