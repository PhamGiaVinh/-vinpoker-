-- ============================================================================
-- Source↔live alignment — revoke PUBLIC/anon EXECUTE on create_offline_buyin_and_seat
-- ============================================================================
-- The function (20260826000003, merged via #121) was applied live in a controlled
-- session, then PUBLIC/anon EXECUTE was revoked live (least-privilege, matching the
-- confirm_registration_and_assign_seat P0 guard). But the merged #121 file did NOT
-- contain the REVOKE, so a future `db push` would CREATE OR REPLACE the function and
-- silently re-grant EXECUTE to PUBLIC (Postgres default). This fix-forward migration
-- runs AFTER 000003 in version order and re-revokes, so source == live and any future
-- db push ends in the hardened state. Idempotent. SOURCE-ONLY (live already matches).
-- ============================================================================

REVOKE EXECUTE ON FUNCTION public.create_offline_buyin_and_seat(UUID, TEXT, BIGINT, BIGINT, TEXT) FROM PUBLIC;
REVOKE EXECUTE ON FUNCTION public.create_offline_buyin_and_seat(UUID, TEXT, BIGINT, BIGINT, TEXT) FROM anon;
GRANT  EXECUTE ON FUNCTION public.create_offline_buyin_and_seat(UUID, TEXT, BIGINT, BIGINT, TEXT) TO authenticated;
