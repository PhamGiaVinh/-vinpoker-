-- Disposable PG17 fixture extension, not a live or full Floor schema replay.
-- Columns below mirror the confirmed live entry/seat/draw contracts consumed
-- by migration 03. Earlier End Flight/qualification tests run before this.
ALTER TABLE public.tournaments ADD COLUMN status text NOT NULL DEFAULT 'scheduled',
 ADD COLUMN registration_closed_at timestamptz;
ALTER TABLE public.tournament_entries ADD COLUMN registration_id uuid,
 ADD COLUMN source text NOT NULL DEFAULT 'staff',
 ADD COLUMN current_stack integer NOT NULL DEFAULT 0,
 ADD COLUMN table_id uuid,ADD COLUMN seat_id uuid,
 ADD COLUMN seat_number integer,ADD COLUMN seated_at timestamptz;
ALTER TABLE public.tournament_tables ADD COLUMN table_id uuid,
 ADD COLUMN table_number integer,ADD COLUMN max_seats integer NOT NULL DEFAULT 9,
 ADD COLUMN status text NOT NULL DEFAULT 'active';
ALTER TABLE public.table_sessions ADD COLUMN game_table_id uuid;
ALTER TABLE public.tournament_seats ADD COLUMN table_id uuid,
 ADD COLUMN chip_count integer NOT NULL DEFAULT 0,
 ADD COLUMN status text NOT NULL DEFAULT 'active',
 ADD COLUMN player_name text,ADD COLUMN assigned_by uuid,
 ADD COLUMN assigned_at timestamptz;
CREATE TABLE public.seat_draw_receipts(id uuid PRIMARY KEY,tournament_id uuid NOT NULL,
 entry_id uuid NOT NULL,player_id uuid NOT NULL,display_name text NOT NULL,
 table_id uuid NOT NULL,table_number integer NOT NULL,seat_id uuid NOT NULL,
 seat_number integer NOT NULL,receipt_code text NOT NULL UNIQUE,
 qr_payload jsonb NOT NULL,draw_type text NOT NULL,status text NOT NULL,
 issued_by uuid NOT NULL);
CREATE TABLE public.seat_assignment_history(id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL,entry_id uuid NOT NULL,player_id uuid NOT NULL,
 to_table_id uuid NOT NULL,to_table_number integer NOT NULL,
 to_seat_number integer NOT NULL,reason text NOT NULL,draw_type text NOT NULL,
 actor_user_id uuid NOT NULL,metadata jsonb);
CREATE FUNCTION public.fixture_assert_registration_open()
RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN
 IF EXISTS(SELECT 1 FROM public.tournaments WHERE id=NEW.tournament_id
   AND registration_closed_at IS NOT NULL) THEN
   RAISE EXCEPTION 'registration_closed';
 END IF;
 RETURN NEW;
END $$;
CREATE TRIGGER fixture_assert_registration_open BEFORE INSERT ON public.tournament_entries
 FOR EACH ROW EXECUTE FUNCTION public.fixture_assert_registration_open();
INSERT INTO public.table_sessions(id,tournament_id,revision,game_table_id) VALUES
 ('70000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000008',0,'e0000000-0000-0000-0000-000000000008'),
 ('70000000-0000-0000-0000-00000000000b','40000000-0000-0000-0000-00000000000b',0,'e0000000-0000-0000-0000-00000000000b'),
 ('70000000-0000-0000-0000-00000000000d','40000000-0000-0000-0000-00000000000d',0,'e0000000-0000-0000-0000-00000000000d');
INSERT INTO public.tournament_tables(id,tournament_id,table_session_id,table_id,
 table_number,max_seats,status) VALUES
 ('80000000-0000-0000-0000-000000000008','40000000-0000-0000-0000-000000000008','70000000-0000-0000-0000-000000000008','e0000000-0000-0000-0000-000000000008',1,9,'active'),
 ('80000000-0000-0000-0000-00000000000b','40000000-0000-0000-0000-00000000000b','70000000-0000-0000-0000-00000000000b','e0000000-0000-0000-0000-00000000000b',1,9,'active'),
 ('80000000-0000-0000-0000-00000000000d','40000000-0000-0000-0000-00000000000d','70000000-0000-0000-0000-00000000000d','e0000000-0000-0000-0000-00000000000d',1,9,'active');
