-- Club-scoped `floor` role membership + helpers. Mirrors club_cashiers /
-- club_dealer_controls / club_media EXACTLY. v1 is SCHEMA ONLY: it does NOT change
-- any existing RLS / access yet (the photo-permission repoint is a separate PR1B,
-- floor-dashboard access stays as-is). SOURCE-ONLY — owner-gated apply. Idempotent.

CREATE TABLE IF NOT EXISTS public.club_floors (
  club_id    uuid        NOT NULL,
  user_id    uuid        NOT NULL,
  granted_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT club_floors_pkey PRIMARY KEY (club_id, user_id),
  CONSTRAINT club_floors_club_id_fkey    FOREIGN KEY (club_id)    REFERENCES public.clubs(id) ON DELETE CASCADE,
  CONSTRAINT club_floors_user_id_fkey    FOREIGN KEY (user_id)    REFERENCES auth.users(id)   ON DELETE CASCADE,
  CONSTRAINT club_floors_granted_by_fkey FOREIGN KEY (granted_by) REFERENCES auth.users(id)   ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_club_floors_user ON public.club_floors(user_id);
CREATE INDEX IF NOT EXISTS idx_club_floors_club ON public.club_floors(club_id);
ALTER TABLE public.club_floors ENABLE ROW LEVEL SECURITY;

-- Assign by super_admin OR the club owner; readable by self/owner/super.
DO $$ BEGIN CREATE POLICY "club_floors_select_self"  ON public.club_floors FOR SELECT TO authenticated USING (auth.uid() = user_id); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "club_floors_select_owner" ON public.club_floors FOR SELECT TO authenticated USING (EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_floors.club_id AND c.owner_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "club_floors_select_super" ON public.club_floors FOR SELECT TO authenticated USING (public.has_role(auth.uid(), 'super_admin')); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "club_floors_insert_super_owner" ON public.club_floors FOR INSERT TO authenticated WITH CHECK (public.has_role(auth.uid(),'super_admin') OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_floors.club_id AND c.owner_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE POLICY "club_floors_delete_super_owner" ON public.club_floors FOR DELETE TO authenticated USING (public.has_role(auth.uid(),'super_admin') OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_floors.club_id AND c.owner_id = auth.uid())); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE OR REPLACE FUNCTION public.is_club_floor(_user_id uuid, _club_id uuid)
RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT EXISTS (SELECT 1 FROM public.club_floors cf WHERE cf.user_id = _user_id AND cf.club_id = _club_id)
      OR EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = _club_id AND c.owner_id = _user_id)
      OR public.has_role(_user_id, 'super_admin')
$fn$;

CREATE OR REPLACE FUNCTION public.floor_club_ids(_user_id uuid)
RETURNS SETOF uuid LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public
AS $fn$
  SELECT club_id FROM public.club_floors WHERE user_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE owner_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE public.has_role(_user_id, 'super_admin')
$fn$;

GRANT EXECUTE ON FUNCTION public.is_club_floor(uuid, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.floor_club_ids(uuid)      TO authenticated;
GRANT SELECT, INSERT, DELETE ON public.club_floors TO authenticated;
