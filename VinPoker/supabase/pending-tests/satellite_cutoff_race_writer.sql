\set ON_ERROR_STOP on
BEGIN;
SET LOCAL lock_timeout='8s';
SET LOCAL deadlock_timeout='500ms';
SELECT set_config('request.jwt.claim.sub','ca000000-0000-4000-8000-000000000001',true);
SELECT set_config('test.cutoff_kind',:'kind',true);
DO $$ DECLARE v jsonb; BEGIN
  IF current_setting('test.cutoff_kind')='canonical' THEN
    BEGIN
      PERFORM public.ops_create_offline_buyin_and_seat(
        'cc000000-0000-4000-8000-000000000001',
        'Cutoff Offline','sat-cutoff-race-offline');
      RAISE EXCEPTION 'canonical buy-in crossed cutoff';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT LIKE '%satellite_offline_buyin_requires_cashier_ledger%'
         AND SQLERRM NOT LIKE '%satellite_registration_cutoff_closed%' THEN RAISE; END IF;
    END;
    BEGIN
      INSERT INTO public.tournament_entries
        (tournament_id,registration_id,player_id,entry_no,source,status)
      VALUES ('cc000000-0000-4000-8000-000000000001',NULL,
              'ca000000-0000-4000-8000-000000000002',1,'online','registered');
      RAISE EXCEPTION 'direct entry crossed cutoff';
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT LIKE '%satellite_entry_cutoff_frozen%' THEN RAISE; END IF;
    END;
  ELSIF current_setting('test.cutoff_kind')='cash' THEN
    BEGIN
      v:=public.cashier_record_cash_buyin_v1(
        (SELECT id FROM public.tournament_registrations
         WHERE tournament_id='cc000000-0000-4000-8000-000000000002'),
        1200000,'cf000000-0000-4000-8000-000000000003');
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT LIKE '%satellite_registration_cutoff_frozen%' THEN RAISE; END IF;
    END;
  ELSIF current_setting('test.cutoff_kind')='bank' THEN
    PERFORM set_config('request.jwt.claim.role','service_role',true);
    BEGIN
      v:=public.cashier_record_verified_bank_v1(
        'cf000000-0000-4000-8000-000000000002',true);
    EXCEPTION WHEN check_violation THEN
      IF SQLERRM NOT LIKE '%satellite_registration_cutoff_frozen%' THEN RAISE; END IF;
    END;
  END IF;
END $$;
COMMIT;
