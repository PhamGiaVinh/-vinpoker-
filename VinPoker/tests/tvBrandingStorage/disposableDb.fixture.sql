-- Minimal Supabase/app prerequisites for applying the exact TV migration chain
-- in a disposable PostgreSQL service. This fixture is never used against live DB.
CREATE ROLE anon NOLOGIN;
CREATE ROLE authenticated NOLOGIN;
CREATE ROLE service_role NOLOGIN;

CREATE SCHEMA auth;
CREATE FUNCTION auth.uid() RETURNS uuid
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('request.jwt.claim.sub', true), '')::uuid
$$;
GRANT USAGE ON SCHEMA auth TO authenticated, anon;

CREATE SCHEMA storage;
CREATE FUNCTION storage.foldername(p_name text) RETURNS text[]
LANGUAGE sql IMMUTABLE AS $$ SELECT string_to_array(p_name, '/') $$;
CREATE TABLE storage.objects (
  bucket_id text NOT NULL,
  name text NOT NULL,
  owner_id uuid,
  PRIMARY KEY (bucket_id, name)
);
ALTER TABLE storage.objects ENABLE ROW LEVEL SECURITY;
GRANT USAGE ON SCHEMA storage TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE ON storage.objects TO authenticated;
-- Existing permissive upload/mutation shape: the pending TV restrictive
-- policies must narrow only matching TV assets and leave other paths intact.
CREATE POLICY backing_proofs_owner_all ON storage.objects TO authenticated
  USING (bucket_id = 'backing-proofs' AND (storage.foldername(name))[1] = auth.uid()::text)
  WITH CHECK (bucket_id = 'backing-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY backing_proofs_owner_select ON storage.objects FOR SELECT TO authenticated
  USING (bucket_id = 'backing-proofs' AND (storage.foldername(name))[1] = auth.uid()::text);
CREATE POLICY avatars_upload ON storage.objects FOR INSERT TO authenticated
  WITH CHECK (bucket_id = 'avatars');

CREATE TYPE public.app_role AS ENUM ('player', 'club_admin', 'super_admin');
CREATE SCHEMA private;
CREATE TABLE public.clubs (
  id uuid PRIMARY KEY,
  owner_id uuid,
  name text NOT NULL,
  cover_url text
);
CREATE TABLE public.club_dealer_controls (
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  user_id uuid NOT NULL,
  PRIMARY KEY (club_id, user_id)
);
CREATE FUNCTION public.has_role(_user_id uuid, _role public.app_role)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;
-- Match the existing source helper's two authority sources (explicit control
-- row or club ownership); no fake allowlist/role behavior in the test seam.
CREATE FUNCTION public.is_club_dealer_control(_user_id uuid, _club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.club_dealer_controls c
    WHERE c.user_id = _user_id AND c.club_id = _club_id)
    OR EXISTS (SELECT 1 FROM public.clubs c
      WHERE c.id = _club_id AND c.owner_id = _user_id)
$$;
CREATE FUNCTION public.is_club_owner(_user_id uuid, _club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  SELECT EXISTS (SELECT 1 FROM public.clubs c
    WHERE c.id = _club_id AND c.owner_id = _user_id)
$$;
CREATE FUNCTION public.is_club_floor(_user_id uuid, _club_id uuid)
RETURNS boolean LANGUAGE sql STABLE AS $$ SELECT false $$;

CREATE TABLE public.tournament_events (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id)
);
CREATE TABLE public.tournaments (
  id uuid PRIMARY KEY,
  club_id uuid NOT NULL REFERENCES public.clubs(id),
  event_id uuid REFERENCES public.tournament_events(id),
  deleted_at timestamptz
);
CREATE TABLE public.tv_displays (
  display_token text PRIMARY KEY,
  status text NOT NULL,
  assigned_tournament_id uuid REFERENCES public.tournaments(id)
);
CREATE FUNCTION public.get_tv_display_state(p_display_token text)
RETURNS jsonb LANGUAGE sql STABLE AS $$ SELECT '{"status":"unpaired"}'::jsonb $$;

INSERT INTO public.clubs(id, owner_id, name) VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001', 'Allowed club'),
  ('10000000-0000-4000-8000-000000000002', '20000000-0000-4000-8000-000000000002', 'Other club');
INSERT INTO public.club_dealer_controls(club_id, user_id) VALUES
  ('10000000-0000-4000-8000-000000000001', '20000000-0000-4000-8000-000000000001');

