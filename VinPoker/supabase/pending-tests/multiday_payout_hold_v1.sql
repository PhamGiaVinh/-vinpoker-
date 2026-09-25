DO $$ BEGIN
 UPDATE public.multi_day_package_release_v1 SET enabled=false;
 BEGIN
   INSERT INTO public.tournament_prizes(tournament_id,position,amount)
   VALUES('40000000-0000-0000-0000-000000000008',2,500000);
   RAISE EXCEPTION 'legacy_prize_insert_bypassed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_verified_payout_writer_required' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.tournament_prizes SET amount=2000000
     WHERE id='a1000000-0000-0000-0000-000000000001';
   RAISE EXCEPTION 'legacy_prize_update_bypassed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_verified_payout_writer_required' THEN RAISE; END IF;
 END;
 BEGIN
   INSERT INTO public.tournament_payout_runs(tournament_id,status)
   VALUES('40000000-0000-0000-0000-000000000008','applied');
   RAISE EXCEPTION 'legacy_payout_run_bypassed';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_verified_payout_writer_required' THEN RAISE; END IF;
 END;
 BEGIN
   UPDATE public.tournament_prize_payments SET prize_amount=2000000
     WHERE id='a2000000-0000-0000-0000-000000000001';
   RAISE EXCEPTION 'paid_record_overwritten';
 EXCEPTION WHEN insufficient_privilege THEN
   IF SQLERRM<>'multi_day_verified_payout_writer_required' THEN RAISE; END IF;
 END;
 -- Non-package payout paths remain unaffected by this migration.
 INSERT INTO public.tournaments(id,club_id,phase)
 VALUES('40000000-0000-0000-0000-0000000000aa',
  '20000000-0000-0000-0000-000000000001','final');
 INSERT INTO public.tournament_prizes(tournament_id,position,amount)
 VALUES('40000000-0000-0000-0000-0000000000aa',1,1000000);
 INSERT INTO public.tournament_payout_runs(tournament_id,status)
 VALUES('40000000-0000-0000-0000-0000000000aa','applied');
 INSERT INTO public.tournament_prize_payments(tournament_id,status,prize_amount)
 VALUES('40000000-0000-0000-0000-0000000000aa','paid',1000000);
 IF (SELECT count(*) FROM public.tournament_prizes
     WHERE tournament_id='40000000-0000-0000-0000-0000000000aa')<>1 THEN
   RAISE EXCEPTION 'nonpackage_regression';
 END IF;
END $$;
SELECT 'multiday_payout_hold_v1 PASS' AS result;
