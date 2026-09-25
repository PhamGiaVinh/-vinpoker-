-- Read-only Satellite funding preview, applied after the Cashier tour migration,
-- award-plan v1/v2, ticket issue v1, the Centerpoint release gate, #1318 math,
-- and the #1332 registration classifier. PENDING SOURCE ONLY.
-- A preview revision is evidence of the read, not a lock or a funded overlay.
-- Lock/issue writes remain blocked even if the shared release gate is enabled:
-- Cashier registration-first writers and the tournament-first award lock still
-- need an atomic source-revision check and a reviewed lock-order contract.
-- ROLLBACK: revoke preview EXECUTE in a forward migration. Keep any historical
-- award and ticket rows; remove these write-hold triggers only after a reviewed
-- atomic funding/lock/issue replacement has been applied.

CREATE OR REPLACE FUNCTION public.satellite_source_funding_preview_v1(
  p_source_tournament_id uuid,
  p_target_tournament_id uuid,
  p_awards jsonb
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_plan jsonb;
  v_source public.tournaments%ROWTYPE;
  v_target public.tournaments%ROWTYPE;
  v_reg public.tournament_registrations%ROWTYPE;
  v_row jsonb;
  v_issues jsonb := '[]'::jsonb;
  v_pool numeric := 0;
  v_fee numeric := 0;
  v_confirmed_count integer := 0;
  v_unpaid_count integer := 0;
  v_reversed_count integer := 0;
  v_ready_players uuid[] := ARRAY[]::uuid[];
  v_award_ranks integer;
  v_ticket_value numeric;
  v_liability numeric;
  v_math record;
  v_revision text;
BEGIN
  -- The existing server RPC validates actor/club, target price and every TD
  -- award line. p_lock=false inserts nothing; it takes its existing tournament
  -- row locks so target economics cannot change during this one preview call.
  v_plan := public.satellite_award_plan_v2(
    p_source_tournament_id, p_target_tournament_id, p_awards, false
  );
  SELECT * INTO v_source FROM public.tournaments
    WHERE id = p_source_tournament_id;
  SELECT * INTO v_target FROM public.tournaments
    WHERE id = p_target_tournament_id;
  v_award_ranks := pg_catalog.jsonb_array_length(v_plan->'awardLines');
  v_ticket_value := (v_plan->>'targetEntryPriceVnd')::numeric;
  v_liability := (v_plan->>'totalLiabilityVnd')::numeric;

  FOR v_reg IN SELECT * FROM public.tournament_registrations
    WHERE tournament_id = p_source_tournament_id ORDER BY id
  LOOP
    v_row := private.satellite_registration_pool_row_v1(v_reg.id);
    IF v_row->>'state' = 'READY' THEN
      v_pool := v_pool + (v_row->>'buy_in_vnd')::numeric;
      v_fee := v_fee + (v_row->>'fee_vnd')::numeric;
      v_confirmed_count := v_confirmed_count + 1;
      IF NOT v_reg.player_id = ANY(v_ready_players) THEN
        v_ready_players := pg_catalog.array_append(v_ready_players, v_reg.player_id);
      END IF;
    ELSIF v_row->>'state' = 'REVERSED' THEN
      v_reversed_count := v_reversed_count + 1;
    ELSIF v_row->>'state' = 'NOT_READY'
      AND v_row->>'reason' = 'payment_unconfirmed'
      AND v_reg.status IN ('pending', 'cancelled')
      AND v_reg.cashier_paid_at IS NULL
      AND v_reg.confirmed_at IS NULL
      AND NOT EXISTS (SELECT 1 FROM public.cashier_buyin_movements m
                      WHERE m.registration_id = v_reg.id)
      AND NOT EXISTS (SELECT 1 FROM public.cashier_refund_requests f
                      WHERE f.registration_id = v_reg.id)
      AND NOT EXISTS (SELECT 1 FROM public.tournament_entries e
                      WHERE e.registration_id = v_reg.id) THEN
      v_unpaid_count := v_unpaid_count + 1;
    ELSE
      v_issues := v_issues || pg_catalog.jsonb_build_array(
        pg_catalog.jsonb_build_object(
          'registrationId', v_reg.id,
          'reason', coalesce(v_row->>'reason', 'classifier_result_invalid')
        )
      );
    END IF;
  END LOOP;

  -- The revision covers all monetary and seat evidence, not only the derived
  -- total. It changes when an overpayment, refund, seat or target price changes.
  -- It is diagnostic; READ COMMITTED freshness is not a lock guarantee.
  v_revision := 'v1:' || pg_catalog.md5(pg_catalog.jsonb_build_object(
    'source', pg_catalog.to_jsonb(v_source),
    'target', pg_catalog.to_jsonb(v_target),
    'awards', v_plan->'awardLines',
    'registrations', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(r) ORDER BY r.id), '[]'::jsonb)
      FROM public.tournament_registrations r WHERE r.tournament_id = p_source_tournament_id),
    'movements', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(m) ORDER BY m.id), '[]'::jsonb)
      FROM public.cashier_buyin_movements m
      WHERE m.registration_id IN (SELECT r.id FROM public.tournament_registrations r
                                  WHERE r.tournament_id = p_source_tournament_id)
         OR m.refund_id IN (SELECT f.id FROM public.cashier_refund_requests f
                            WHERE f.tournament_id = p_source_tournament_id)),
    'refunds', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(f) ORDER BY f.id), '[]'::jsonb)
      FROM public.cashier_refund_requests f WHERE f.tournament_id = p_source_tournament_id),
    'entries', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(e) ORDER BY e.id), '[]'::jsonb)
      FROM public.tournament_entries e
      WHERE e.registration_id IN (SELECT r.id FROM public.tournament_registrations r
                                  WHERE r.tournament_id = p_source_tournament_id)),
    'seats', (SELECT coalesce(pg_catalog.jsonb_agg(pg_catalog.to_jsonb(s) ORDER BY s.id), '[]'::jsonb)
      FROM public.tournament_seats s JOIN public.tournament_entries e ON e.id = s.entry_id
      WHERE e.registration_id IN (SELECT r.id FROM public.tournament_registrations r
                                  WHERE r.tournament_id = p_source_tournament_id))
  )::text);

  IF pg_catalog.jsonb_array_length(v_issues) > 0
     OR v_pool > 9007199254740991 OR v_fee > 9007199254740991 THEN
    RETURN pg_catalog.jsonb_build_object(
      'state', 'NOT_READY', 'reason', 'SOURCE_INCONSISTENT',
      'sourcePoolVnd', NULL, 'feeVnd', NULL,
      'issues', v_issues, 'previewRevision', v_revision,
      'confirmedCount', v_confirmed_count, 'unpaidCount', v_unpaid_count,
      'reversedCount', v_reversed_count, 'awardPlan', v_plan
    );
  END IF;

  SELECT * INTO v_math FROM private.satellite_funding_preview_math_v1(
    v_pool, v_ticket_value, (v_plan->>'ticketTotal')::integer
  );
  RETURN pg_catalog.jsonb_build_object(
    'state', CASE WHEN v_award_ranks > pg_catalog.cardinality(v_ready_players)
      THEN 'OWNER_EXCEPTION_REQUIRED' ELSE 'READY' END,
    'sourcePoolVnd', v_pool::text, 'feeVnd', v_fee::text,
    'targetEntryPriceVnd', v_ticket_value::text,
    'computedTicketCount', v_math.ticket_count,
    'cashRemainderVnd', v_math.cash_remainder_vnd::text,
    'ticketShortfallVnd', v_math.shortfall_vnd::text,
    'obligationShortfallVnd', greatest(v_liability - v_pool, 0)::text,
    'fundingState', v_math.funding_state,
    'eligibleWinnerCount', pg_catalog.cardinality(v_ready_players),
    'ownerExceptionRequired', v_award_ranks > pg_catalog.cardinality(v_ready_players),
    'confirmedCount', v_confirmed_count, 'unpaidCount', v_unpaid_count,
    'reversedCount', v_reversed_count,
    'previewRevision', v_revision, 'awardPlan', v_plan
  );
END;
$$;
REVOKE ALL ON FUNCTION public.satellite_source_funding_preview_v1(uuid,uuid,jsonb)
  FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.satellite_source_funding_preview_v1(uuid,uuid,jsonb)
  TO authenticated;

-- A shared release allowlist does not itself prove that this Satellite pool
-- can be locked. The second hold stays closed until a later, owner-reviewed
-- migration binds the same verified source revision into Lock and Issue.
CREATE OR REPLACE FUNCTION private.satellite_preview_write_hold_v1()
RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path = '' AS $$
BEGIN
  PERFORM centerpoint_private.assert_tournament_ops_release_v1(NEW.club_id);
  RAISE EXCEPTION 'satellite_verified_funding_lock_required' USING ERRCODE = 'P0001';
END;
$$;
REVOKE ALL ON FUNCTION private.satellite_preview_write_hold_v1()
  FROM PUBLIC, anon, authenticated, service_role;

DROP TRIGGER IF EXISTS satellite_preview_write_hold_v1 ON public.satellite_award_plans;
CREATE TRIGGER satellite_preview_write_hold_v1 BEFORE INSERT OR UPDATE
  ON public.satellite_award_plans FOR EACH ROW
  EXECUTE FUNCTION private.satellite_preview_write_hold_v1();
DROP TRIGGER IF EXISTS satellite_preview_write_hold_v1 ON public.satellite_award_issues;
CREATE TRIGGER satellite_preview_write_hold_v1 BEFORE INSERT OR UPDATE
  ON public.satellite_award_issues FOR EACH ROW
  EXECUTE FUNCTION private.satellite_preview_write_hold_v1();
DROP TRIGGER IF EXISTS satellite_preview_write_hold_v1 ON public.satellite_tickets;
CREATE TRIGGER satellite_preview_write_hold_v1 BEFORE INSERT OR UPDATE
  ON public.satellite_tickets FOR EACH ROW
  EXECUTE FUNCTION private.satellite_preview_write_hold_v1();
