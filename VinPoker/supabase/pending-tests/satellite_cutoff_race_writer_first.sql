\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL deadlock_timeout='500ms';
SELECT set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000001',true);
SELECT set_config('test.cutoff_kind',:'kind',true);
DO $$ DECLARE v jsonb; v_tour uuid; BEGIN
  IF current_setting('test.cutoff_kind')='cash' THEN
    v_tour:='cc000000-0000-4000-8000-000000000004';
    v:=public.cashier_record_cash_buyin_v1(
      (SELECT id FROM public.tournament_registrations WHERE tournament_id=v_tour),
      1200000,'cf000000-0000-4000-8000-000000000004');
    IF v->>'ok'<>'true' THEN RAISE EXCEPTION 'cash-first failed: %',v; END IF;
  ELSE
    v_tour:='cc000000-0000-4000-8000-000000000005';
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    v:=public.cashier_record_verified_bank_v1(
      'cf000000-0000-4000-8000-000000000005',true);
    IF v->>'handled'<>'true' THEN RAISE EXCEPTION 'bank-first failed: %',v; END IF;
  END IF;
  IF (SELECT coalesce(sum(applied_amount),0)
      FROM public.cashier_buyin_movements WHERE tournament_id=v_tour)<>1200000
     OR (SELECT count(*) FROM public.cashier_buyin_movements
         WHERE tournament_id=v_tour AND satellite_funding_phase='open')<>1 THEN
    RAISE EXCEPTION 'pre-cutoff movement not conserved';
  END IF;
END $$;
SELECT pg_sleep(2);
COMMIT;
