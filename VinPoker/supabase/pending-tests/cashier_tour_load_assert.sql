-- All 100 customers must have exactly one cash movement at their stored price.
-- A single free-rake slot must go to exactly one concurrent registration.
\set ON_ERROR_STOP on
DO $test$
DECLARE v_count integer; v_paid_count integer; v_bad_count integer;
  v_free_count integer; v_tour_free_used integer; v_total bigint;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE r.cashier_paid_at IS NOT NULL),
    count(*) FILTER (WHERE coalesce(m.movement_count,0)<>1
      OR coalesce(m.applied_total,0)<>r.total_pay
      OR coalesce(m.amount_total,0)<>r.total_pay
      OR r.total_pay<>CASE WHEN r.used_free_rake THEN 6000000 ELSE 6600000 END
      OR (r.price_snapshot->>'total_pay')::bigint<>r.total_pay
      OR r.status<>'pending'),
    count(*) FILTER (WHERE r.used_free_rake),
    coalesce(sum(m.applied_total),0)
  INTO v_count,v_paid_count,v_bad_count,v_free_count,v_total
  FROM public.tournament_registrations r
  JOIN auth.users u ON u.id=r.player_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS movement_count,sum(applied_amount) AS applied_total,
      sum(amount) AS amount_total
    FROM public.cashier_buyin_movements m
    WHERE m.registration_id=r.id AND m.purpose='buyin' AND m.direction='in'
  ) m ON true
  WHERE u.email LIKE 'cashier-load-%@test.invalid';
  SELECT free_rake_used INTO v_tour_free_used FROM public.tournaments
    WHERE id='b3000000-0000-4000-8000-000000000001';
  IF v_count<>100 OR v_paid_count<>100 OR v_bad_count<>0
    OR v_free_count<>1 OR v_tour_free_used<>1 OR v_total<>659400000 THEN
    RAISE EXCEPTION '100-customer load mismatch: registrations %, paid %, bad %, free %, used %, total %',
      v_count,v_paid_count,v_bad_count,v_free_count,v_tour_free_used,v_total;
  END IF;
END $test$;
