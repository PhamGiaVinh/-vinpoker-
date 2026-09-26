-- Rollback-only PG17 golden Lock contracts: 33/34 real Cashier receipts,
-- separate source fees, rank-six cash, and an explicit unfunded GTD6 plan.
\set ON_ERROR_STOP on
BEGIN;
CREATE OR REPLACE FUNCTION pg_temp.sat_golden_assert(ok boolean,label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN RAISE EXCEPTION 'satellite Lock golden: %',label; END IF;
END $$;
CREATE OR REPLACE FUNCTION pg_temp.sat_golden_tickets(n integer)
RETURNS jsonb LANGUAGE sql AS $$
  SELECT jsonb_agg(jsonb_build_object('position',g,'ticketCount',1,'cashVnd','0') ORDER BY g)
  FROM generate_series(1,n) g;
$$;
INSERT INTO auth.users(id) VALUES ('aa000000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id)
VALUES ('ab000000-0000-4000-8000-000000000001',
        'aa000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','aa000000-0000-4000-8000-000000000001',true);
INSERT INTO public.tournaments
 (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,
  rake_amount,service_fee_amount,operations_mode)
VALUES
 ('ac000000-0000-4000-8000-000000000001','ab000000-0000-4000-8000-000000000001',
  'Gold 33','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('ac000000-0000-4000-8000-000000000002','ab000000-0000-4000-8000-000000000001',
  'Gold 34','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('ac000000-0000-4000-8000-000000000003','ab000000-0000-4000-8000-000000000001',
  'Gold GTD6','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('ac000000-0000-4000-8000-000000000004','ab000000-0000-4000-8000-000000000001',
  'Gold target','live','registering',now()+interval '3 day',6000000,10000,500000,100000,'standard');
INSERT INTO public.cashier_till_shifts(id,club_id,opening_cash,opened_by)
VALUES ('ad000000-0000-4000-8000-000000000001',
        'ab000000-0000-4000-8000-000000000001',0,
        'aa000000-0000-4000-8000-000000000001');
INSERT INTO public.tournament_registrations
 (id,tournament_id,player_id,club_id,buy_in,total_pay,reference_code,status,price_snapshot)
SELECT ('ae000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       ('ac000000-0000-4000-8000-00000000000'||
        CASE WHEN g<=33 THEN '1' WHEN g<=67 THEN '2' ELSE '3' END)::uuid,
       ('aa000000-0000-4000-8000-'||lpad((g+100)::text,12,'0'))::uuid,
       'ab000000-0000-4000-8000-000000000001',1000000,1200000,
       'SAT-LOCK-GOLD-'||g,'pending',
       '{"buy_in":1000000,"rake":200000,"service_fee":0,"platform_fee":0,"waived_rake":0,"total_pay":1200000}'::jsonb
FROM generate_series(1,100) g;
INSERT INTO public.cashier_buyin_movements
 (club_id,tournament_id,registration_id,shift_id,direction,method,purpose,
  amount,applied_amount,actor_id,idempotency_key)
SELECT r.club_id,r.tournament_id,r.id,'ad000000-0000-4000-8000-000000000001',
       'in','cash','buyin',1200000,1200000,
       'aa000000-0000-4000-8000-000000000001','sat-golden:'||r.id
FROM public.tournament_registrations r WHERE r.reference_code LIKE 'SAT-LOCK-GOLD-%';
UPDATE public.tournament_registrations
SET cashier_paid_at=now(),status='confirmed',confirmed_at=now(),
    confirmed_by='aa000000-0000-4000-8000-000000000001'
WHERE reference_code LIKE 'SAT-LOCK-GOLD-%';
INSERT INTO public.tournament_entries
 (id,tournament_id,registration_id,player_id,entry_no,source,status)
SELECT ('af000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid,
       r.tournament_id,r.id,r.player_id,1,'online','registered'
FROM generate_series(1,100) g JOIN public.tournament_registrations r
  ON r.id=('ae000000-0000-4000-8000-'||lpad(g::text,12,'0'))::uuid;
UPDATE public.tournaments SET registration_closed_at=now()
WHERE id IN ('ac000000-0000-4000-8000-000000000001',
             'ac000000-0000-4000-8000-000000000002',
             'ac000000-0000-4000-8000-000000000003');
UPDATE public.centerpoint_tournament_ops_release
SET enabled=true,allowed_club_ids=ARRAY['ab000000-0000-4000-8000-000000000001']::uuid[]
WHERE id=true;
DO $$ DECLARE p jsonb; a jsonb; r jsonb; s uuid; BEGIN
  a:=pg_temp.sat_golden_tickets(5);
  s:='ac000000-0000-4000-8000-000000000001';
  p:=public.satellite_source_funding_preview_v2(s,
    'ac000000-0000-4000-8000-000000000004',a);
  PERFORM pg_temp.sat_golden_assert(p->>'state'='READY'
    AND p->>'sourcePoolVnd'='33000000' AND p->>'feeVnd'='6600000'
    AND p->>'obligationShortfallVnd'='0','33 receipts separate fees');
  r:=public.satellite_lock_award_plan_v1(s,
    'ac000000-0000-4000-8000-000000000004',a,p->>'previewRevision',
    'a1000000-0000-4000-8000-000000000001');
  PERFORM pg_temp.sat_golden_assert(r->>'locked'='true' AND
    (SELECT target_buy_in_vnd=6000000 AND target_fee_vnd=600000
      AND source_pool_vnd=33000000 AND source_fee_vnd=6600000
      FROM public.satellite_award_plans WHERE source_tournament_id=s),
    '33 Lock frozen components and source audit');
  a:=pg_temp.sat_golden_tickets(5) ||
    '[{"position":6,"ticketCount":0,"cashVnd":"1000000"}]'::jsonb;
  s:='ac000000-0000-4000-8000-000000000002';
  p:=public.satellite_source_funding_preview_v2(s,
    'ac000000-0000-4000-8000-000000000004',a);
  PERFORM pg_temp.sat_golden_assert(p->>'state'='READY'
    AND p->>'sourcePoolVnd'='34000000' AND p->>'feeVnd'='6800000'
    AND p->'awardPlan'->>'totalLiabilityVnd'='34000000'
    AND p->>'obligationShortfallVnd'='0','34 receipts and rank-six cash');
  r:=public.satellite_lock_award_plan_v1(s,
    'ac000000-0000-4000-8000-000000000004',a,p->>'previewRevision',
    'a1000000-0000-4000-8000-000000000002');
  PERFORM pg_temp.sat_golden_assert(r->>'locked'='true' AND
    (SELECT cash_total_vnd=1000000 AND source_pool_vnd=34000000
      FROM public.satellite_award_plans WHERE source_tournament_id=s),
    '34 Lock cash obligation');
  a:=pg_temp.sat_golden_tickets(6);
  s:='ac000000-0000-4000-8000-000000000003';
  p:=public.satellite_source_funding_preview_v2(s,
    'ac000000-0000-4000-8000-000000000004',a);
  PERFORM pg_temp.sat_golden_assert(p->>'sourcePoolVnd'='33000000'
    AND p->>'ticketShortfallVnd'='6600000'
    AND p->>'obligationShortfallVnd'='6600000','GTD6 shortfall is not overlay');
  r:=public.satellite_lock_award_plan_v1(s,
    'ac000000-0000-4000-8000-000000000004',a,p->>'previewRevision',
    'a1000000-0000-4000-8000-000000000003');
  PERFORM pg_temp.sat_golden_assert(r->>'locked'='true' AND
    (SELECT funding_state='INSUFFICIENT_FUNDS'
      AND obligation_shortfall_vnd=6600000
      FROM public.satellite_award_plans WHERE source_tournament_id=s),
    'GTD6 liability locked as unfunded with Issue still held');
END $$;
ROLLBACK;
