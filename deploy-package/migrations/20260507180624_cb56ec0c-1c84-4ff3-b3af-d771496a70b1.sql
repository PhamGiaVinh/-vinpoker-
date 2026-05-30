
CREATE TABLE public.gto_spot_ranges (
  spot_key text PRIMARY KEY,
  range jsonb NOT NULL,
  updated_at timestamptz NOT NULL DEFAULT now(),
  updated_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

ALTER TABLE public.gto_spot_ranges ENABLE ROW LEVEL SECURITY;

CREATE POLICY "gto_spot_ranges_public_read"
  ON public.gto_spot_ranges FOR SELECT
  USING (true);

CREATE POLICY "gto_spot_ranges_admin_insert"
  ON public.gto_spot_ranges FOR INSERT
  TO authenticated
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "gto_spot_ranges_admin_update"
  ON public.gto_spot_ranges FOR UPDATE
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "gto_spot_ranges_admin_delete"
  ON public.gto_spot_ranges FOR DELETE
  TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE TRIGGER update_gto_spot_ranges_updated_at
  BEFORE UPDATE ON public.gto_spot_ranges
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER PUBLICATION supabase_realtime ADD TABLE public.gto_spot_ranges;
ALTER TABLE public.gto_spot_ranges REPLICA IDENTITY FULL;
