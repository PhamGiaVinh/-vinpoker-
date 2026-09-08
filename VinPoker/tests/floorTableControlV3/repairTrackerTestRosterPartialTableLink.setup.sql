\set ON_ERROR_STOP on
UPDATE public.tournaments SET name='TEST — Felt UAT (compact)',status='active' WHERE id='00000000-0000-0000-0000-000000000109';
UPDATE public.table_sessions SET control_mode='tracker',closed_at=NULL WHERE id='00000000-0000-0000-0000-000000000630';
DELETE FROM public.tournament_hands WHERE id IN ('00000000-0000-0000-0000-000000009951','00000000-0000-0000-0000-000000009952');
DELETE FROM public.tournament_seats WHERE id='00000000-0000-0000-0000-000000009999';
UPDATE public.tournament_seats s SET
  table_id='00000000-0000-0000-0000-000000000730',tournament_table_id=NULL,
  table_session_id='00000000-0000-0000-0000-000000000630',entry_id=e.id,
  player_name='Test '||s.seat_number,chip_count=2000000,is_active=true,status='active'
FROM public.tournament_entries e
WHERE s.tournament_id='00000000-0000-0000-0000-000000000109'
  AND e.seat_id=s.id AND e.player_id=s.player_id AND e.entry_no=1;
INSERT INTO public.game_tables (id,club_id,table_name,table_number,operational_status)
VALUES ('00000000-0000-0000-0000-000000009530','00000000-0000-0000-0000-000000000010','Bàn khác',56,'available') ON CONFLICT (id) DO NOTHING;
INSERT INTO public.table_sessions (id,club_id,game_table_id,session_type,tournament_id,control_mode,control_epoch,revision)
VALUES ('00000000-0000-0000-0000-000000009630','00000000-0000-0000-0000-000000000010','00000000-0000-0000-0000-000000009530','tournament','00000000-0000-0000-0000-000000000109','tracker',1,1)
ON CONFLICT (id) DO UPDATE SET closed_at=NULL,control_mode='tracker';
INSERT INTO public.tournament_tables (id,tournament_id,game_table_id,table_session_id,table_number,max_seats,status)
VALUES ('00000000-0000-0000-0000-000000009730','00000000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000009530','00000000-0000-0000-0000-000000009630',56,9,'active')
ON CONFLICT (id) DO UPDATE SET status='active';
INSERT INTO public.tournament_hands (id,tournament_id,table_id,tournament_table_id,table_session_id,status,is_voided)
VALUES ('00000000-0000-0000-0000-000000009952','00000000-0000-0000-0000-000000000109','00000000-0000-0000-0000-000000009730','00000000-0000-0000-0000-000000009730','00000000-0000-0000-0000-000000009630','in_progress',false);
