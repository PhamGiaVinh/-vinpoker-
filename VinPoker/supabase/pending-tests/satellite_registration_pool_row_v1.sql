-- Helper-only disposable PostgreSQL contract test. The workflow applies the
-- synthetic read-table fixture and exact pending helper; this is not full
-- Cashier migration/runtime integration. Every fixture is rolled back.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.satellite_assert(p_ok boolean, p_label text)
RETURNS void LANGUAGE plpgsql AS $$
BEGIN
  IF p_ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'satellite pool-row test failed: %', p_label;
  END IF;
END $$;

INSERT INTO auth.users(id,aud,role,email,created_at,updated_at)
VALUES ('a1000000-0000-4000-8000-000000000001','authenticated','authenticated',
        'sat-pool-owner@test.invalid',now(),now());
INSERT INTO public.clubs(id,owner_id,name,region,status)
VALUES ('a2000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000001',
        'Satellite pool TEST','HCM','approved');
INSERT INTO public.tournaments
  (id,club_id,name,status,live_status,start_time,buy_in,rake_amount,service_fee_amount)
VALUES ('a3000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
        'Satellite pool TEST','registering','registering',now()+interval '1 day',
        1000000,100000,50000);
INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES ('a5000000-0000-4000-8000-000000000001','a2000000-0000-4000-8000-000000000001',
        0,'a1000000-0000-4000-8000-000000000001');

INSERT INTO public.tournament_registrations
  (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
VALUES
 ('a4000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000101','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-READY','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":0,"total_pay":1150000}'),
 ('a4000000-0000-4000-8000-000000000002','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000102','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-MISSING-ENTRY','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":0,"total_pay":1150000}'),
 ('a4000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000103','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-DUP-ENTRY','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":0,"total_pay":1150000}'),
 ('a4000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000104','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-LEGACY','pending',NULL),
 ('a4000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000105','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-UNDERPAID','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":0,"total_pay":1150000}'),
 ('a4000000-0000-4000-8000-000000000006','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000106','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-REFUNDED','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":0,"total_pay":1150000}'),
 ('a4000000-0000-4000-8000-000000000007','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000107','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-REFUND-AMOUNT','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":0,"total_pay":1150000}'),
 ('a4000000-0000-4000-8000-000000000008','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000108','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-REFUND-LEDGER','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":0,"total_pay":1150000}'),
 ('a4000000-0000-4000-8000-000000000009','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000109','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-REFUND-PENDING','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":0,"total_pay":1150000}'),
 ('a4000000-0000-4000-8000-000000000010','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000110','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-REFUND-SEAT','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":0,"total_pay":1150000}'),
 ('a4000000-0000-4000-8000-000000000011','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000111','a2000000-0000-4000-8000-000000000001',1000000,1150000,'SAT-POOL-BAD-WAIVER','pending','{"buy_in":1000000,"rake":100000,"service_fee":50000,"platform_fee":0,"waived_rake":"bad","total_pay":1150000}');

INSERT INTO public.cashier_buyin_movements
  (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
   amount,applied_amount,actor_id,idempotency_key)
SELECT 'a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',
       r.id,'a5000000-0000-4000-8000-000000000001','in','cash','buyin',
       CASE WHEN r.id='a4000000-0000-4000-8000-000000000005' THEN 1140000
            WHEN r.id='a4000000-0000-4000-8000-000000000001' THEN 1100000
            ELSE 1150000 END,
       CASE WHEN r.id='a4000000-0000-4000-8000-000000000005' THEN 1140000
            WHEN r.id='a4000000-0000-4000-8000-000000000001' THEN 1100000
            ELSE 1150000 END,
       'a1000000-0000-4000-8000-000000000001','sat-pool:buyin:'||r.id::text
FROM public.tournament_registrations r
WHERE r.id <> 'a4000000-0000-4000-8000-000000000004';
-- A pair of INSERTs proves aggregation without mutating append-only history.
INSERT INTO public.cashier_buyin_movements
  (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
   amount,applied_amount,actor_id,idempotency_key)
VALUES ('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001',
        'a4000000-0000-4000-8000-000000000001','a5000000-0000-4000-8000-000000000001',
        'in','cash','buyin',50000,50000,'a1000000-0000-4000-8000-000000000001',
        'sat-pool:buyin:second');

-- Match the Cashier write order: immutable receipt movements exist before
-- the paid marker and pending -> confirmed transition are written.
UPDATE public.tournament_registrations
SET cashier_paid_at=now(),status='confirmed',confirmed_at=now(),
    confirmed_by='a1000000-0000-4000-8000-000000000001'
WHERE id IN (
 'a4000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000002',
 'a4000000-0000-4000-8000-000000000003','a4000000-0000-4000-8000-000000000007',
 'a4000000-0000-4000-8000-000000000008','a4000000-0000-4000-8000-000000000009',
 'a4000000-0000-4000-8000-000000000010','a4000000-0000-4000-8000-000000000011');
-- Deliberately inconsistent test rows: payment exists but is short, and a
-- paid waiting refund has no confirmation marker and must remain pending.
UPDATE public.tournament_registrations SET cashier_paid_at=now()
WHERE id IN ('a4000000-0000-4000-8000-000000000005',
             'a4000000-0000-4000-8000-000000000006');

INSERT INTO public.tournament_entries
  (id,tournament_id,registration_id,player_id,entry_no,source,status)
VALUES
 ('a7000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000101',1,'online','registered'),
 ('a7000000-0000-4000-8000-000000000003','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000103',1,'online','registered'),
 ('a7000000-0000-4000-8000-000000000004','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000003','a1000000-0000-4000-8000-000000000103',2,'online','registered'),
 ('a7000000-0000-4000-8000-000000000005','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000005','a1000000-0000-4000-8000-000000000105',1,'online','registered'),
  ('a7000000-0000-4000-8000-000000000007','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000007','a1000000-0000-4000-8000-000000000107',1,'online','registered'),
  ('a7000000-0000-4000-8000-000000000008','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000008','a1000000-0000-4000-8000-000000000108',1,'online','registered'),
 ('a7000000-0000-4000-8000-000000000009','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000009','a1000000-0000-4000-8000-000000000109',1,'online','registered'),
  ('a7000000-0000-4000-8000-000000000010','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000010','a1000000-0000-4000-8000-000000000110',1,'online','registered'),
 ('a7000000-0000-4000-8000-000000000011','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000011','a1000000-0000-4000-8000-000000000111',1,'online','registered');

INSERT INTO public.cashier_refund_requests
  (id,club_id,tournament_id,registration_id,amount,status,reason,requested_by,paid_at)
VALUES
 ('a6000000-0000-4000-8000-000000000006','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000006',1150000,'paid','TEST reconciled full refund','a1000000-0000-4000-8000-000000000001',now()),
 ('a6000000-0000-4000-8000-000000000007','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000007',1149000,'paid','TEST mismatched refund request','a1000000-0000-4000-8000-000000000001',now()),
 ('a6000000-0000-4000-8000-000000000008','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000008',1150000,'paid','TEST mismatched refund movement','a1000000-0000-4000-8000-000000000001',now()),
 ('a6000000-0000-4000-8000-000000000009','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000009',1150000,'requested','TEST unpaid refund','a1000000-0000-4000-8000-000000000001',NULL),
 ('a6000000-0000-4000-8000-000000000010','a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000010',1150000,'paid','TEST uncleared active seat','a1000000-0000-4000-8000-000000000001',now());
INSERT INTO public.cashier_buyin_movements
  (club_id,tournament_id,registration_id,refund_id,shift_id,direction,method,purpose,
   amount,applied_amount,actor_id,idempotency_key)
VALUES
 ('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000006','a6000000-0000-4000-8000-000000000006','a5000000-0000-4000-8000-000000000001','out','cash','refund',1150000,1150000,'a1000000-0000-4000-8000-000000000001','sat-pool:refund:good'),
  ('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000007','a6000000-0000-4000-8000-000000000007','a5000000-0000-4000-8000-000000000001','out','cash','refund',1150000,1150000,'a1000000-0000-4000-8000-000000000001','sat-pool:refund:wrong-request'),
 ('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000008','a6000000-0000-4000-8000-000000000008','a5000000-0000-4000-8000-000000000001','out','cash','refund',1149000,1149000,'a1000000-0000-4000-8000-000000000001','sat-pool:refund:short'),
  ('a2000000-0000-4000-8000-000000000001','a3000000-0000-4000-8000-000000000001','a4000000-0000-4000-8000-000000000010','a6000000-0000-4000-8000-000000000010','a5000000-0000-4000-8000-000000000001','out','cash','refund',1150000,1150000,'a1000000-0000-4000-8000-000000000001','sat-pool:refund:active-seat');

-- Refund history is append-only: request and payout movements precede entry
-- and registration cancellation, exactly as cashier_complete_refund_v1 does.
UPDATE public.tournament_entries SET status='cancelled',current_stack=0
WHERE registration_id IN ('a4000000-0000-4000-8000-000000000007',
                           'a4000000-0000-4000-8000-000000000008',
                           'a4000000-0000-4000-8000-000000000010');
UPDATE public.tournament_registrations
SET status='cancelled',cancelled_at=now(),cancelled_by='a1000000-0000-4000-8000-000000000001',
    cancellation_reason='cashier_refund:'||CASE id
      WHEN 'a4000000-0000-4000-8000-000000000006' THEN 'a6000000-0000-4000-8000-000000000006'
      WHEN 'a4000000-0000-4000-8000-000000000007' THEN 'a6000000-0000-4000-8000-000000000007'
      WHEN 'a4000000-0000-4000-8000-000000000008' THEN 'a6000000-0000-4000-8000-000000000008'
      WHEN 'a4000000-0000-4000-8000-000000000010' THEN 'a6000000-0000-4000-8000-000000000010'
    END
WHERE id IN ('a4000000-0000-4000-8000-000000000006','a4000000-0000-4000-8000-000000000007',
             'a4000000-0000-4000-8000-000000000008','a4000000-0000-4000-8000-000000000010');

INSERT INTO public.tournament_seats(id,tournament_id,player_id,entry_number,table_id,seat_number,
                                    chip_count,is_active,status,entry_id)
VALUES
  ('a8000000-0000-4000-8000-000000000010','a3000000-0000-4000-8000-000000000001','a1000000-0000-4000-8000-000000000110',1,'a9000000-0000-4000-8000-000000000001',2,100,true,'active','a7000000-0000-4000-8000-000000000010');

DO $test$
DECLARE v jsonb;
BEGIN
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.satellite_assert(v->>'state'='READY'
    AND v->>'buy_in_vnd'='1000000' AND v->>'fee_vnd'='150000'
    AND NOT (v ? 'total_pay'), 'ready row returns frozen buy-in/fee after aggregate payment');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000002');
  PERFORM pg_temp.satellite_assert(v->>'state'='NOT_READY'
    AND v->>'reason'='entry_cardinality_mismatch', 'confirmed and paid row without entry is not ready');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000003');
  PERFORM pg_temp.satellite_assert(v->>'state'='NOT_READY'
    AND v->>'reason'='entry_cardinality_mismatch', 'duplicate matching entry is not ready');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000004');
  PERFORM pg_temp.satellite_assert(v->>'state'='NOT_READY'
    AND v->>'reason'='legacy_price_snapshot_missing', 'legacy row without server price snapshot is not ready');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000005');
  PERFORM pg_temp.satellite_assert(v->>'state'='NOT_READY'
    AND v->>'reason'='payment_movement_mismatch', 'paid markers with ledger below total pay are not ready');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000006');
  PERFORM pg_temp.satellite_assert(v->>'state'='REVERSED'
    AND NOT (v ? 'buy_in_vnd') AND NOT (v ? 'fee_vnd'),
    'fully refunded paid waiting registration is reversed with zero pool contribution');
  PERFORM pg_temp.satellite_assert(
    (SELECT status='cancelled' AND cashier_paid_at IS NOT NULL AND confirmed_at IS NULL
       AND NOT EXISTS (SELECT 1 FROM public.tournament_entries
                       WHERE registration_id='a4000000-0000-4000-8000-000000000006')
     FROM public.tournament_registrations
     WHERE id='a4000000-0000-4000-8000-000000000006'),
    'reversed waiting refund has paid marker, no confirmation, and no entry');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000007');
  PERFORM pg_temp.satellite_assert(v->>'state'='NOT_READY'
    AND v->>'reason'='refund_request_mismatch', 'paid refund request amount must equal total pay');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000008');
  PERFORM pg_temp.satellite_assert(v->>'state'='NOT_READY'
    AND v->>'reason'='refund_movement_mismatch', 'refund ledger aggregate must equal total pay');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000009');
  PERFORM pg_temp.satellite_assert(v->>'state'='NOT_READY'
    AND v->>'reason'='refund_unsettled', 'requested but unpaid refund is not ready');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000010');
  PERFORM pg_temp.satellite_assert(v->>'state'='NOT_READY'
    AND v->>'reason'='refund_seat_not_cleared', 'refunded registration with active seat is not reversed');
  v := private.satellite_registration_pool_row_v1('a4000000-0000-4000-8000-000000000011');
  PERFORM pg_temp.satellite_assert(v->>'state'='NOT_READY'
    AND v->>'reason'='price_snapshot_invalid', 'malformed waived rake is not defaulted');
  PERFORM pg_temp.satellite_assert(
    NOT has_function_privilege('anon','private.satellite_registration_pool_row_v1(uuid)','EXECUTE')
    AND NOT has_function_privilege('authenticated','private.satellite_registration_pool_row_v1(uuid)','EXECUTE')
    AND NOT has_function_privilege('service_role','private.satellite_registration_pool_row_v1(uuid)','EXECUTE'),
    'browser and service roles cannot execute internal classifier directly');
END;
$test$;

ROLLBACK;
