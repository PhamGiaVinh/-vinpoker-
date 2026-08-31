-- Ops Quant Data Health Q0 — owner-scoped observed registration and sanitized
-- SePay aggregate read contracts.
--
-- SOURCE-ONLY / PENDING: do not apply without a separate owner-gated DB review.
-- No writer, trigger, raw bank payload, player identity, or autonomous action.
-- ROLLBACK (forward-only after apply): revoke and drop the two Q0 readers and
-- their internal resolver in a
-- separately reviewed migration.

BEGIN;

CREATE OR REPLACE FUNCTION public.resolve_sepay_account_club_v1(p_account_number text)
RETURNS TABLE(resolved_club_id uuid, resolution_state text)
LANGUAGE sql
STABLE
SET search_path = ''
AS $$
  WITH matches AS (
    SELECT DISTINCT pba.club_id
    FROM public.platform_bank_accounts AS pba
    WHERE pba.is_active = true
      AND pba.account_number = p_account_number
      AND pba.club_id IS NOT NULL
  )
  SELECT CASE WHEN pg_catalog.count(*) = 1 THEN (pg_catalog.array_agg(matches.club_id))[1] ELSE NULL END,
         CASE pg_catalog.count(*)
           WHEN 0 THEN 'UNRESOLVED_NO_MAPPING'
           WHEN 1 THEN 'RESOLVED_UNIQUE'
           ELSE 'AMBIGUOUS_MAPPING'
         END
  FROM matches;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_registration_pace_q0(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_as_of timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_from timestamptz := v_as_of - interval '1 day';
  v_to timestamptz := v_as_of + interval '14 days';
  v_events jsonb;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL
     OR NOT COALESCE(public.is_club_owner(v_actor, p_club_id), false) THEN
    RAISE EXCEPTION 'ops_quant_owner_required' USING ERRCODE = '42501';
  END IF;

  WITH relevant_events AS (
    SELECT t.id, t.name, t.status, t.start_time
    FROM public.tournaments AS t
    WHERE t.club_id = p_club_id
      AND t.deleted_at IS NULL
      AND t.status <> 'cancelled'
      AND t.start_time IS NOT NULL
      AND t.start_time >= v_from
      AND t.start_time < v_to
  ), event_counts AS (
    SELECT e.id,
           e.name,
           e.status,
           e.start_time,
           pg_catalog.count(r.id)::bigint AS confirmed_entries,
           pg_catalog.count(DISTINCT r.player_id)::bigint AS unique_players,
           pg_catalog.count(r.id) FILTER (WHERE r.source_entry_id IS NOT NULL)::bigint AS reentries,
           pg_catalog.count(r.id) FILTER (WHERE r.confirmed_at IS NULL)::bigint AS missing_confirmed_at,
           pg_catalog.count(r.id) FILTER (WHERE r.confirmed_at > v_as_of)::bigint AS future_confirmed_at,
           pg_catalog.min(r.confirmed_at) FILTER (WHERE r.confirmed_at <= v_as_of) AS first_registration_at,
           pg_catalog.max(r.confirmed_at) FILTER (WHERE r.confirmed_at <= v_as_of) AS last_registration_at,
           pg_catalog.count(r.id) FILTER (WHERE r.confirmed_at >= v_as_of - interval '1 hour' AND r.confirmed_at <= v_as_of)::bigint AS last_1h,
           pg_catalog.count(r.id) FILTER (WHERE r.confirmed_at >= v_as_of - interval '6 hours' AND r.confirmed_at <= v_as_of)::bigint AS last_6h,
           pg_catalog.count(r.id) FILTER (WHERE r.confirmed_at >= v_as_of - interval '24 hours' AND r.confirmed_at <= v_as_of)::bigint AS last_24h
    FROM relevant_events AS e
    LEFT JOIN public.tournament_registrations AS r
      ON r.tournament_id = e.id
     AND r.club_id = p_club_id
     AND r.status = 'confirmed'
    GROUP BY e.id, e.name, e.status, e.start_time
  ), event_timeline AS (
    SELECT r.tournament_id,
           pg_catalog.jsonb_agg(
             pg_catalog.jsonb_build_object(
               'bucketStart', pg_catalog.to_char(
                 pg_catalog.date_trunc('hour', r.confirmed_at) AT TIME ZONE 'UTC',
                 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'
               ),
               'observedCount', r.bucket_count,
               'cumulativeCount', r.cumulative_count
             ) ORDER BY r.confirmed_at
           ) AS timeline
    FROM (
      SELECT buckets.tournament_id,
             buckets.confirmed_at,
             buckets.bucket_count,
             pg_catalog.sum(buckets.bucket_count) OVER (
               PARTITION BY buckets.tournament_id ORDER BY buckets.confirmed_at
               ROWS BETWEEN UNBOUNDED PRECEDING AND CURRENT ROW
             )::bigint AS cumulative_count
      FROM (
        SELECT tr.tournament_id,
               pg_catalog.date_trunc('hour', tr.confirmed_at) AS confirmed_at,
               pg_catalog.count(*)::bigint AS bucket_count
        FROM public.tournament_registrations AS tr
        JOIN relevant_events AS e ON e.id = tr.tournament_id
        WHERE tr.club_id = p_club_id
          AND tr.status = 'confirmed'
          AND tr.confirmed_at IS NOT NULL
          AND tr.confirmed_at <= v_as_of
        GROUP BY tr.tournament_id, pg_catalog.date_trunc('hour', tr.confirmed_at)
      ) AS buckets
    ) AS r
    GROUP BY r.tournament_id
  )
  SELECT COALESCE(pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'eventId', c.id,
      'eventName', c.name,
      'eventState', c.status,
      'startTime', pg_catalog.to_char(c.start_time AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'confirmedEntries', c.confirmed_entries,
      'uniquePlayers', c.unique_players,
      'reentries', c.reentries,
      'firstRegistrationAt', CASE WHEN c.first_registration_at IS NULL THEN NULL ELSE pg_catalog.to_char(c.first_registration_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'lastRegistrationAt', CASE WHEN c.last_registration_at IS NULL THEN NULL ELSE pg_catalog.to_char(c.last_registration_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
      'last1h', c.last_1h,
      'last6h', c.last_6h,
      'last24h', c.last_24h,
      'timelineAvailability', CASE WHEN c.missing_confirmed_at = 0 AND c.future_confirmed_at = 0 THEN 'exact' ELSE 'partial' END,
      'timelineReasonCode', CASE
        WHEN c.future_confirmed_at > 0 THEN 'FUTURE_CONFIRMED_AT'
        WHEN c.missing_confirmed_at > 0 THEN 'CONFIRMED_AT_MISSING'
        ELSE NULL
      END,
      'timeline', COALESCE(tl.timeline, '[]'::jsonb)
    ) ORDER BY c.start_time, c.id
  ), '[]'::jsonb)
  INTO v_events
  FROM event_counts AS c
  LEFT JOIN event_timeline AS tl ON tl.tournament_id = c.id;

  RETURN pg_catalog.jsonb_build_object(
    'version', 'ops-registration-observed-q0',
    'clubId', p_club_id,
    'asOf', pg_catalog.to_char(v_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'window', pg_catalog.jsonb_build_object(
      'from', pg_catalog.to_char(v_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'to', pg_catalog.to_char(v_to AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'events', v_events
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.get_ops_sepay_read_state_q0(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = ''
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_as_of timestamptz := pg_catalog.date_trunc('milliseconds', pg_catalog.clock_timestamp());
  v_from timestamptz := v_as_of - interval '24 hours';
  v_buckets jsonb;
  v_latest_observed_at timestamptz;
  v_account_numbers text[];
  v_has_ambiguous_mapping boolean;
BEGIN
  IF v_actor IS NULL OR p_club_id IS NULL
     OR NOT COALESCE(public.is_club_owner(v_actor, p_club_id), false) THEN
    RAISE EXCEPTION 'ops_quant_owner_required' USING ERRCODE = '42501';
  END IF;

  SELECT pg_catalog.array_agg(DISTINCT pba.account_number ORDER BY pba.account_number)
  INTO v_account_numbers
  FROM public.platform_bank_accounts AS pba
  WHERE pba.club_id = p_club_id
    AND pba.is_active = true
    AND pba.account_number IS NOT NULL;

  IF v_account_numbers IS NULL OR pg_catalog.cardinality(v_account_numbers) = 0 THEN
    RAISE EXCEPTION 'SEPAY_ACCOUNT_MAPPING_MISSING' USING ERRCODE = 'P0001';
  END IF;

  SELECT COALESCE(pg_catalog.bool_or(resolution.resolution_state <> 'RESOLVED_UNIQUE'
      OR resolution.resolved_club_id IS DISTINCT FROM p_club_id), false)
  INTO v_has_ambiguous_mapping
  FROM pg_catalog.unnest(v_account_numbers) AS account(account_number)
  CROSS JOIN LATERAL public.resolve_sepay_account_club_v1(account.account_number) AS resolution;

  IF v_has_ambiguous_mapping THEN
    RAISE EXCEPTION 'SEPAY_ACCOUNT_MAPPING_AMBIGUOUS' USING ERRCODE = 'P0001';
  END IF;

  IF EXISTS (
    SELECT 1
    FROM public.club_payment_config AS config
    WHERE config.is_active = true
      AND config.provider = 'sepay'
      AND config.club_id <> p_club_id
      AND config.master_account_number = ANY(v_account_numbers)
  ) THEN
    RAISE EXCEPTION 'SEPAY_ACTIVE_CONFIG_ACCOUNT_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  -- The (provider, account_number, provider_txn_id) index bounds this all-history integrity check.
  IF EXISTS (
    SELECT 1
    FROM public.bank_transactions AS stored
    WHERE stored.provider = 'sepay'
      AND stored.account_number = ANY(v_account_numbers)
      AND stored.club_id IS NOT NULL
      AND stored.club_id <> p_club_id
  ) THEN
    RAISE EXCEPTION 'SEPAY_STORED_CLUB_CONFLICT' USING ERRCODE = 'P0001';
  END IF;

  WITH states(state, statuses) AS (
    VALUES
      ('actionable'::text, ARRAY['unmatched']::text[]),
      ('resolved'::text, ARRAY['matched','ignored']::text[]),
      ('quarantined'::text, ARRAY['quarantined']::text[])
  ), aggregate AS (
    SELECT s.state,
           pg_catalog.count(bt.id)::bigint AS transaction_count,
           COALESCE(pg_catalog.sum(bt.amount) FILTER (
             WHERE bt.transfer_type = 'in' AND bt.amount IS NOT NULL
           ), 0)::bigint AS inbound_amount_vnd,
           pg_catalog.count(bt.id) FILTER (
             WHERE bt.transfer_type = 'in' AND bt.amount IS NULL
           )::bigint AS missing_inbound_amount
    FROM states AS s
    LEFT JOIN public.bank_transactions AS bt
      ON bt.provider = 'sepay'
     AND bt.account_number = ANY(v_account_numbers)
     AND bt.created_at >= v_from
     AND bt.created_at <= v_as_of
     AND bt.status = ANY(s.statuses)
    GROUP BY s.state
  )
  SELECT pg_catalog.jsonb_agg(
    pg_catalog.jsonb_build_object(
      'state', a.state,
      'transactionCount', a.transaction_count,
      'inboundAmountVnd', a.inbound_amount_vnd,
      'amountAvailability', CASE WHEN a.missing_inbound_amount = 0 THEN 'exact' ELSE 'partial' END,
      'amountReasonCode', CASE WHEN a.missing_inbound_amount = 0 THEN NULL ELSE 'INBOUND_AMOUNT_MISSING' END
    ) ORDER BY CASE a.state WHEN 'actionable' THEN 1 WHEN 'resolved' THEN 2 ELSE 3 END
  ) INTO v_buckets
  FROM aggregate AS a;

  SELECT pg_catalog.max(COALESCE(bt.occurred_at, bt.created_at))
  INTO v_latest_observed_at
  FROM public.bank_transactions AS bt
  WHERE bt.provider = 'sepay'
    AND bt.account_number = ANY(v_account_numbers)
    AND bt.created_at >= v_from
    AND bt.created_at <= v_as_of
    AND bt.status IN ('unmatched', 'matched', 'ignored', 'quarantined');

  RETURN pg_catalog.jsonb_build_object(
    'version', 'ops-sepay-read-state-q0',
    'clubId', p_club_id,
    'asOf', pg_catalog.to_char(v_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
    'window', pg_catalog.jsonb_build_object(
      'from', pg_catalog.to_char(v_from AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"'),
      'to', pg_catalog.to_char(v_as_of AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"')
    ),
    'latestObservedTransactionAt', CASE WHEN v_latest_observed_at IS NULL THEN NULL ELSE pg_catalog.to_char(v_latest_observed_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') END,
    'buckets', COALESCE(v_buckets, '[]'::jsonb)
  );
END;
$$;

REVOKE ALL ON FUNCTION public.get_ops_registration_pace_q0(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.get_ops_sepay_read_state_q0(uuid) FROM PUBLIC, anon, service_role;
REVOKE ALL ON FUNCTION public.resolve_sepay_account_club_v1(text) FROM PUBLIC, anon, authenticated, service_role;
GRANT EXECUTE ON FUNCTION public.get_ops_registration_pace_q0(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.get_ops_sepay_read_state_q0(uuid) TO authenticated;

COMMENT ON FUNCTION public.get_ops_registration_pace_q0(uuid) IS
  'Owner-scoped observed registration counts and hourly receipt timeline; no forecast or identity export.';
COMMENT ON FUNCTION public.get_ops_sepay_read_state_q0(uuid) IS
  'Owner-scoped sanitized SePay state aggregates; no raw bank fields or writer action.';
COMMENT ON FUNCTION public.resolve_sepay_account_club_v1(text) IS
  'Internal account-to-club authority resolver. Not callable by browser roles.';

COMMIT;
