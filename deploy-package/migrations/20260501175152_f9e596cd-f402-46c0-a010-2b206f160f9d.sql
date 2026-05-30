CREATE TABLE public.club_money_list (
  id uuid NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  club_id uuid NOT NULL,
  display_name text NOT NULL,
  player_id uuid,
  total_winnings numeric NOT NULL DEFAULT 0,
  rank_source integer,
  imported_by uuid,
  imported_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_club_money_list_club ON public.club_money_list(club_id);
CREATE INDEX idx_club_money_list_player ON public.club_money_list(player_id);

ALTER TABLE public.club_money_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Club money list public read"
ON public.club_money_list FOR SELECT
USING (true);

CREATE POLICY "Super admin manage club money list"
ON public.club_money_list FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "Club owner manage own club money list"
ON public.club_money_list FOR ALL
USING (EXISTS (
  SELECT 1 FROM public.clubs c
  WHERE c.id = club_money_list.club_id AND c.owner_id = auth.uid()
))
WITH CHECK (EXISTS (
  SELECT 1 FROM public.clubs c
  WHERE c.id = club_money_list.club_id AND c.owner_id = auth.uid()
));