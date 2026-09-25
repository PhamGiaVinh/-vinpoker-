-- Internal, read-only source classifier for one Satellite registration.
-- It never derives money from current tournament prices and never writes rows.
-- ROLLBACK: after removing callers, drop private.satellite_registration_pool_row_v1(uuid).

CREATE SCHEMA IF NOT EXISTS private;

CREATE OR REPLACE FUNCTION private.satellite_registration_pool_row_v1(
  p_registration_id uuid
)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_reg public.tournament_registrations%ROWTYPE;
  v_ref public.cashier_refund_requests%ROWTYPE;
  v_snapshot jsonb;
  v_buy_in bigint;
  v_rake bigint;
  v_service_fee bigint;
  v_platform_fee bigint;
  v_waived_rake bigint;
  v_snapshot_total bigint;
  v_paid numeric;
  v_refund_applied numeric;
  v_refund_amount numeric;
  v_refund_count integer;
  v_refund_request_count integer;
  v_registration_refund_count integer;
  v_linked_entry_count integer;
  v_matching_active_entry_count integer;
  v_matching_cancelled_entry_count integer;
BEGIN
  IF p_registration_id IS NULL THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'registration_missing');
  END IF;

  SELECT r.* INTO v_reg
  FROM public.tournament_registrations AS r
  WHERE r.id = p_registration_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'registration_missing');
  END IF;

  v_snapshot := v_reg.price_snapshot;
  IF v_snapshot IS NULL THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'legacy_price_snapshot_missing');
  END IF;
  IF jsonb_typeof(v_snapshot) IS DISTINCT FROM 'object'
     OR coalesce(v_snapshot->>'buy_in', '') !~ '^[0-9]+$'
     OR coalesce(v_snapshot->>'rake', '') !~ '^[0-9]+$'
     OR coalesce(v_snapshot->>'service_fee', '') !~ '^[0-9]+$'
     OR coalesce(v_snapshot->>'platform_fee', '') !~ '^[0-9]+$'
     OR coalesce(v_snapshot->>'waived_rake', '') !~ '^[0-9]+$'
     OR coalesce(v_snapshot->>'total_pay', '') !~ '^[0-9]+$' THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'price_snapshot_invalid');
  END IF;

  BEGIN
    v_buy_in := (v_snapshot->>'buy_in')::bigint;
    v_rake := (v_snapshot->>'rake')::bigint;
    v_service_fee := (v_snapshot->>'service_fee')::bigint;
    v_platform_fee := (v_snapshot->>'platform_fee')::bigint;
    v_waived_rake := (v_snapshot->>'waived_rake')::bigint;
    v_snapshot_total := (v_snapshot->>'total_pay')::bigint;
  EXCEPTION WHEN numeric_value_out_of_range THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'price_snapshot_invalid');
  END;

  IF v_buy_in <= 0 OR v_rake < 0 OR v_service_fee < 0 OR v_platform_fee < 0
     OR v_waived_rake < 0 OR v_reg.total_pay <= 0
     OR v_buy_in IS DISTINCT FROM v_reg.buy_in
     OR v_snapshot_total IS DISTINCT FROM v_reg.total_pay
     OR v_buy_in::numeric + v_rake + v_service_fee + v_platform_fee
          IS DISTINCT FROM v_snapshot_total::numeric THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'price_snapshot_mismatch');
  END IF;

  -- Confirmed/paid markers and the append-only cashier movement ledger must
  -- agree. Overpayment is accepted; underpayment or malformed scope is not.
  -- A fully paid waiting registration can be refunded before seating, so its
  -- cashier-paid marker is required here but confirmed_at is only required by
  -- the READY branch after refund reconciliation.
  IF v_reg.cashier_paid_at IS NULL THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'payment_unconfirmed');
  END IF;
  IF EXISTS (
    SELECT 1
    FROM public.cashier_buyin_movements AS m
    WHERE m.registration_id = v_reg.id
      AND m.purpose = 'buyin'
      AND (m.club_id IS DISTINCT FROM v_reg.club_id
        OR m.tournament_id IS DISTINCT FROM v_reg.tournament_id
        OR m.direction IS DISTINCT FROM 'in')
  ) THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'payment_movement_mismatch');
  END IF;
  SELECT coalesce(sum(m.applied_amount), 0) INTO v_paid
  FROM public.cashier_buyin_movements AS m
  WHERE m.registration_id = v_reg.id
    AND m.purpose = 'buyin'
    AND m.direction = 'in';
  IF v_paid < v_reg.total_pay THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'payment_movement_mismatch');
  END IF;

  SELECT count(*) INTO v_refund_request_count
  FROM public.cashier_refund_requests AS f
  WHERE f.registration_id = v_reg.id;
  SELECT count(*) INTO v_registration_refund_count
  FROM public.cashier_buyin_movements AS m
  WHERE m.registration_id = v_reg.id
    AND (m.purpose = 'refund' OR m.direction = 'out');

  IF v_refund_request_count > 1 THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'refund_request_ambiguous');
  END IF;
  IF v_refund_request_count = 1 THEN
    SELECT f.* INTO v_ref
    FROM public.cashier_refund_requests AS f
    WHERE f.registration_id = v_reg.id;

    IF v_ref.status IS DISTINCT FROM 'paid' OR v_ref.paid_at IS NULL THEN
      RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'refund_unsettled');
    END IF;
    IF v_ref.club_id IS DISTINCT FROM v_reg.club_id
       OR v_ref.tournament_id IS DISTINCT FROM v_reg.tournament_id
       OR v_ref.amount IS DISTINCT FROM v_reg.total_pay
       OR v_reg.status IS DISTINCT FROM 'cancelled'
       OR v_reg.cancelled_at IS NULL
       OR v_reg.cancellation_reason IS DISTINCT FROM ('cashier_refund:' || v_ref.id::text) THEN
      RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'refund_request_mismatch');
    END IF;

    IF EXISTS (
      SELECT 1
      FROM public.cashier_buyin_movements AS m
      WHERE (m.registration_id = v_reg.id
             AND (m.purpose = 'refund' OR m.direction = 'out')
             AND (m.refund_id IS DISTINCT FROM v_ref.id
               OR m.club_id IS DISTINCT FROM v_reg.club_id
               OR m.tournament_id IS DISTINCT FROM v_reg.tournament_id
               OR m.direction IS DISTINCT FROM 'out'
               OR m.purpose IS DISTINCT FROM 'refund'))
         OR (m.refund_id = v_ref.id
             AND (m.registration_id IS DISTINCT FROM v_reg.id
               OR m.club_id IS DISTINCT FROM v_reg.club_id
               OR m.tournament_id IS DISTINCT FROM v_reg.tournament_id
               OR m.direction IS DISTINCT FROM 'out'
               OR m.purpose IS DISTINCT FROM 'refund'))
    ) THEN
      RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'refund_movement_mismatch');
    END IF;
    SELECT coalesce(sum(m.applied_amount), 0), coalesce(sum(m.amount), 0), count(*)
      INTO v_refund_applied, v_refund_amount, v_refund_count
    FROM public.cashier_buyin_movements AS m
    WHERE m.refund_id = v_ref.id
      AND m.registration_id = v_reg.id
      AND m.club_id = v_reg.club_id
      AND m.tournament_id = v_reg.tournament_id
      AND m.direction = 'out'
      AND m.purpose = 'refund';
    IF v_refund_count NOT BETWEEN 1 AND 2
       OR v_refund_applied IS DISTINCT FROM v_reg.total_pay::numeric
       OR v_refund_amount IS DISTINCT FROM v_reg.total_pay::numeric
       OR v_refund_count IS DISTINCT FROM v_registration_refund_count THEN
      RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'refund_movement_mismatch');
    END IF;

    -- The real Cashier completion path cancels the registration and its
    -- registered entry. Keep that immutable entry as evidence of prior allocation.
    SELECT count(*),
           count(*) FILTER (WHERE e.tournament_id = v_reg.tournament_id
                              AND e.player_id = v_reg.player_id
                              AND e.status = 'cancelled'),
           count(*) FILTER (WHERE e.tournament_id = v_reg.tournament_id
                              AND e.player_id = v_reg.player_id
                              AND e.status IS DISTINCT FROM 'cancelled')
      INTO v_linked_entry_count, v_matching_cancelled_entry_count,
           v_matching_active_entry_count
    FROM public.tournament_entries AS e
    WHERE e.registration_id = v_reg.id;
    IF v_linked_entry_count > 1 OR v_matching_active_entry_count <> 0
       OR (v_linked_entry_count = 1 AND v_matching_cancelled_entry_count <> 1)
       OR (v_linked_entry_count = 0 AND v_matching_cancelled_entry_count <> 0) THEN
      RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'refund_entry_evidence_missing');
    END IF;
    IF EXISTS (
      SELECT 1
      FROM public.tournament_seats AS s
      JOIN public.tournament_entries AS e ON e.id = s.entry_id
      WHERE e.registration_id = v_reg.id
        AND (s.is_active OR s.chip_count <> 0)
    ) THEN
      RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'refund_seat_not_cleared');
    END IF;
    RETURN jsonb_build_object('state', 'REVERSED', 'reason', 'full_refund_reconciled');
  END IF;

  IF v_registration_refund_count > 0 THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'refund_without_request');
  END IF;
  IF v_reg.confirmed_at IS NULL THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'payment_unconfirmed');
  END IF;
  IF v_reg.status IS DISTINCT FROM 'confirmed' THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'registration_not_confirmed');
  END IF;

  SELECT count(*) INTO v_linked_entry_count
  FROM public.tournament_entries AS e
  WHERE e.registration_id = v_reg.id;
  SELECT count(*) INTO v_matching_active_entry_count
  FROM public.tournament_entries AS e
  WHERE e.registration_id = v_reg.id
    AND e.tournament_id = v_reg.tournament_id
    AND e.player_id = v_reg.player_id
    AND e.status IS DISTINCT FROM 'cancelled';
  IF v_linked_entry_count <> 1 OR v_matching_active_entry_count <> 1 THEN
    RETURN jsonb_build_object('state', 'NOT_READY', 'reason', 'entry_cardinality_mismatch');
  END IF;

  RETURN jsonb_build_object(
    'state', 'READY',
    'registration_id', v_reg.id,
    'tournament_id', v_reg.tournament_id,
    'player_id', v_reg.player_id,
    'buy_in_vnd', v_buy_in::text,
    'fee_vnd', (v_rake::numeric + v_service_fee + v_platform_fee)::text
  );
END;
$$;

REVOKE ALL ON FUNCTION private.satellite_registration_pool_row_v1(uuid)
  FROM PUBLIC, anon, authenticated, service_role;
