-- Forward-only correction for source-attributable Cashier movements that have
-- no reconcilable registration. Keep late/unmatched money in its ledger; never
-- classify it as a paid Satellite entry or let an award Lock silently omit it.
-- ROLLBACK: revoke the preview/Lock RPCs in a forward migration. Retain all
-- movement rows and investigate each unmatched receipt; do not delete ledger.

CREATE OR REPLACE FUNCTION private.satellite_reject_orphan_movement_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  IF NEW.purpose IN ('buyin','refund') AND NEW.registration_id IS NULL THEN
    RAISE EXCEPTION 'satellite_funding_movement_registration_required'
      USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END $$;
REVOKE ALL ON FUNCTION private.satellite_reject_orphan_movement_v1()
  FROM PUBLIC,anon,authenticated,service_role;
DROP TRIGGER IF EXISTS satellite_reject_orphan_movement_v1
  ON public.cashier_buyin_movements;
CREATE TRIGGER satellite_reject_orphan_movement_v1 BEFORE INSERT
  ON public.cashier_buyin_movements FOR EACH ROW
  EXECUTE FUNCTION private.satellite_reject_orphan_movement_v1();

-- This is the same funding-only v2 projection with one additional read of
-- source-attributable orphan/mismatched movements. It deliberately preserves
-- the v2 RPC signature because atomic Lock rechecks this function at commit.
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
  v_unmatched jsonb;
  v_unmatched_count integer;
  v_late_unmatched_count integer;
  v_revision text;
  v_late_count bigint;
BEGIN
  v_preview := public.satellite_source_funding_preview_v1(
    p_source_tournament_id,p_target_tournament_id,p_awards);
  SELECT * INTO v_source FROM public.tournaments WHERE id=p_source_tournament_id;
  SELECT * INTO v_target FROM public.tournaments WHERE id=p_target_tournament_id;

  -- Attribute by any real source link. A movement whose tournament points at
  -- this source but whose registration points elsewhere invalidates both sides
  -- rather than being silently included in either pool.
  SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_build_object(
    'movementId',m.id,'reason','funding_movement_unmatched') ORDER BY m.id),'[]'::jsonb),
    count(*)::integer,
    count(*) FILTER (WHERE m.satellite_funding_phase='late')::integer
    INTO v_unmatched,v_unmatched_count,v_late_unmatched_count
  FROM public.cashier_buyin_movements m
  LEFT JOIN public.tournament_registrations r ON r.id=m.registration_id
  LEFT JOIN public.cashier_refund_requests f ON f.id=m.refund_id
  WHERE m.purpose IN ('buyin','refund')
    AND (m.tournament_id=p_source_tournament_id
      OR r.tournament_id=p_source_tournament_id
      OR f.tournament_id=p_source_tournament_id)
    AND (m.registration_id IS NULL OR r.id IS NULL
      OR m.tournament_id IS DISTINCT FROM r.tournament_id
      OR m.club_id IS DISTINCT FROM r.club_id
      OR (m.purpose='refund' AND (f.id IS NULL
        OR f.registration_id IS DISTINCT FROM r.id
        OR f.tournament_id IS DISTINCT FROM r.tournament_id)));
  IF v_unmatched_count>0 THEN
    v_preview := v_preview || pg_catalog.jsonb_build_object(
      'state','NOT_READY','reason','SOURCE_MOVEMENT_UNMATCHED',
      'sourcePoolVnd',NULL,'feeVnd',NULL,
      'issues',coalesce(v_preview->'issues','[]'::jsonb) || v_unmatched);
  END IF;

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
    'unmatched',v_unmatched,
    'state',v_preview->>'state','pool',v_preview->>'sourcePoolVnd',
    'fee',v_preview->>'feeVnd','shortfall',v_preview->>'obligationShortfallVnd'
  )::text);
  v_preview := v_preview || pg_catalog.jsonb_build_object(
    'previewRevision',v_revision,'lateReceiptCount',v_late_count,
    'unmatchedMovementCount',v_unmatched_count,
    'lateUnmatchedMovementCount',v_late_unmatched_count);
  IF v_source.registration_closed_at IS NOT NULL
     AND v_source.satellite_cutoff_fenced_at IS NULL THEN
    RETURN v_preview || pg_catalog.jsonb_build_object(
      'state','NOT_READY','reason','SOURCE_CUTOFF_UNFENCED',
      'sourcePoolVnd',NULL,'feeVnd',NULL);
  END IF;
  RETURN v_preview;
END $$;
REVOKE ALL ON FUNCTION public.satellite_source_funding_preview_v2(uuid,uuid,jsonb)
  FROM PUBLIC,anon,authenticated,service_role;
GRANT EXECUTE ON FUNCTION public.satellite_source_funding_preview_v2(uuid,uuid,jsonb)
  TO authenticated;
