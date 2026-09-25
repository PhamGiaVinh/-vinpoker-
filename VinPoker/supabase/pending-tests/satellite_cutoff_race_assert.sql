\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT count(*) FROM public.tournaments
      WHERE id IN ('cc000000-0000-4000-8000-000000000001',
                   'cc000000-0000-4000-8000-000000000002',
                   'cc000000-0000-4000-8000-000000000003')
        AND registration_closed_at IS NOT NULL
        AND satellite_cutoff_fenced_at IS NOT NULL) <> 3 THEN
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
END $$;
