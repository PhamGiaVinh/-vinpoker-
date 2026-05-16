ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS schedule_sort_order integer NOT NULL DEFAULT 0;
CREATE INDEX IF NOT EXISTS idx_clubs_schedule_sort ON public.clubs(schedule_sort_order, name);