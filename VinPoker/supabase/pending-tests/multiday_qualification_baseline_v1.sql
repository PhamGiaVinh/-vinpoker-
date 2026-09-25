-- Disposable extension of the exact live-confirmed event/legacy qualifier
-- columns used by the forward migration. No historical migration replay.
ALTER TABLE public.tournament_events
 ADD COLUMN itm_percent numeric NOT NULL DEFAULT 50,
 ADD COLUMN buy_in integer DEFAULT 1000000,
 ADD COLUMN rake_amount integer DEFAULT 100000;
CREATE TABLE public.tournament_registrations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 player_id uuid NOT NULL);
CREATE TABLE public.tournament_event_qualifiers(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 event_id uuid NOT NULL REFERENCES public.tournament_events(id),
 flight_tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 final_tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 club_id uuid NOT NULL REFERENCES public.clubs(id),
 player_id uuid NOT NULL,
 carried_stack integer NOT NULL DEFAULT 0,
 UNIQUE(flight_tournament_id,player_id));
-- The two legacy public entry points are represented by their actual write
-- seams here. Production function bodies are NOT replaced by this fixture.
CREATE FUNCTION public.advance_flight_qualifiers(p_flight_id uuid,p_player_ids uuid[])
RETURNS jsonb LANGUAGE plpgsql AS $$
DECLARE v_pid uuid;
BEGIN
 FOREACH v_pid IN ARRAY p_player_ids LOOP
   INSERT INTO public.tournament_event_qualifiers
     (event_id,flight_tournament_id,final_tournament_id,club_id,player_id,carried_stack)
   SELECT t.event_id,t.id,e.final_tournament_id,t.club_id,v_pid,1
   FROM public.tournaments t JOIN public.tournament_events e ON e.id=t.event_id
   WHERE t.id=p_flight_id
   ON CONFLICT(flight_tournament_id,player_id) DO UPDATE
     SET carried_stack=EXCLUDED.carried_stack;
 END LOOP;
 RETURN '{"ok":true}'::jsonb;
END $$;
