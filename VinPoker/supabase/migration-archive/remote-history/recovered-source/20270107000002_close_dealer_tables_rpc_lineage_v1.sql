-- Canonical Phase 1 adoption for the Dealer Swing guarded phone close RPC.
--
-- Historical source establishes the two existing close_dealer_tables overloads:
--   public.close_dealer_tables(uuid, uuid, uuid[])
--   public.close_dealer_tables(uuid, uuid, uuid, uuid[], jsonb, boolean)
-- Neither historical migration is recorded in the production migration ledger,
-- although the reviewed live catalog has semantic parity with that source. This
-- forward-only migration does not repair or insert historical ledger entries.
--
-- Production rollout evidence shows the phone runtime is enabled for an
-- allowlisted club. Therefore this is a compatibility Phase 1: it preserves both
-- existing overloads and gives the guarded phone contract a distinct RPC name.
-- Phase 2 may drop only the six-argument legacy compatibility overload after a
-- separate no-consumer proof, frontend deployment, and authenticated UAT.
--
-- No DML against operational Dealer Swing tables. No request history rewrite.
-- Owner-controlled apply only; this file is source-only until that gate opens.

BEGIN;

DO $$
BEGIN
  IF to_regprocedure('public.close_dealer_tables(uuid,uuid,uuid[])') IS NULL THEN
    RAISE EXCEPTION 'close_dealer_tables RPC lineage requires the desktop legacy function';
  END IF;

  IF to_regprocedure('public.close_dealer_tables(uuid,uuid,uuid,uuid[],jsonb,boolean)') IS NULL THEN
    RAISE EXCEPTION 'close_dealer_tables RPC lineage requires the guarded compatibility function';
  END IF;

  IF to_regprocedure('public._dealer_swing_phone_actor_allowed(uuid,uuid)') IS NULL THEN
    RAISE EXCEPTION 'close_dealer_tables RPC lineage requires the phone actor authorization helper';
  END IF;

  IF to_regclass('public.dealer_phone_close_requests') IS NULL THEN
    RAISE EXCEPTION 'close_dealer_tables RPC lineage requires the phone request history table';
  END IF;

  IF to_regclass('public.dealer_swing_phone_rollout') IS NULL THEN
    RAISE EXCEPTION 'close_dealer_tables RPC lineage requires the phone rollout gate';
  END IF;
END;
$$;

-- The existing request history is retained unchanged. These statements make the
-- security boundary explicit in this reviewed adoption migration without
-- granting a caller direct table access.
ALTER TABLE public.dealer_phone_close_requests ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_phone_close_requests FROM PUBLIC, anon, authenticated;

-- Do not duplicate the guarded CAS implementation. The compatibility overload
-- remains the single reviewed implementation during Phase 1, so dry-run,
-- authorization, rollout gating, deterministic locks, expected-state checking,
-- idempotency, audit behavior, and the legacy desktop delegation stay identical.
CREATE OR REPLACE FUNCTION public.close_dealer_tables_phone_v1(
  p_request_id uuid,
  p_expected_club_id uuid,
  p_shift_id uuid,
  p_table_ids uuid[],
  p_expected_state jsonb DEFAULT NULL,
  p_dry_run boolean DEFAULT true
)
RETURNS jsonb
LANGUAGE plpgsql
VOLATILE
SECURITY DEFINER
SET search_path = pg_catalog, public, extensions
AS $$
BEGIN
  RETURN public.close_dealer_tables(
    p_request_id,
    p_expected_club_id,
    p_shift_id,
    p_table_ids,
    p_expected_state,
    p_dry_run
  );
END;
$$;

ALTER FUNCTION public.close_dealer_tables_phone_v1(uuid, uuid, uuid, uuid[], jsonb, boolean) OWNER TO postgres;
REVOKE ALL ON FUNCTION public.close_dealer_tables_phone_v1(uuid, uuid, uuid, uuid[], jsonb, boolean)
  FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.close_dealer_tables_phone_v1(uuid, uuid, uuid, uuid[], jsonb, boolean)
  TO authenticated;

COMMENT ON FUNCTION public.close_dealer_tables(uuid, uuid, uuid[]) IS
  'Dealer Swing desktop close-table API. Preserved by 20270107000002; do not change this signature in Phase 1.';
COMMENT ON FUNCTION public.close_dealer_tables(uuid, uuid, uuid, uuid[], jsonb, boolean) IS
  'Deprecated guarded phone compatibility overload. Preserve through Phase 1; Phase 2 may drop only after an explicit no-consumer proof.';
COMMENT ON FUNCTION public.close_dealer_tables_phone_v1(uuid, uuid, uuid, uuid[], jsonb, boolean) IS
  'Canonical guarded Dealer Swing phone close API v1. Delegates to the reviewed Phase 1 compatibility implementation to preserve CAS semantics.';
COMMENT ON TABLE public.dealer_phone_close_requests IS
  'Internal idempotency store for guarded Dealer Swing phone close-table operations. Retained unchanged by RPC lineage Phase 1.';

NOTIFY pgrst, 'reload schema';

COMMIT;

-- Forward-only rollback runbook: first disable the phone runtime gate, deploy a
-- frontend rollback if the client already calls v1, revoke authenticated execute
-- on close_dealer_tables_phone_v1, then drop only that new v1 function. Never
-- repair historical ledger entries and never drop either close_dealer_tables
-- overload in this Phase 1 rollback.
