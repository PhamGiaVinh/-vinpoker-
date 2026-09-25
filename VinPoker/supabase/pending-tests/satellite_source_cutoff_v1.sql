-- Disposable PG17 source-fence contract. Exact Cashier schema/migrations are
-- applied first; all fixture writes below roll back. Lock/Issue remain held.
\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.sat_cutoff_assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'satellite cutoff: %',label; END IF;
END $$;
INSERT INTO auth.users(id) VALUES ('d1000000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id) VALUES
 ('d2000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','d1000000-0000-4000-8000-000000000001',true);
INSERT INTO public.tournaments
 (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,rake_amount,service_fee_amount,operations_mode)
VALUES
 ('d3000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',
  'Satellite source','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('d3000000-0000-4000-8000-000000000002','d2000000-0000-4000-8000-000000000001',
  'Target','scheduled','registering',now()+interval '3 day',6000000,10000,500000,100000,'standard'),
 ('d3000000-0000-4000-8000-000000000003','d2000000-0000-4000-8000-000000000001',
  'Standard regression','registering','registering',now()+interval '2 day',1000000,10000,0,0,'standard');
INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES ('d5000000-0000-4000-8000-000000000001','d2000000-0000-4000-8000-000000000001',0,
        'd1000000-0000-4000-8000-000000000001');
INSERT INTO public.tournament_registrations
 (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES
 ('d4000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000101','d2000000-0000-4000-8000-000000000001',
  1000000,1200000,'SAT-CUTOFF-PAID','pending',
  '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}'),
 ('d4000000-0000-4000-8000-000000000002','d3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000102','d2000000-0000-4000-8000-000000000001',
  1000000,1200000,'SAT-CUTOFF-UNPAID','pending',
  '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}'),
 ('d4000000-0000-4000-8000-000000000003','d3000000-0000-4000-8000-000000000003',
  'd1000000-0000-4000-8000-000000000103','d2000000-0000-4000-8000-000000000001',
  1000000,1000000,'STANDARD-REG','pending',NULL),
 ('d4000000-0000-4000-8000-000000000004','d3000000-0000-4000-8000-000000000001',
  'd1000000-0000-4000-8000-000000000105','d2000000-0000-4000-8000-000000000001',
  1000000,1200000,'SAT-CUTOFF-PAID-WAITING','pending',
  '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}');
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,amount,applied_amount,actor_id,idempotency_key)
VALUES ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
 'd4000000-0000-4000-8000-000000000001','d5000000-0000-4000-8000-000000000001',
 'in','cash','buyin',1200000,1200000,'d1000000-0000-4000-8000-000000000001','sat-cutoff:paid'),
 ('d2000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
 'd4000000-0000-4000-8000-000000000004','d5000000-0000-4000-8000-000000000001',
 'in','cash','buyin',1200000,1200000,'d1000000-0000-4000-8000-000000000001','sat-cutoff:waiting');
SELECT pg_temp.sat_cutoff_assert((SELECT satellite_funding_phase='open'
 FROM public.cashier_buyin_movements WHERE idempotency_key='sat-cutoff:paid'),
 'open receipt tagged by server');
UPDATE public.tournament_registrations
SET cashier_paid_at=now(),status='confirmed',confirmed_at=now(),
    confirmed_by='d1000000-0000-4000-8000-000000000001'
WHERE id='d4000000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_entries(id,tournament_id,registration_id,player_id,entry_no,source,status)
VALUES ('d7000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
        'd4000000-0000-4000-8000-000000000001','d1000000-0000-4000-8000-000000000101',
        1,'online','registered');
INSERT INTO public.tournament_seats
 (id,tournament_id,player_id,entry_number,table_id,seat_number,chip_count,is_active,entry_id)
VALUES ('d8000000-0000-4000-8000-000000000001','d3000000-0000-4000-8000-000000000001',
        'd1000000-0000-4000-8000-000000000101',1,
        'd9000000-0000-4000-8000-000000000001',1,10000,true,
        'd7000000-0000-4000-8000-000000000001');
DO $$ BEGIN
  BEGIN
    UPDATE public.tournaments SET operations_mode='standard'
    WHERE id='d3000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Satellite mode changed after source';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_mode_fixed_after_source%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.tournaments SET operations_mode='satellite'
    WHERE id='d3000000-0000-4000-8000-000000000003';
    RAISE EXCEPTION 'Standard mode changed after registration';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_mode_fixed_after_source%' THEN RAISE; END IF;
  END;
END $$;
UPDATE public.tournaments SET registration_closed_at=now()
WHERE id='d3000000-0000-4000-8000-000000000001';
SELECT pg_temp.sat_cutoff_assert((SELECT satellite_cutoff_fenced_at IS NOT NULL
  FROM public.tournaments WHERE id='d3000000-0000-4000-8000-000000000001'),
  'cutoff gets an actual fence marker');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.tournament_registrations
      (tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status)
    VALUES ('d3000000-0000-4000-8000-000000000001',
            'd1000000-0000-4000-8000-000000000104',
            'd2000000-0000-4000-8000-000000000001',1000000,1200000,'SAT-TOO-LATE','pending');
    RAISE EXCEPTION 'Post-cutoff direct insert passed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_registration_cutoff_closed%' THEN RAISE; END IF;
  END;
  BEGIN
    UPDATE public.tournament_registrations
    SET status='confirmed',confirmed_at=now(),cashier_paid_at=now(),
        confirmed_by='d1000000-0000-4000-8000-000000000001'
    WHERE id='d4000000-0000-4000-8000-000000000004';
    RAISE EXCEPTION 'Paid waiting attempt confirmed after cutoff';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_registration_cutoff_frozen%' THEN RAISE; END IF;
  END;
END $$;
DO $$ DECLARE before_hash text; after_hash text; p jsonb; BEGIN
  p := public.satellite_source_funding_preview_v2(
    'd3000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    '[{"position":1,"ticketCount":1,"cashVnd":"0"}]');
  before_hash := p->>'previewRevision';
  PERFORM pg_temp.sat_cutoff_assert(before_hash ~ '^v2:[0-9a-f]{32}$','v2 hash emitted');
  UPDATE public.tournament_entries SET status='busted',current_stack=0
  WHERE id='d7000000-0000-4000-8000-000000000001';
  UPDATE public.tournament_seats SET is_active=false,chip_count=0
  WHERE id='d8000000-0000-4000-8000-000000000001';
  UPDATE public.tournament_registrations SET status='cancelled',cancelled_at=now(),
    cancellation_reason='auto_cancelled_timeout'
  WHERE id='d4000000-0000-4000-8000-000000000002';
  p := public.satellite_source_funding_preview_v2(
    'd3000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    '[{"position":1,"ticketCount":1,"cashVnd":"0"}]');
  after_hash := p->>'previewRevision';
  PERFORM pg_temp.sat_cutoff_assert(before_hash=after_hash,
    'Floor move/bust/chip and unpaid cancellation excluded from funding hash');
  INSERT INTO public.cashier_buyin_movements
    (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
     amount,applied_amount,actor_id,idempotency_key)
  VALUES ('d2000000-0000-4000-8000-000000000001',
          'd3000000-0000-4000-8000-000000000001',
          'd4000000-0000-4000-8000-000000000001',
          'd5000000-0000-4000-8000-000000000001','in','cash','buyin',1,0,
          'd1000000-0000-4000-8000-000000000001','sat-cutoff:late-overpay');
  PERFORM pg_temp.sat_cutoff_assert((SELECT satellite_funding_phase='late'
    FROM public.cashier_buyin_movements WHERE idempotency_key='sat-cutoff:late-overpay'),
    'post-cutoff receipt tagged late');
  p := public.satellite_source_funding_preview_v2(
    'd3000000-0000-4000-8000-000000000001',
    'd3000000-0000-4000-8000-000000000002',
    '[{"position":1,"ticketCount":1,"cashVnd":"0"}]');
  PERFORM pg_temp.sat_cutoff_assert((p->>'previewRevision')=before_hash
    AND p->>'lateReceiptCount'='1','late surplus retained outside funding hash');
END $$;
UPDATE public.tournament_registrations SET status='confirmed',confirmed_at=now()
WHERE id='d4000000-0000-4000-8000-000000000003';
SELECT pg_temp.sat_cutoff_assert((SELECT status='confirmed'
  FROM public.tournament_registrations WHERE id='d4000000-0000-4000-8000-000000000003'),
  'non-Satellite registration remains mutable');
ROLLBACK;
