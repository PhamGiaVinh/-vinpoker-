-- Disposable PostgreSQL only. Apply the pure arithmetic migration first.
-- Every assertion is read-only; no registration, ticket, or ledger fixtures are written.
\set ON_ERROR_STOP on

DO $test$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM private.satellite_funding_preview_math_v1(33000000,6600000,0);
  IF v_result.ticket_count <> 5 OR v_result.cash_remainder_vnd <> 0
     OR v_result.shortfall_vnd <> 0 OR v_result.funding_state <> 'NO_SHORTFALL' THEN
    RAISE EXCEPTION 'golden 33m without guarantee failed: %', row_to_json(v_result);
  END IF;
END $test$;

DO $test$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM private.satellite_funding_preview_math_v1(34000000,6600000,0);
  IF v_result.ticket_count <> 5 OR v_result.cash_remainder_vnd <> 1000000
     OR v_result.shortfall_vnd <> 0 OR v_result.funding_state <> 'NO_SHORTFALL' THEN
    RAISE EXCEPTION 'golden 34m without guarantee failed: %', row_to_json(v_result);
  END IF;
END $test$;

DO $test$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM private.satellite_funding_preview_math_v1(33000000,6600000,6);
  IF v_result.ticket_count <> 6 OR v_result.cash_remainder_vnd <> 0
     OR v_result.shortfall_vnd <> 6600000 OR v_result.funding_state <> 'INSUFFICIENT_FUNDS' THEN
    RAISE EXCEPTION 'golden 33m GTD 6 failed: %', row_to_json(v_result);
  END IF;
END $test$;

DO $test$
DECLARE v_result record;
BEGIN
  SELECT * INTO v_result FROM private.satellite_funding_preview_math_v1(34000000,6600000,6);
  IF v_result.ticket_count <> 6 OR v_result.cash_remainder_vnd <> 0
     OR v_result.shortfall_vnd <> 5600000 OR v_result.funding_state <> 'INSUFFICIENT_FUNDS' THEN
    RAISE EXCEPTION 'golden 34m GTD 6 failed: %', row_to_json(v_result);
  END IF;
END $test$;

DO $test$
DECLARE v_rejected boolean;
BEGIN
  IF pg_catalog.has_function_privilege('anon',
      'private.satellite_funding_preview_math_v1(numeric,numeric,integer)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('authenticated',
      'private.satellite_funding_preview_math_v1(numeric,numeric,integer)', 'EXECUTE')
     OR pg_catalog.has_function_privilege('service_role',
      'private.satellite_funding_preview_math_v1(numeric,numeric,integer)', 'EXECUTE') THEN
    RAISE EXCEPTION 'internal calculation function is directly executable by an API role';
  END IF;

  v_rejected := false;
  BEGIN
    PERFORM * FROM private.satellite_funding_preview_math_v1(-1,6600000,0);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'negative pool was accepted'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM * FROM private.satellite_funding_preview_math_v1(1.5,6600000,0);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'fractional VND pool was accepted'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM * FROM private.satellite_funding_preview_math_v1(100,0,0);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'zero ticket value was accepted'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM * FROM private.satellite_funding_preview_math_v1(100,1,-1);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'negative guarantee count was accepted'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM * FROM private.satellite_funding_preview_math_v1(100,1,501);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'guarantee above ticket cap was accepted'; END IF;

  v_rejected := false;
  BEGIN
    PERFORM * FROM private.satellite_funding_preview_math_v1(501,1,0);
  EXCEPTION WHEN SQLSTATE '22023' THEN v_rejected := true;
  END;
  IF NOT v_rejected THEN RAISE EXCEPTION 'calculated count above ticket cap was accepted'; END IF;
END $test$;
