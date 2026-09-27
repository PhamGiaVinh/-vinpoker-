\set ON_ERROR_STOP on
DO $$ BEGIN
  IF (SELECT count(*) FROM public.satellite_award_plans
      WHERE source_tournament_id IN (
        'bc000000-0000-4000-8000-000000000001',
        'bc000000-0000-4000-8000-000000000002'))<>2
     OR EXISTS (SELECT 1 FROM public.cashier_refund_requests
                WHERE tournament_id='bc000000-0000-4000-8000-000000000002')
     OR (SELECT coalesce(sum(applied_amount),0) FROM public.cashier_buyin_movements
         WHERE tournament_id IN (
           'bc000000-0000-4000-8000-000000000001',
           'bc000000-0000-4000-8000-000000000002')
           AND direction='in')<>2400000 THEN
    RAISE EXCEPTION 'Lock retry or refund race conservation failed';
  END IF;
END $$;
