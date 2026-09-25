-- Disposable PG17 only: synthetic Cashier base + real pending Satellite chain.
-- Test-local trigger suspension seeds historical records while the production
-- Lock/Issue hold remains installed. Every DDL/DML change rolls back.
\set ON_ERROR_STOP on
BEGIN;

CREATE OR REPLACE FUNCTION pg_temp.sat_component_assert(ok boolean, label text)
RETURNS void LANGUAGE plpgsql AS $$ BEGIN
  IF ok IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Satellite frozen components: %', label;
  END IF;
END $$;

INSERT INTO auth.users(id) VALUES ('f1000000-0000-4000-8000-000000000001');
INSERT INTO public.clubs(id,owner_id)
VALUES ('f2000000-0000-4000-8000-000000000001','f1000000-0000-4000-8000-000000000001');
SELECT set_config('request.jwt.claim.sub','f1000000-0000-4000-8000-000000000001',true);
INSERT INTO public.tournaments
  (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,rake_amount,service_fee_amount,operations_mode)
VALUES
 ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',
  'Source SAT','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('f3000000-0000-4000-8000-000000000002','f2000000-0000-4000-8000-000000000001',
  'Target','scheduled','registering',now()+interval '3 day',6000000,10000,500000,100000,'standard'),
 ('f3000000-0000-4000-8000-000000000003','f2000000-0000-4000-8000-000000000001',
  'Historical source','registering','registering',now()+interval '2 day',1000000,10000,200000,0,'satellite');

-- There is no production bypass. These DDL changes are isolated to this test
-- transaction and immediately re-enabled after historical fixture seeding.
ALTER TABLE public.satellite_award_plans DISABLE TRIGGER satellite_preview_write_hold_v1;
INSERT INTO public.satellite_award_plans
  (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
   target_buy_in_vnd,target_fee_vnd,award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
VALUES ('f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002',
        'f2000000-0000-4000-8000-000000000001',6600000,
        1,6599999,'[{"position":1,"ticketCount":1,"cashVnd":"0"}]',1,0,6600000,
        'f1000000-0000-4000-8000-000000000001');
ALTER TABLE public.satellite_award_plans ENABLE TRIGGER satellite_preview_write_hold_v1;
SELECT pg_temp.sat_component_assert(
  (SELECT target_buy_in_vnd=6000000 AND target_fee_vnd=600000
     AND target_entry_price_vnd=target_buy_in_vnd+target_fee_vnd
   FROM public.satellite_award_plans
   WHERE source_tournament_id='f3000000-0000-4000-8000-000000000001'),
  'plan snapshots server target 6m buy-in plus 0.6m fees, ignoring forged client split');

ALTER TABLE public.satellite_award_issues DISABLE TRIGGER satellite_preview_write_hold_v1;
INSERT INTO public.satellite_award_issues
  (source_tournament_id,club_id,locked_results,ticket_total,cash_total_vnd,issued_by)
VALUES ('f3000000-0000-4000-8000-000000000001','f2000000-0000-4000-8000-000000000001',
        '[{"position":1,"playerId":"f1000000-0000-4000-8000-000000000001","ticketCount":1,"cashVnd":"0"}]',
        1,0,'f1000000-0000-4000-8000-000000000001');
ALTER TABLE public.satellite_award_issues ENABLE TRIGGER satellite_preview_write_hold_v1;
ALTER TABLE public.satellite_tickets DISABLE TRIGGER satellite_preview_write_hold_v1;
INSERT INTO public.satellite_tickets
  (source_tournament_id,target_tournament_id,club_id,serial_no,award_position,
   winner_player_id,target_entry_price_vnd,target_buy_in_vnd,target_fee_vnd)
VALUES ('f3000000-0000-4000-8000-000000000001','f3000000-0000-4000-8000-000000000002',
        'f2000000-0000-4000-8000-000000000001',1,1,
        'f1000000-0000-4000-8000-000000000001',6600000,1,6599999);
ALTER TABLE public.satellite_tickets ENABLE TRIGGER satellite_preview_write_hold_v1;
SELECT pg_temp.sat_component_assert(
  (SELECT target_buy_in_vnd=6000000 AND target_fee_vnd=600000
     AND target_entry_price_vnd=target_buy_in_vnd+target_fee_vnd
   FROM public.satellite_tickets
   WHERE source_tournament_id='f3000000-0000-4000-8000-000000000001'),
  'issued ticket copies frozen plan split, not caller values');

DO $$ BEGIN
  BEGIN
    -- Even a same-total redistribution must not rewrite history.
    UPDATE public.tournaments SET buy_in=6100000,rake_amount=400000
      WHERE id='f3000000-0000-4000-8000-000000000002';
    RAISE EXCEPTION 'Target price components changed after lock';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_locked_economics_immutable%' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.sat_component_assert(
    (SELECT buy_in=6000000 AND rake_amount=500000 AND service_fee_amount=100000
       FROM public.tournaments WHERE id='f3000000-0000-4000-8000-000000000002'),
    'target price change rejected');
  PERFORM pg_temp.sat_component_assert(
    (SELECT p.target_buy_in_vnd=6000000 AND p.target_fee_vnd=600000
            AND t.target_buy_in_vnd=6000000 AND t.target_fee_vnd=600000
       FROM public.satellite_award_plans p
       JOIN public.satellite_tickets t USING (source_tournament_id)
       WHERE p.source_tournament_id='f3000000-0000-4000-8000-000000000001'),
    'historical plan and ticket components remain frozen');
  BEGIN
    UPDATE public.satellite_award_plans SET target_fee_vnd=700000
      WHERE source_tournament_id='f3000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Plan components changed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_frozen_target_components_immutable%' THEN RAISE; END IF;
  END;
END $$;
ALTER TABLE public.satellite_tickets DISABLE TRIGGER satellite_preview_write_hold_v1;
DO $$ BEGIN
  BEGIN
    UPDATE public.satellite_tickets SET target_buy_in_vnd=5900000
      WHERE source_tournament_id='f3000000-0000-4000-8000-000000000001';
    RAISE EXCEPTION 'Ticket components changed';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_frozen_target_components_immutable%' THEN RAISE; END IF;
  END;
END $$;
ALTER TABLE public.satellite_tickets ENABLE TRIGGER satellite_preview_write_hold_v1;

-- Historical total-only plan has unknown split. It is never backfilled from
-- the current target price, and the ticket insert path rejects it.
ALTER TABLE public.satellite_award_plans DISABLE TRIGGER satellite_preview_write_hold_v1;
ALTER TABLE public.satellite_award_plans DISABLE TRIGGER satellite_capture_target_components_v1;
INSERT INTO public.satellite_award_plans
  (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
   award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
VALUES ('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000002',
        'f2000000-0000-4000-8000-000000000001',6600000,
        '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',1,0,6600000,
        'f1000000-0000-4000-8000-000000000001');
ALTER TABLE public.satellite_award_plans ENABLE TRIGGER satellite_capture_target_components_v1;
ALTER TABLE public.satellite_award_plans ENABLE TRIGGER satellite_preview_write_hold_v1;
SELECT pg_temp.sat_component_assert(
  (SELECT target_buy_in_vnd IS NULL AND target_fee_vnd IS NULL
   FROM public.satellite_award_plans
   WHERE source_tournament_id='f3000000-0000-4000-8000-000000000003'),
  'historical unknown split remains unknown');

ALTER TABLE public.satellite_award_issues DISABLE TRIGGER satellite_preview_write_hold_v1;
INSERT INTO public.satellite_award_issues
  (source_tournament_id,club_id,locked_results,ticket_total,cash_total_vnd,issued_by)
VALUES ('f3000000-0000-4000-8000-000000000003','f2000000-0000-4000-8000-000000000001',
        '[]',1,0,'f1000000-0000-4000-8000-000000000001');
ALTER TABLE public.satellite_award_issues ENABLE TRIGGER satellite_preview_write_hold_v1;
ALTER TABLE public.satellite_tickets DISABLE TRIGGER satellite_preview_write_hold_v1;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.satellite_tickets
      (source_tournament_id,target_tournament_id,club_id,serial_no,award_position,
       winner_player_id,target_entry_price_vnd)
    VALUES ('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000002',
            'f2000000-0000-4000-8000-000000000001',1,1,
            'f1000000-0000-4000-8000-000000000001',6600000);
    RAISE EXCEPTION 'Unknown historical split issued a ticket';
  EXCEPTION WHEN check_violation THEN
    IF SQLERRM NOT LIKE '%satellite_ticket_frozen_components_required%' THEN RAISE; END IF;
  END;
END $$;
ALTER TABLE public.satellite_tickets ENABLE TRIGGER satellite_preview_write_hold_v1;

-- Exercise invalid component values through the actual bigint price columns.
INSERT INTO public.tournaments
  (id,club_id,name,status,live_status,start_time,buy_in,starting_stack,rake_amount,service_fee_amount,operations_mode)
VALUES
 ('f3000000-0000-4000-8000-000000000004','f2000000-0000-4000-8000-000000000001',
  'Negative fee component target','scheduled','registering',now()+interval '4 day',6000000,10000,-1,600001,'standard'),
 ('f3000000-0000-4000-8000-000000000005','f2000000-0000-4000-8000-000000000001',
  'Invalid component test source','registering','registering',now()+interval '1 day',1000000,10000,200000,0,'satellite'),
 ('f3000000-0000-4000-8000-000000000006','f2000000-0000-4000-8000-000000000001',
  'Mismatched total target','scheduled','registering',now()+interval '5 day',6000000,10000,500000,100000,'standard');
ALTER TABLE public.satellite_award_plans DISABLE TRIGGER satellite_preview_write_hold_v1;
DO $$ BEGIN
  BEGIN
    INSERT INTO public.satellite_award_plans
      (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
       award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
    VALUES ('f3000000-0000-4000-8000-000000000005','f3000000-0000-4000-8000-000000000004',
            'f2000000-0000-4000-8000-000000000001',6600000,
            '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',1,0,6600000,
            'f1000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Negative fee component entered a plan';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%satellite_target_component_price_mismatch%' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.sat_component_assert(NOT EXISTS (
    SELECT 1 FROM public.satellite_award_plans
    WHERE source_tournament_id='f3000000-0000-4000-8000-000000000005'),
    'negative fee component fails closed');
  BEGIN
    INSERT INTO public.satellite_award_plans
      (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
       award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
    VALUES ('f3000000-0000-4000-8000-000000000005','f3000000-0000-4000-8000-000000000006',
            'f2000000-0000-4000-8000-000000000001',6600001,
            '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',1,0,6600001,
            'f1000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Mismatched target total entered a plan';
  EXCEPTION WHEN invalid_parameter_value THEN
    IF SQLERRM NOT LIKE '%satellite_target_component_price_mismatch%' THEN RAISE; END IF;
  END;
  PERFORM pg_temp.sat_component_assert(NOT EXISTS (
    SELECT 1 FROM public.satellite_award_plans
    WHERE source_tournament_id='f3000000-0000-4000-8000-000000000005'),
    'mismatched total fails closed');
END $$;
ALTER TABLE public.satellite_award_plans ENABLE TRIGGER satellite_preview_write_hold_v1;

-- The test never changes the default-OFF release gate or permanently disables
-- any hold. Verify both are still closed before rollback.
SELECT pg_temp.sat_component_assert(
  (SELECT enabled=false FROM public.centerpoint_tournament_ops_release WHERE id),
  'Centerpoint gate still default off');
DO $$ BEGIN
  BEGIN
    INSERT INTO public.satellite_award_plans
      (source_tournament_id,target_tournament_id,club_id,target_entry_price_vnd,
       award_lines,ticket_total,cash_total_vnd,total_liability_vnd,locked_by)
    VALUES ('f3000000-0000-4000-8000-000000000003','f3000000-0000-4000-8000-000000000002',
            'f2000000-0000-4000-8000-000000000001',6600000,
            '[{"position":1,"ticketCount":1,"cashVnd":"0"}]',1,0,6600000,
            'f1000000-0000-4000-8000-000000000001');
    RAISE EXCEPTION 'Normal Lock write unexpectedly opened';
  EXCEPTION WHEN raise_exception THEN
    IF SQLERRM NOT LIKE '%CENTERPOINT_TOURNAMENT_OPS_RELEASE_CLOSED%' THEN RAISE; END IF;
  END;
END $$;
ROLLBACK;
