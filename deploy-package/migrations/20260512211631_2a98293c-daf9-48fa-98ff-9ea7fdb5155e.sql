
-- Enable trigram for fast ILIKE search
CREATE EXTENSION IF NOT EXISTS pg_trgm;

-- 1. Add auto_sync_url to clubs (optional CSV URL for future cron)
ALTER TABLE public.clubs ADD COLUMN IF NOT EXISTS auto_sync_url text;

-- 2. club_members table
CREATE TABLE IF NOT EXISTS public.club_members (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  member_card_id text NOT NULL,
  full_name text,
  phone text,
  cccd text,
  player_user_id uuid,
  source text NOT NULL DEFAULT 'csv',
  synced_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (club_id, member_card_id)
);

CREATE INDEX IF NOT EXISTS idx_club_members_club ON public.club_members(club_id);
CREATE INDEX IF NOT EXISTS idx_club_members_user ON public.club_members(player_user_id) WHERE player_user_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_club_members_name_trgm ON public.club_members USING gin (full_name gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_club_members_phone_trgm ON public.club_members USING gin (phone gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_club_members_cccd_trgm ON public.club_members USING gin (cccd gin_trgm_ops);
CREATE INDEX IF NOT EXISTS idx_club_members_card_trgm ON public.club_members USING gin (member_card_id gin_trgm_ops);

CREATE TRIGGER trg_club_members_updated
  BEFORE UPDATE ON public.club_members
  FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

ALTER TABLE public.club_members ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cashier read club_members"
  ON public.club_members FOR SELECT
  USING (public.is_club_cashier(auth.uid(), club_id) OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Cashier insert club_members"
  ON public.club_members FOR INSERT
  WITH CHECK (public.is_club_cashier(auth.uid(), club_id) OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Cashier update club_members"
  ON public.club_members FOR UPDATE
  USING (public.is_club_cashier(auth.uid(), club_id) OR public.has_role(auth.uid(), 'super_admin'));

CREATE POLICY "Cashier delete club_members"
  ON public.club_members FOR DELETE
  USING (public.is_club_cashier(auth.uid(), club_id) OR public.has_role(auth.uid(), 'super_admin'));

-- 3. sync_logs
CREATE TABLE IF NOT EXISTS public.sync_logs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  synced_by uuid NOT NULL,
  source_type text NOT NULL DEFAULT 'csv',
  records_inserted integer NOT NULL DEFAULT 0,
  records_updated integer NOT NULL DEFAULT 0,
  records_failed integer NOT NULL DEFAULT 0,
  error_sample jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_sync_logs_club ON public.sync_logs(club_id, created_at DESC);

ALTER TABLE public.sync_logs ENABLE ROW LEVEL SECURITY;

CREATE POLICY "Cashier read sync_logs"
  ON public.sync_logs FOR SELECT
  USING (public.is_club_cashier(auth.uid(), club_id) OR public.has_role(auth.uid(), 'super_admin'));

-- 4. Trigger: when membership_verification approved (player_user_id set in club_members),
-- handled by edge function approve-reject-verification. Add helper function to auto-link
-- when a verification request is approved: link by (club_id, member_card_id).
CREATE OR REPLACE FUNCTION public.trg_link_club_member_on_verify()
RETURNS trigger
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NEW.status = 'approved' AND (OLD.status IS DISTINCT FROM 'approved') THEN
    UPDATE public.club_members
       SET player_user_id = NEW.player_user_id,
           updated_at = now()
     WHERE club_id = NEW.club_id
       AND member_card_id = NEW.member_card_id
       AND (player_user_id IS NULL OR player_user_id <> NEW.player_user_id);
  END IF;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_link_club_member_on_verify ON public.membership_verification_requests;
CREATE TRIGGER trg_link_club_member_on_verify
  AFTER UPDATE ON public.membership_verification_requests
  FOR EACH ROW EXECUTE FUNCTION public.trg_link_club_member_on_verify();
