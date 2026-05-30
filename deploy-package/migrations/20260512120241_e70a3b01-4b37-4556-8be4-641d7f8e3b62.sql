DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.gto_app_settings;
EXCEPTION WHEN undefined_object THEN NULL; WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.gto_spot_ranges;
EXCEPTION WHEN undefined_object THEN NULL; WHEN others THEN NULL; END $$;

DO $$ BEGIN
  ALTER PUBLICATION supabase_realtime DROP TABLE public.gto_user_spot_ranges;
EXCEPTION WHEN undefined_object THEN NULL; WHEN others THEN NULL; END $$;