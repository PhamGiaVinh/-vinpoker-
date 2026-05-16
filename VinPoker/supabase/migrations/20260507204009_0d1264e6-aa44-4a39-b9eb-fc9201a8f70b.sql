-- History table for GTO spot ranges
CREATE TABLE public.gto_spot_range_history (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  spot_key TEXT NOT NULL,
  range JSONB NOT NULL,
  previous_range JSONB,
  changed_by UUID,
  change_type TEXT NOT NULL DEFAULT 'update', -- 'update' | 'rollback' | 'create' | 'delete'
  note TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_gto_spot_range_history_spot_key ON public.gto_spot_range_history(spot_key, created_at DESC);

ALTER TABLE public.gto_spot_range_history ENABLE ROW LEVEL SECURITY;

CREATE POLICY "history_public_read"
  ON public.gto_spot_range_history FOR SELECT
  USING (true);

CREATE POLICY "history_admin_insert"
  ON public.gto_spot_range_history FOR INSERT
  TO authenticated
  WITH CHECK (has_role(auth.uid(), 'super_admin'::app_role));

CREATE POLICY "history_admin_delete"
  ON public.gto_spot_range_history FOR DELETE
  TO authenticated
  USING (has_role(auth.uid(), 'super_admin'::app_role));

-- Trigger: snapshot history on every change to gto_spot_ranges
CREATE OR REPLACE FUNCTION public.trg_snapshot_gto_range_history()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF TG_OP = 'INSERT' THEN
    INSERT INTO public.gto_spot_range_history (spot_key, range, previous_range, changed_by, change_type)
    VALUES (NEW.spot_key, NEW.range, NULL, NEW.updated_by, 'create');
    RETURN NEW;
  ELSIF TG_OP = 'UPDATE' THEN
    IF NEW.range IS DISTINCT FROM OLD.range THEN
      INSERT INTO public.gto_spot_range_history (spot_key, range, previous_range, changed_by, change_type)
      VALUES (NEW.spot_key, NEW.range, OLD.range, NEW.updated_by, 'update');
    END IF;
    RETURN NEW;
  ELSIF TG_OP = 'DELETE' THEN
    INSERT INTO public.gto_spot_range_history (spot_key, range, previous_range, changed_by, change_type)
    VALUES (OLD.spot_key, OLD.range, OLD.range, OLD.updated_by, 'delete');
    RETURN OLD;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS gto_spot_ranges_history ON public.gto_spot_ranges;
CREATE TRIGGER gto_spot_ranges_history
  AFTER INSERT OR UPDATE OR DELETE ON public.gto_spot_ranges
  FOR EACH ROW EXECUTE FUNCTION public.trg_snapshot_gto_range_history();