-- Rollback-only PG17. The orphan seed temporarily removes only disposable
-- CHECK/INSERT triggers to represent historical malformed rows; positive
-- registration, Cashier movement, preview and Lock guards remain real.
\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.sat_orphan_assert(ok boolean,label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
 IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'satellite orphan: %',label; END IF;
END $$;
INSERT INTO auth.users(id) VALUES ('e1000000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id) VALUES
 ('e2000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','e1000000-0000-4000-8000-000000000001',true);
INSERT INTO public.tournaments
 (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,
  rake_amount,service_fee_amount,operations_mode)
VALUES
 ('e3000000-0000-4000-8000-000000000001','e2000000-0000-4000-8000-000000000001',
  'Orphan source','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('e3000000-0000-4000-8000-000000000002','e2000000-0000-4000-8000-000000000001',
  'Orphan target','live','registering',now()+interval '3 day',900000,10000,100000,0,'standard');
INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES('e4000000-0000-4000-8000-000000000001',
       'e2000000-0000-4000-8000-000000000001',0,
       'e1000000-0000-4000-8000-000000000001');
INSERT INTO public.tournament_registrations
 (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES
 ('e5000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000101',
  'e2000000-0000-4000-8000-000000000001',1000000,1200000,'SAT-ORPHAN-PAID','pending',
  '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}'),
 ('e5000000-0000-4000-8000-000000000002',
  'e3000000-0000-4000-8000-000000000001',
  'e1000000-0000-4000-8000-000000000102',
  'e2000000-0000-4000-8000-000000000001',1000000,1200000,'SAT-ORPHAN-UNPAID','pending',
  '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}');
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
  amount,applied_amount,actor_id,idempotency_key)
VALUES('e2000000-0000-4000-8000-000000000001',
       'e3000000-0000-4000-8000-000000000001',
       'e5000000-0000-4000-8000-000000000001',
       'e4000000-0000-4000-8000-000000000001',
       'in','cash','buyin',1200000,1200000,
       'e1000000-0000-4000-8000-000000000001','sat-orphan:paid');
UPDATE public.tournament_registrations SET status='confirmed',cashier_paid_at=now(),
 confirmed_at=now(),confirmed_by='e1000000-0000-4000-8000-000000000001'
WHERE id='e5000000-0000-4000-8000-000000000001';
INSERT INTO public.tournament_entries
 (tournament_id,registration_id,player_id,entry_no,source,status)
VALUES('e3000000-0000-4000-8000-000000000001',
       'e5000000-0000-4000-8000-000000000001',
       'e1000000-0000-4000-8000-000000000101',1,'online','registered');
UPDATE public.tournaments SET registration_closed_at=now()
WHERE id='e3000000-0000-4000-8000-000000000001';
UPDATE public.centerpoint_tournament_ops_release SET enabled=true,
 allowed_club_ids=ARRAY['e2000000-0000-4000-8000-000000000001']::uuid[] WHERE id=true;

DO $$ DECLARE p jsonb; BEGIN
 p:=public.satellite_source_funding_preview_v2(
  'e3000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000002',
  '[{"position":1,"ticketCount":1,"cashVnd":"0"}]');
 PERFORM pg_temp.sat_orphan_assert(p->>'state'='READY'
   AND p->>'sourcePoolVnd'='1000000' AND p->>'unmatchedMovementCount'='0',
   'baseline source reconciles');
 BEGIN
  INSERT INTO public.cashier_buyin_movements
   (club_id,tournament_id,shift_id,direction,method,purpose,
    amount,applied_amount,actor_id,idempotency_key)
  VALUES('e2000000-0000-4000-8000-000000000001',
    'e3000000-0000-4000-8000-000000000001',
    'e4000000-0000-4000-8000-000000000001','in','cash','buyin',
    100000,100000,'e1000000-0000-4000-8000-000000000001','sat-orphan:new-denied');
  RAISE EXCEPTION 'new orphan buy-in admitted';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE '%satellite_funding_movement_registration_required%' THEN RAISE; END IF;
 END;
END $$;

-- A valid late receipt for an existing pending attempt is retained in the
-- append-only ledger, excluded from READY funding, and surfaced for review.
SAVEPOINT before_late;
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
  amount,applied_amount,actor_id,idempotency_key)
VALUES('e2000000-0000-4000-8000-000000000001',
       'e3000000-0000-4000-8000-000000000001',
       'e5000000-0000-4000-8000-000000000002',
       'e4000000-0000-4000-8000-000000000001',
       'in','cash','buyin',100000,100000,
       'e1000000-0000-4000-8000-000000000001','sat-orphan:late-receipt');
DO $$ DECLARE p jsonb; BEGIN
 p:=public.satellite_source_funding_preview_v2(
  'e3000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000002',
  '[{"position":1,"ticketCount":1,"cashVnd":"0"}]');
 PERFORM pg_temp.sat_orphan_assert(p->>'lateReceiptCount'='1'
   AND p->>'state'='NOT_READY'
   AND (SELECT satellite_funding_phase='late' AND applied_amount=100000
        FROM public.cashier_buyin_movements
        WHERE idempotency_key='sat-orphan:late-receipt'),
   'late verified receipt retained as pending reconciliation, not funded');
END $$;
ROLLBACK TO SAVEPOINT before_late;

-- Historical malformed source-linked rows can predate the current CHECK and
-- phase trigger. Seed only in this isolated rollback transaction; re-enable
-- triggers before exercising the real preview and Lock RPCs.
SAVEPOINT before_legacy_orphans;
ALTER TABLE public.cashier_buyin_movements DROP CONSTRAINT cashier_movement_shape;
ALTER TABLE public.cashier_buyin_movements DISABLE TRIGGER satellite_cashier_movement_phase_v1;
ALTER TABLE public.cashier_buyin_movements DISABLE TRIGGER satellite_reject_orphan_movement_v1;
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,shift_id,direction,method,purpose,
  amount,applied_amount,actor_id,idempotency_key)
VALUES
 ('e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'in','cash','buyin',100000,100000,
  'e1000000-0000-4000-8000-000000000001','sat-orphan:legacy-buyin'),
 ('e2000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000001',
  'e4000000-0000-4000-8000-000000000001',
  'out','cash','refund',50000,50000,
  'e1000000-0000-4000-8000-000000000001','sat-orphan:legacy-refund');
ALTER TABLE public.cashier_buyin_movements ENABLE TRIGGER satellite_cashier_movement_phase_v1;
ALTER TABLE public.cashier_buyin_movements ENABLE TRIGGER satellite_reject_orphan_movement_v1;
DO $$ DECLARE p jsonb; BEGIN
 p:=public.satellite_source_funding_preview_v2(
  'e3000000-0000-4000-8000-000000000001',
  'e3000000-0000-4000-8000-000000000002',
  '[{"position":1,"ticketCount":1,"cashVnd":"0"}]');
 PERFORM pg_temp.sat_orphan_assert(p->>'state'='NOT_READY'
   AND p->>'reason'='SOURCE_MOVEMENT_UNMATCHED'
   AND p->>'sourcePoolVnd' IS NULL AND p->>'feeVnd' IS NULL
   AND p->>'unmatchedMovementCount'='2'
   AND jsonb_array_length(p->'issues')=2,
   'legacy orphan buy-in/refund cannot produce funded preview');
 BEGIN
  PERFORM public.satellite_lock_award_plan_v1(
   'e3000000-0000-4000-8000-000000000001',
   'e3000000-0000-4000-8000-000000000002',
   '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',
   p->>'previewRevision','e6000000-0000-4000-8000-000000000001');
  RAISE EXCEPTION 'Lock accepted orphan funding';
 EXCEPTION WHEN check_violation THEN
  IF SQLERRM NOT LIKE '%satellite_lock_source_not_ready%' THEN RAISE; END IF;
 END;
 PERFORM pg_temp.sat_orphan_assert(NOT EXISTS(
  SELECT 1 FROM public.satellite_award_plans
  WHERE source_tournament_id='e3000000-0000-4000-8000-000000000001'),
  'denied Lock persists no award row');
END $$;
ROLLBACK TO SAVEPOINT before_legacy_orphans;
ROLLBACK;
