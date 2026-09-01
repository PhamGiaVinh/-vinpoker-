-- ============================================================================
-- Floor Table Control V3 — stale fixture live-status compatibility (RED)
-- ============================================================================
-- Runs before the final V3 bridge. A historical validation trigger allows
-- only registering/playing/finished, while the exact stale STAGE_TEST fixture
-- predates that trigger with live_status = running. The final bridge already
-- quarantines this fixture; this compatibility step only makes that UPDATE
-- valid. It never touches a live operational tournament.
--
-- ROLLBACK: no automated rollback. The only changed row is the exact stale
-- fixture below and it is immediately quarantined by 20270113000010. Restore
-- from the approved physical backup if a full production rollback is needed.
-- ============================================================================

BEGIN;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1
    FROM public.tournaments t
    WHERE t.id = '11111111-1111-1111-1111-111111111111'::uuid
      AND t.deleted_at IS NULL
      AND t.status = 'active'
      AND t.live_status IN ('running', 'registering')
  ) THEN
    RAISE EXCEPTION USING
      ERRCODE = 'P0001',
      MESSAGE = 'floor_table_v3_fixture_live_status_preflight_failed';
  END IF;
END;
$$;

UPDATE public.tournaments
SET live_status = 'registering'
WHERE id = '11111111-1111-1111-1111-111111111111'::uuid
  AND deleted_at IS NULL
  AND status = 'active'
  AND live_status = 'running';

COMMIT;
