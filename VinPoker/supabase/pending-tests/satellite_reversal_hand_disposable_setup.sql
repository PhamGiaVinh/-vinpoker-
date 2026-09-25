-- Disposable PG17 only: Tracker tables used by the real reversal safety gate.
-- Matches the relevant shape of 20260608000001_tournament_live_tracker.sql.
CREATE TABLE public.tournament_hands (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 table_id uuid NOT NULL REFERENCES public.game_tables(id),
 hand_number integer NOT NULL,
 hand_time timestamptz NOT NULL DEFAULT now(),
 side_pots jsonb DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.hand_players (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 player_id uuid NOT NULL,
 entry_number integer NOT NULL DEFAULT 1,
 seat_number integer NOT NULL,
 starting_stack integer NOT NULL,
 ending_stack integer NOT NULL,
 is_eliminated boolean NOT NULL DEFAULT false,
 side_pots jsonb DEFAULT '[]'::jsonb,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.hand_actions (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 hand_id uuid NOT NULL REFERENCES public.tournament_hands(id),
 player_id uuid NOT NULL,
 entry_number integer NOT NULL DEFAULT 1,
 action_type text NOT NULL,
 action_amount integer DEFAULT 0,
 action_order integer NOT NULL,
 created_at timestamptz NOT NULL DEFAULT now()
);
CREATE TABLE public.tournament_chip_counts (
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
 tournament_id uuid NOT NULL REFERENCES public.tournaments(id),
 player_id uuid NOT NULL,
 entry_number integer NOT NULL DEFAULT 1,
 chip_count integer NOT NULL DEFAULT 0,
 updated_at timestamptz NOT NULL DEFAULT now(),
 UNIQUE(tournament_id,player_id,entry_number)
);
