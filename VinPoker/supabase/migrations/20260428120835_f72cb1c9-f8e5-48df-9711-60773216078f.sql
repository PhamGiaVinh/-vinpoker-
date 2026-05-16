ALTER TABLE public.all_time_money_list ALTER COLUMN player_id DROP NOT NULL;
ALTER TABLE public.all_time_money_list DROP CONSTRAINT IF EXISTS all_time_money_list_player_unique;
CREATE UNIQUE INDEX IF NOT EXISTS all_time_money_list_player_unique_idx
  ON public.all_time_money_list (player_id) WHERE player_id IS NOT NULL;