-- Cashier-per-club assignment table
CREATE TABLE IF NOT EXISTS public.club_cashiers (
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  user_id UUID NOT NULL,
  granted_by UUID,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  PRIMARY KEY (club_id, user_id)
);

CREATE INDEX IF NOT EXISTS idx_club_cashiers_user ON public.club_cashiers(user_id);
CREATE INDEX IF NOT EXISTS idx_club_cashiers_club ON public.club_cashiers(club_id);

ALTER TABLE public.club_cashiers ENABLE ROW LEVEL SECURITY;

-- SELECT: super_admin all; user own rows; club owner of that club
CREATE POLICY "club_cashiers_select_super"
  ON public.club_cashiers FOR SELECT
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "club_cashiers_select_self"
  ON public.club_cashiers FOR SELECT
  USING (auth.uid() = user_id);

CREATE POLICY "club_cashiers_select_club_owner"
  ON public.club_cashiers FOR SELECT
  USING (EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = club_cashiers.club_id AND c.owner_id = auth.uid()));

-- INSERT/DELETE: super_admin only
CREATE POLICY "club_cashiers_insert_super"
  ON public.club_cashiers FOR INSERT
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));

CREATE POLICY "club_cashiers_delete_super"
  ON public.club_cashiers FOR DELETE
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role));

-- Helper: is_club_cashier (true if assigned via club_cashiers OR club owner)
CREATE OR REPLACE FUNCTION public.is_club_cashier(_user_id UUID, _club_id UUID)
RETURNS BOOLEAN
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.club_cashiers cc
    WHERE cc.user_id = _user_id AND cc.club_id = _club_id
  ) OR EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = _club_id AND c.owner_id = _user_id
  )
$$;

-- Helper: cashier_club_ids — all club ids the user can act on (assigned + owned)
CREATE OR REPLACE FUNCTION public.cashier_club_ids(_user_id UUID)
RETURNS SETOF UUID
LANGUAGE sql
STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT club_id FROM public.club_cashiers WHERE user_id = _user_id
  UNION
  SELECT id FROM public.clubs WHERE owner_id = _user_id
$$;

-- Trigger: when player_checked_in flips to true, force early_closed=true
CREATE OR REPLACE FUNCTION public.trg_sync_checkin_close()
RETURNS TRIGGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.player_checked_in = true AND COALESCE(OLD.player_checked_in, false) = false THEN
    NEW.early_closed := true;
    IF NEW.early_closed_at IS NULL THEN
      NEW.early_closed_at := now();
    END IF;
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS staking_deals_sync_checkin_close ON public.staking_deals;
CREATE TRIGGER staking_deals_sync_checkin_close
  BEFORE UPDATE ON public.staking_deals
  FOR EACH ROW EXECUTE FUNCTION public.trg_sync_checkin_close();