
-- Add game_type to tournaments
ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS game_type TEXT NOT NULL DEFAULT 'nlh';

-- Validation trigger for game_type
CREATE OR REPLACE FUNCTION public.validate_tournament_game_type()
RETURNS TRIGGER
LANGUAGE plpgsql
SET search_path = public
AS $$
BEGIN
  IF NEW.game_type NOT IN ('nlh','plo','mixed') THEN
    RAISE EXCEPTION 'Invalid game_type: %', NEW.game_type;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_validate_tournament_game_type ON public.tournaments;
CREATE TRIGGER trg_validate_tournament_game_type
BEFORE INSERT OR UPDATE ON public.tournaments
FOR EACH ROW EXECUTE FUNCTION public.validate_tournament_game_type();

-- App settings (singleton-style key/value) for things like VIP banner
CREATE TABLE IF NOT EXISTS public.app_settings (
  key TEXT PRIMARY KEY,
  value JSONB NOT NULL DEFAULT '{}'::jsonb,
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_by UUID
);

ALTER TABLE public.app_settings ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "App settings public read" ON public.app_settings;
CREATE POLICY "App settings public read"
ON public.app_settings FOR SELECT
USING (true);

DROP POLICY IF EXISTS "Super admins manage app settings" ON public.app_settings;
CREATE POLICY "Super admins manage app settings"
ON public.app_settings FOR ALL
USING (public.has_role(auth.uid(), 'super_admin'))
WITH CHECK (public.has_role(auth.uid(), 'super_admin'));

-- Seed VIP banner default
INSERT INTO public.app_settings (key, value)
VALUES ('vip_banner', '{"title":"VIP Main Event","subtitle":"$1M GTD · Coming Soon","image_url":"","cta_url":""}'::jsonb)
ON CONFLICT (key) DO NOTHING;

-- Public bucket for app assets (banner image)
INSERT INTO storage.buckets (id, name, public)
VALUES ('app-assets', 'app-assets', true)
ON CONFLICT (id) DO NOTHING;

DROP POLICY IF EXISTS "App assets public read" ON storage.objects;
CREATE POLICY "App assets public read"
ON storage.objects FOR SELECT
USING (bucket_id = 'app-assets');

DROP POLICY IF EXISTS "Super admins upload app assets" ON storage.objects;
CREATE POLICY "Super admins upload app assets"
ON storage.objects FOR INSERT
WITH CHECK (bucket_id = 'app-assets' AND public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "Super admins update app assets" ON storage.objects;
CREATE POLICY "Super admins update app assets"
ON storage.objects FOR UPDATE
USING (bucket_id = 'app-assets' AND public.has_role(auth.uid(),'super_admin'));

DROP POLICY IF EXISTS "Super admins delete app assets" ON storage.objects;
CREATE POLICY "Super admins delete app assets"
ON storage.objects FOR DELETE
USING (bucket_id = 'app-assets' AND public.has_role(auth.uid(),'super_admin'));
