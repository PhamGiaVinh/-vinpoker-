\set ON_ERROR_STOP on
-- Isolated minimal fixture only, NOT schema/RLS parity evidence.
CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid LANGUAGE sql AS $$ SELECT '10000000-0000-4000-8000-000000000001'::uuid $$;
CREATE FUNCTION auth.jwt() RETURNS jsonb LANGUAGE sql AS $$ SELECT '{"role":"authenticated"}'::jsonb $$;
CREATE TABLE public.tournaments(id uuid PRIMARY KEY,club_id uuid);
CREATE TABLE public.tournament_hands(id uuid PRIMARY KEY,tournament_id uuid,table_id uuid,status text,locked_by_user_id uuid,locked_at timestamptz,community_cards jsonb,updated_at timestamptz);
CREATE TABLE public.hand_players(id uuid PRIMARY KEY,hand_id uuid,player_id uuid,entry_number int,hole_cards jsonb);
CREATE TABLE public.dealers(id uuid,user_id uuid,club_id uuid);
CREATE TABLE public.dealer_assignments(dealer_id uuid,table_id uuid,status text,released_at timestamptz);
CREATE TABLE public.tournament_tables(id uuid,table_id uuid,tournament_id uuid);
CREATE FUNCTION public.is_club_tracker(uuid,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT true $$;
CREATE FUNCTION public.tracker_lock_blocks(uuid,timestamptz,uuid) RETURNS boolean LANGUAGE sql AS $$ SELECT false $$;
CREATE FUNCTION public.tracker_lock_ttl() RETURNS interval LANGUAGE sql AS $$ SELECT interval '5 minutes' $$;
CREATE FUNCTION public.validate_cards(p_cards jsonb) RETURNS text LANGUAGE plpgsql IMMUTABLE AS $$
BEGIN
 IF p_cards IS NULL OR p_cards='[]'::jsonb THEN RETURN 'ok'; END IF;
 IF EXISTS(SELECT 1 FROM jsonb_array_elements_text(p_cards) c WHERE c !~ '^[AKQJT2-9][shdc]$') THEN RETURN 'Invalid card format'; END IF;
 IF jsonb_array_length(p_cards)<>(SELECT count(DISTINCT val) FROM jsonb_array_elements_text(p_cards) val) THEN RETURN 'Duplicate cards in array'; END IF;
 RETURN 'ok';
END $$;
INSERT INTO tournaments VALUES('10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000020');
INSERT INTO tournament_hands VALUES('10000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000010','10000000-0000-4000-8000-000000000040','in_progress',auth.uid(),now(),'[]',now());
INSERT INTO hand_players VALUES
 ('10000000-0000-4000-8000-000000000050','10000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000060',1,'[]'),
 ('10000000-0000-4000-8000-000000000051','10000000-0000-4000-8000-000000000030','10000000-0000-4000-8000-000000000061',1,'[]');
