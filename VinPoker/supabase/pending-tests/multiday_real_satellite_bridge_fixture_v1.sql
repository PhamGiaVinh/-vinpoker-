-- Disposable bridge on the REAL #1344 Cashier/Satellite migration chain.
-- The Satellite Redeem RPC creates target registrations, seats and transfer
-- rows. Only Multi-day qualification/Final Day state is fixture-owned here;
-- this is not a full combined production migration replay.
ALTER TABLE public.tournaments ADD COLUMN phase text;
ALTER TABLE public.tournament_entries ADD COLUMN finished_place integer;
ALTER TABLE public.tournament_prize_payments
 ADD COLUMN recipient_ref uuid,ADD COLUMN prize_amount numeric(12,2);
CREATE TABLE public.tournament_events(id uuid PRIMARY KEY,club_id uuid NOT NULL,
 final_tournament_id uuid NOT NULL);
CREATE TABLE public.tournament_prizes(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL,position integer NOT NULL,amount numeric(12,2) NOT NULL);
CREATE TABLE public.multi_day_package_release_v1(id boolean PRIMARY KEY,
 enabled boolean NOT NULL,allowed_club_ids uuid[] NOT NULL);
CREATE TABLE public.multi_day_flight_ends_v1(flight_tournament_id uuid PRIMARY KEY,
 event_id uuid NOT NULL,status text NOT NULL);
CREATE TABLE public.multi_day_qualification_rules_v1(event_id uuid PRIMARY KEY,
 club_id uuid NOT NULL,final_tournament_id uuid NOT NULL,policy text NOT NULL,
 itm_percent numeric NOT NULL,min_cash_x numeric NOT NULL,buy_in_vnd bigint NOT NULL,
 rake_vnd bigint NOT NULL);
CREATE TABLE public.multi_day_qualification_locks_v1(event_id uuid PRIMARY KEY,
 source_hash text NOT NULL,selection_hash text NOT NULL,flight_ids uuid[] NOT NULL);
CREATE TABLE public.multi_day_final_participations_v1(id uuid PRIMARY KEY,
 event_id uuid NOT NULL,player_id uuid NOT NULL,source_bags jsonb NOT NULL,
 policy text NOT NULL,participation_floor_vnd numeric NOT NULL);
CREATE TABLE public.multi_day_final_seatings_v1(participation_id uuid PRIMARY KEY,
 seed_revision integer NOT NULL,seed_stack bigint NOT NULL,entry_id uuid NOT NULL);
CREATE TABLE public.multi_day_nonselected_min_cash_v1(participation_id uuid,
 amount_vnd numeric,status text);
CREATE TABLE public.multi_day_final_adjustments_v1(participation_id uuid);
CREATE FUNCTION private.multi_day_qualification_immutable_v1()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 RAISE EXCEPTION 'multi_day_qualification_immutable' USING ERRCODE='23514';
END $$;

INSERT INTO public.multi_day_package_release_v1
 VALUES(true,true,ARRAY['d2000000-0000-4000-8000-000000000011']::uuid[]);
INSERT INTO public.tournament_events(id,club_id,final_tournament_id)
VALUES('e3000000-0000-4000-8000-000000000011',
 'd2000000-0000-4000-8000-000000000011',
 'd3000000-0000-4000-8000-000000000019');
UPDATE public.tournaments SET event_id='e3000000-0000-4000-8000-000000000011',
 phase='flight' WHERE id='d3000000-0000-4000-8000-000000000012';
INSERT INTO public.tournaments(id,club_id,name,status,live_status,start_time,
 buy_in,starting_stack,rake_amount,service_fee_amount,operations_mode,event_id,phase)
VALUES('d3000000-0000-4000-8000-000000000019',
 'd2000000-0000-4000-8000-000000000011','Integration Final Day',
 'live','registering',now()+interval '4 days',0,10000,0,0,'standard',
 'e3000000-0000-4000-8000-000000000011','final');
INSERT INTO public.multi_day_flight_ends_v1 VALUES(
 'd3000000-0000-4000-8000-000000000012',
 'e3000000-0000-4000-8000-000000000011','locked');
INSERT INTO public.multi_day_qualification_rules_v1 VALUES(
 'e3000000-0000-4000-8000-000000000011',
 'd2000000-0000-4000-8000-000000000011',
 'd3000000-0000-4000-8000-000000000019','SUM_STACKS',100,0,6000000,500000);
INSERT INTO public.multi_day_qualification_locks_v1 VALUES(
 'e3000000-0000-4000-8000-000000000011',md5('source'),md5('selection'),
 ARRAY['d3000000-0000-4000-8000-000000000012']::uuid[]);
INSERT INTO public.multi_day_final_participations_v1 VALUES
 ('e4000000-0000-4000-8000-000000000013',
  'e3000000-0000-4000-8000-000000000011',
  'd1000000-0000-4000-8000-000000000013','[]','SUM_STACKS',0),
 ('e4000000-0000-4000-8000-000000000014',
  'e3000000-0000-4000-8000-000000000011',
  'd1000000-0000-4000-8000-000000000014','[]','SUM_STACKS',0);
INSERT INTO public.tournament_entries(id,tournament_id,player_id,entry_no,status,
 current_stack,finished_place)
VALUES('e5000000-0000-4000-8000-000000000013',
  'd3000000-0000-4000-8000-000000000019',
  'd1000000-0000-4000-8000-000000000013',1,'seated',10000,1),
 ('e5000000-0000-4000-8000-000000000014',
  'd3000000-0000-4000-8000-000000000019',
  'd1000000-0000-4000-8000-000000000014',1,'seated',10000,2);
INSERT INTO public.multi_day_final_seatings_v1 VALUES
 ('e4000000-0000-4000-8000-000000000013',0,10000,
  'e5000000-0000-4000-8000-000000000013'),
 ('e4000000-0000-4000-8000-000000000014',0,10000,
  'e5000000-0000-4000-8000-000000000014');
INSERT INTO public.tournament_prizes(tournament_id,position,amount)
VALUES('d3000000-0000-4000-8000-000000000019',1,6000000),
 ('d3000000-0000-4000-8000-000000000019',2,6000000);
