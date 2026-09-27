\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT count(*) FROM public.tournaments
      WHERE id IN ('cc000000-0000-4000-8000-000000000001',
                   'cc000000-0000-4000-8000-000000000002',
                   'cc000000-0000-4000-8000-000000000003',
                   'cc000000-0000-4000-8000-000000000004',
                   'cc000000-0000-4000-8000-000000000005')
        AND registration_closed_at IS NOT NULL
        AND satellite_cutoff_fenced_at IS NOT NULL) <> 5 THEN
    RAISE EXCEPTION 'cutoff race fence missing';
  END IF;
  IF EXISTS (SELECT 1 FROM public.tournament_registrations
             WHERE tournament_id='cc000000-0000-4000-8000-000000000001')
     OR EXISTS (SELECT 1 FROM public.tournament_entries
                WHERE tournament_id IN (
                  'cc000000-0000-4000-8000-000000000001',
                  'cc000000-0000-4000-8000-000000000002',
                  'cc000000-0000-4000-8000-000000000003'))
     OR EXISTS (SELECT 1 FROM public.tournament_registrations
                WHERE tournament_id IN (
                  'cc000000-0000-4000-8000-000000000002',
                  'cc000000-0000-4000-8000-000000000003')
                  AND status<>'pending')
     OR EXISTS (SELECT 1 FROM public.cashier_buyin_movements
                WHERE tournament_id IN (
                  'cc000000-0000-4000-8000-000000000001',
                  'cc000000-0000-4000-8000-000000000002',
                  'cc000000-0000-4000-8000-000000000003')) THEN
    RAISE EXCEPTION 'cutoff race source conservation failed';
  END IF;
  IF (SELECT count(*) FROM public.cashier_buyin_movements
      WHERE tournament_id IN ('cc000000-0000-4000-8000-000000000004',
                              'cc000000-0000-4000-8000-000000000005')
        AND satellite_funding_phase='open' AND applied_amount=1200000)<>2
     OR (SELECT coalesce(sum(applied_amount),0) FROM public.cashier_buyin_movements
         WHERE tournament_id IN ('cc000000-0000-4000-8000-000000000004',
                                 'cc000000-0000-4000-8000-000000000005'))<>2400000 THEN
    RAISE EXCEPTION 'cash/bank first-writer conservation failed';
  END IF;
END $$;
