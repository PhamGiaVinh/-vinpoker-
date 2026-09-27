-- Satellite source cutoff fence. PENDING SOURCE ONLY; apply after #1335.
-- Does not open award Lock or Issue. The source snapshot and Lock RPC follow
-- only after this write-order contract passes disposable concurrency tests.
-- ROLLBACK: replace these triggers in a forward migration. Keep every
-- registration, refund and append-only Cashier movement as audit history.

-- A movement recorded after registration closes is retained, never silently
-- rewritten into pre-cutoff funding. Historical NULLs are not backfilled by
-- timestamp: a past transaction's commit order cannot be inferred from now().
ALTER TABLE public.cashier_buyin_movements
  ADD COLUMN IF NOT EXISTS satellite_funding_phase text;
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS satellite_cutoff_fenced_at timestamptz;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_catalog.pg_constraint
    WHERE conrelid='public.cashier_buyin_movements'::pg_catalog.regclass
      AND conname='cashier_satellite_funding_phase_v1') THEN
    ALTER TABLE public.cashier_buyin_movements
      ADD CONSTRAINT cashier_satellite_funding_phase_v1
      CHECK (satellite_funding_phase IS NULL OR satellite_funding_phase IN ('open','late'));
  END IF;
END $$;

CREATE OR REPLACE FUNCTION private.satellite_mode_source_guard_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF OLD.operations_mode='satellite' THEN
    IF OLD.registration_closed_at IS NOT NULL
       AND NEW.registration_closed_at IS DISTINCT FROM OLD.registration_closed_at THEN
      RAISE EXCEPTION 'satellite_cutoff_immutable' USING ERRCODE='23514';
    END IF;
    IF NEW.satellite_cutoff_fenced_at IS DISTINCT FROM OLD.satellite_cutoff_fenced_at THEN
      RAISE EXCEPTION 'satellite_cutoff_marker_server_owned' USING ERRCODE='23514';
    END IF;
    IF OLD.registration_closed_at IS NULL AND NEW.registration_closed_at IS NOT NULL THEN
      NEW.satellite_cutoff_fenced_at := pg_catalog.clock_timestamp();
    END IF;
  END IF;
  IF OLD.operations_mode IS DISTINCT FROM NEW.operations_mode
     AND (OLD.operations_mode='satellite' OR NEW.operations_mode='satellite')
     AND (EXISTS (SELECT 1 FROM public.tournament_registrations r WHERE r.tournament_id=OLD.id)
       OR EXISTS (SELECT 1 FROM public.cashier_buyin_movements m WHERE m.tournament_id=OLD.id)
       OR EXISTS (SELECT 1 FROM public.cashier_refund_requests f WHERE f.tournament_id=OLD.id)) THEN
    RAISE EXCEPTION 'satellite_mode_fixed_after_source' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_mode_source_guard_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_mode_source_guard_v1 ON public.tournaments;
CREATE TRIGGER satellite_mode_source_guard_v1 BEFORE UPDATE
  ON public.tournaments FOR EACH ROW
  EXECUTE FUNCTION private.satellite_mode_source_guard_v1();

CREATE OR REPLACE FUNCTION private.satellite_registration_cutoff_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tour public.tournaments%ROWTYPE;
  v_mode text;
BEGIN
  IF TG_OP = 'INSERT' THEN
    -- INSERT has no old registration row. This lock also serializes a concurrent
    -- standard->Satellite mode change with the first registration, including
    -- direct RLS and service-role Edge inserts. It is not a Floor entry lock.
    SELECT * INTO v_tour FROM public.tournaments
      WHERE id=NEW.tournament_id FOR SHARE;
  ELSE
    -- An existing registration prevents mode switching, so non-Satellite
    -- updates can leave without taking any tournament-row lock.
    SELECT operations_mode INTO v_mode FROM public.tournaments
      WHERE id=OLD.tournament_id;
    IF v_mode IS DISTINCT FROM 'satellite' THEN
      IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
      RETURN NEW;
    END IF;
    SELECT * INTO v_tour FROM public.tournaments
      WHERE id=OLD.tournament_id FOR SHARE;
  END IF;
  IF v_tour.operations_mode IS DISTINCT FROM 'satellite' THEN
    IF TG_OP = 'DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF TG_OP = 'DELETE' THEN
    RAISE EXCEPTION 'satellite_registration_history_immutable' USING ERRCODE='23514';
  END IF;
  IF TG_OP = 'INSERT' THEN
    IF v_tour.registration_closed_at IS NOT NULL
       OR EXISTS (SELECT 1 FROM public.satellite_award_plans p WHERE p.source_tournament_id=v_tour.id) THEN
      RAISE EXCEPTION 'satellite_registration_cutoff_closed' USING ERRCODE='23514';
    END IF;
    RETURN NEW;
  END IF;
  IF v_tour.registration_closed_at IS NOT NULL
     AND (ROW(NEW.tournament_id,NEW.player_id,NEW.club_id,NEW.buy_in,
              NEW.platform_fixed_fee,NEW.total_pay,NEW.reference_code,
              NEW.price_snapshot,NEW.cashier_paid_at,NEW.confirmed_at,NEW.confirmed_by)
          IS DISTINCT FROM
          ROW(OLD.tournament_id,OLD.player_id,OLD.club_id,OLD.buy_in,
              OLD.platform_fixed_fee,OLD.total_pay,OLD.reference_code,
              OLD.price_snapshot,OLD.cashier_paid_at,OLD.confirmed_at,OLD.confirmed_by)
       OR (NEW.status IS DISTINCT FROM OLD.status
           AND NOT (OLD.status IN ('pending','confirmed') AND NEW.status='cancelled'
                    AND NOT EXISTS (SELECT 1 FROM public.satellite_award_plans p
                                    WHERE p.source_tournament_id=OLD.tournament_id)))) THEN
    RAISE EXCEPTION 'satellite_registration_cutoff_frozen' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_registration_cutoff_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_registration_cutoff_v1 ON public.tournament_registrations;
CREATE TRIGGER satellite_registration_cutoff_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.tournament_registrations FOR EACH ROW
  EXECUTE FUNCTION private.satellite_registration_cutoff_v1();

CREATE OR REPLACE FUNCTION private.satellite_cashier_movement_phase_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_tour public.tournaments%ROWTYPE;
  v_reg_tour uuid;
BEGIN
  IF NEW.registration_id IS NULL THEN
    NEW.satellite_funding_phase := NULL;
    RETURN NEW; -- drawer adjustment, never a source buy-in/refund
  END IF;
  SELECT r.tournament_id INTO v_reg_tour FROM public.tournament_registrations r
    WHERE r.id=NEW.registration_id;
  IF v_reg_tour IS NULL OR NEW.tournament_id IS DISTINCT FROM v_reg_tour THEN
    RAISE EXCEPTION 'satellite_movement_registration_scope_invalid' USING ERRCODE='23514';
  END IF;
  SELECT * INTO v_tour FROM public.tournaments WHERE id=v_reg_tour FOR SHARE;
  IF v_tour.operations_mode IS DISTINCT FROM 'satellite' THEN
    NEW.satellite_funding_phase := NULL;
    RETURN NEW;
  END IF;
  IF NEW.purpose='refund' AND EXISTS (
    SELECT 1 FROM public.satellite_award_plans p WHERE p.source_tournament_id=v_tour.id) THEN
    RAISE EXCEPTION 'satellite_refund_after_lock_requires_adjustment' USING ERRCODE='23514';
  END IF;
  NEW.satellite_funding_phase := CASE
    WHEN v_tour.registration_closed_at IS NULL THEN 'open' ELSE 'late' END;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_cashier_movement_phase_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_cashier_movement_phase_v1 ON public.cashier_buyin_movements;
CREATE TRIGGER satellite_cashier_movement_phase_v1 BEFORE INSERT
  ON public.cashier_buyin_movements FOR EACH ROW
  EXECUTE FUNCTION private.satellite_cashier_movement_phase_v1();

CREATE OR REPLACE FUNCTION private.satellite_refund_cutoff_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE v_tour public.tournaments%ROWTYPE;
BEGIN
  SELECT * INTO v_tour FROM public.tournaments
    WHERE id=CASE WHEN TG_OP='DELETE' THEN OLD.tournament_id ELSE NEW.tournament_id END
    FOR SHARE;
  IF v_tour.operations_mode IS DISTINCT FROM 'satellite' THEN
    IF TG_OP='DELETE' THEN RETURN OLD; END IF;
    RETURN NEW;
  END IF;
  IF EXISTS (SELECT 1 FROM public.satellite_award_plans p
             WHERE p.source_tournament_id=v_tour.id) THEN
    RAISE EXCEPTION 'satellite_refund_after_lock_requires_adjustment' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN
    RAISE EXCEPTION 'satellite_refund_history_immutable' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_refund_cutoff_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_refund_cutoff_v1 ON public.cashier_refund_requests;
CREATE TRIGGER satellite_refund_cutoff_v1 BEFORE INSERT OR UPDATE OR DELETE
  ON public.cashier_refund_requests FOR EACH ROW
  EXECUTE FUNCTION private.satellite_refund_cutoff_v1();

-- V1's revision included complete seat/chip and Floor rows. Those are live
-- operations, not funding. V2 retains V1's server classifier/math/authority,
-- but hashes only funding and entry-eligibility evidence. No client totals.
CREATE OR REPLACE FUNCTION public.satellite_source_funding_preview_v2(
  p_source_tournament_id uuid, p_target_tournament_id uuid, p_awards jsonb
) RETURNS jsonb LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
DECLARE
  v_preview jsonb;
  v_source public.tournaments%ROWTYPE;
  v_target public.tournaments%ROWTYPE;
  v_regs jsonb;
  v_movements jsonb;
  v_refunds jsonb;
  v_entries jsonb;
  v_revision text;
  v_late_count bigint;
BEGIN
  -- This call owns actor/club checks and source/target row locks. Cashier
  -- registration-first writers either committed before the locks or wait and
  -- then observe the cutoff. No registration row is locked by this preview.
  v_preview := public.satellite_source_funding_preview_v1(
    p_source_tournament_id,p_target_tournament_id,p_awards);
  SELECT * INTO v_source FROM public.tournaments WHERE id=p_source_tournament_id;
  SELECT * INTO v_target FROM public.tournaments WHERE id=p_target_tournament_id;
  SELECT coalesce(pg_catalog.jsonb_agg(
    CASE WHEN c.row->>'state'='NOT_READY' AND c.row->>'reason'='payment_unconfirmed'
      AND r.cashier_paid_at IS NULL AND r.confirmed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.cashier_buyin_movements m WHERE m.registration_id=r.id)
      AND NOT EXISTS (SELECT 1 FROM public.cashier_refund_requests f WHERE f.registration_id=r.id)
      AND NOT EXISTS (SELECT 1 FROM public.tournament_entries e WHERE e.registration_id=r.id)
    THEN pg_catalog.jsonb_build_object('id',r.id,'state','UNPAID_ATTEMPT')
    ELSE pg_catalog.jsonb_build_object(
      'id',r.id,'player',r.player_id,'club',r.club_id,'tour',r.tournament_id,
      'status',r.status,'buyIn',r.buy_in,'totalPay',r.total_pay,
      'snapshot',r.price_snapshot,'cashierPaidAt',r.cashier_paid_at,
      'confirmedAt',r.confirmed_at,'cancelledAt',r.cancelled_at,
      'cancellationReason',r.cancellation_reason,
      'state',c.row->>'state','reason',c.row->>'reason',
      'pool',c.row->>'buy_in_vnd','fee',c.row->>'fee_vnd') END
    ORDER BY r.id),'[]'::jsonb) INTO v_regs
  FROM public.tournament_registrations r
  CROSS JOIN LATERAL (SELECT private.satellite_registration_pool_row_v1(r.id) AS row) c
  WHERE r.tournament_id=p_source_tournament_id;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',m.id,'registration',m.registration_id,'refund',m.refund_id,
    'purpose',m.purpose,'direction',m.direction,'amount',m.amount,
    'applied',m.applied_amount,'phase',m.satellite_funding_phase)
    ORDER BY m.id),'[]'::jsonb) INTO v_movements
  FROM public.cashier_buyin_movements m
  WHERE m.tournament_id=p_source_tournament_id
    AND m.purpose IN ('buyin','refund')
    AND m.satellite_funding_phase IS DISTINCT FROM 'late';
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',f.id,'registration',f.registration_id,'amount',f.amount,
    'status',f.status,'paidAt',f.paid_at) ORDER BY f.id),'[]'::jsonb)
    INTO v_refunds FROM public.cashier_refund_requests f
    WHERE f.tournament_id=p_source_tournament_id;
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'id',e.id,'registration',e.registration_id,'player',e.player_id,
    'tour',e.tournament_id,'cancelled',e.status='cancelled') ORDER BY e.id),'[]'::jsonb)
    INTO v_entries FROM public.tournament_entries e
    WHERE e.registration_id IN (SELECT r.id FROM public.tournament_registrations r
                                WHERE r.tournament_id=p_source_tournament_id);
  SELECT count(*) INTO v_late_count FROM public.cashier_buyin_movements m
    WHERE m.tournament_id=p_source_tournament_id
      AND m.satellite_funding_phase='late' AND m.purpose IN ('buyin','refund');
  v_revision := 'v2:' || pg_catalog.md5(pg_catalog.jsonb_build_object(
    'source',pg_catalog.jsonb_build_object('id',v_source.id,'club',v_source.club_id,
      'mode',v_source.operations_mode,'closedAt',v_source.registration_closed_at,
      'fencedAt',v_source.satellite_cutoff_fenced_at,'status',v_source.status),
    'target',pg_catalog.jsonb_build_object('id',v_target.id,'club',v_target.club_id,
      'buyIn',v_target.buy_in,'rake',v_target.rake_amount,
      'serviceFee',v_target.service_fee_amount,'status',v_target.status,
      'registrationClosedAt',v_target.registration_closed_at),
    'awards',v_preview->'awardPlan'->'awardLines','registrations',v_regs,
    'movements',v_movements,'refunds',v_refunds,'entries',v_entries,
    'state',v_preview->>'state','pool',v_preview->>'sourcePoolVnd',
    'fee',v_preview->>'feeVnd','shortfall',v_preview->>'obligationShortfallVnd'
  )::text);
  v_preview := v_preview || pg_catalog.jsonb_build_object(
    'previewRevision',v_revision,'lateReceiptCount',v_late_count);
  IF v_source.registration_closed_at IS NOT NULL
     AND v_source.satellite_cutoff_fenced_at IS NULL THEN
    RETURN v_preview || pg_catalog.jsonb_build_object(
      'state','NOT_READY','reason','SOURCE_CUTOFF_UNFENCED');
  END IF;
  RETURN v_preview;
END $$;
REVOKE ALL ON FUNCTION public.satellite_source_funding_preview_v2(uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_source_funding_preview_v2(uuid,uuid,jsonb)
  TO authenticated;
