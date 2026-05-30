CREATE TABLE public.all_time_money_list (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  player_id UUID NOT NULL,
  display_name TEXT NOT NULL,
  total_winnings NUMERIC NOT NULL DEFAULT 0,
  rank_source INTEGER,
  imported_at TIMESTAMP WITH TIME ZONE NOT NULL DEFAULT now(),
  imported_by UUID,
  CONSTRAINT all_time_money_list_player_unique UNIQUE (player_id)
);

ALTER TABLE public.all_time_money_list ENABLE ROW LEVEL SECURITY;

CREATE POLICY "All-time list public read"
ON public.all_time_money_list FOR SELECT
USING (true);

CREATE POLICY "Super admin manage all-time list"
ON public.all_time_money_list FOR ALL
USING (has_role(auth.uid(), 'super_admin'::app_role))
WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE INDEX idx_all_time_money_list_winnings ON public.all_time_money_list (total_winnings DESC);