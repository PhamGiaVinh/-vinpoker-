-- All 100 customers must have exactly one verified 6.6m cash movement.
\set ON_ERROR_STOP on
DO $test$
DECLARE v_count integer; v_paid_count integer; v_bad_count integer; v_total bigint;
BEGIN
  SELECT count(*),count(*) FILTER (WHERE r.cashier_paid_at IS NOT NULL),
    count(*) FILTER (WHERE coalesce(m.movement_count,0)<>1
      OR coalesce(m.applied_total,0)<>6600000 OR r.status<>'pending'),
    coalesce(sum(m.applied_total),0)
  INTO v_count,v_paid_count,v_bad_count,v_total
  FROM public.tournament_registrations r
  JOIN auth.users u ON u.id=r.player_id
  LEFT JOIN LATERAL (
    SELECT count(*) AS movement_count,sum(applied_amount) AS applied_total
    FROM public.cashier_buyin_movements m
    WHERE m.registration_id=r.id AND m.purpose='buyin' AND m.direction='in'
  ) m ON true
  WHERE u.email LIKE 'cashier-load-%@test.invalid';
  IF v_count<>100 OR v_paid_count<>100 OR v_bad_count<>0 OR v_total<>660000000 THEN
    RAISE EXCEPTION '100-customer load mismatch: registrations %, paid %, bad %, total %',
      v_count,v_paid_count,v_bad_count,v_total;
  END IF;
END $test$;
