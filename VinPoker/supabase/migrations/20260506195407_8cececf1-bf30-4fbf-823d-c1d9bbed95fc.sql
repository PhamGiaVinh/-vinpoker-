-- Restore public read access to profiles for anonymous users
GRANT SELECT ON public.profiles TO anon, authenticated;