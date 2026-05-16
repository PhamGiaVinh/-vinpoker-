
CREATE TABLE public.tournament_registrations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tournament_id UUID NOT NULL,
  player_id UUID NOT NULL,
  club_id UUID,
  buy_in BIGINT NOT NULL,
  platform_fixed_fee BIGINT NOT NULL DEFAULT 0,
  total_pay BIGINT NOT NULL DEFAULT 0,
  reference_code TEXT NOT NULL UNIQUE,
  transfer_proof_image_url TEXT,
  transfer_proof_submitted BOOLEAN NOT NULL DEFAULT false,
  status TEXT NOT NULL DEFAULT 'pending',
  committed_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  confirmed_at TIMESTAMPTZ,
  confirmed_by UUID,
  cancelled_at TIMESTAMPTZ,
  cancelled_by UUID,
  cancellation_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_treg_player ON public.tournament_registrations(player_id, status);
CREATE INDEX idx_treg_club ON public.tournament_registrations(club_id, status);
CREATE INDEX idx_treg_tournament ON public.tournament_registrations(tournament_id, status);

-- Prevent duplicate active registrations for same tournament+player
CREATE UNIQUE INDEX uniq_treg_active
  ON public.tournament_registrations(tournament_id, player_id)
  WHERE status IN ('pending','confirmed');

ALTER TABLE public.tournament_registrations ENABLE ROW LEVEL SECURITY;

-- Player sees own
CREATE POLICY "treg_player_select_own"
ON public.tournament_registrations FOR SELECT
USING (player_id = auth.uid());

-- Club owner & cashier (of the club) see club regs
CREATE POLICY "treg_club_select"
ON public.tournament_registrations FOR SELECT
USING (
  has_role(auth.uid(), 'super_admin'::app_role)
  OR (club_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = tournament_registrations.club_id
      AND c.owner_id = auth.uid()
  ))
);

-- Player creates own
CREATE POLICY "treg_player_insert"
ON public.tournament_registrations FOR INSERT
WITH CHECK (player_id = auth.uid());

-- Player updates own (cancel + upload proof) while pending
CREATE POLICY "treg_player_update_own"
ON public.tournament_registrations FOR UPDATE
USING (player_id = auth.uid() AND status = 'pending')
WITH CHECK (player_id = auth.uid());

-- Club owner / super admin update (confirm/cancel)
CREATE POLICY "treg_club_update"
ON public.tournament_registrations FOR UPDATE
USING (
  has_role(auth.uid(), 'super_admin'::app_role)
  OR (club_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = tournament_registrations.club_id
      AND c.owner_id = auth.uid()
  ))
)
WITH CHECK (
  has_role(auth.uid(), 'super_admin'::app_role)
  OR (club_id IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = tournament_registrations.club_id
      AND c.owner_id = auth.uid()
  ))
);

-- updated_at trigger
CREATE TRIGGER trg_treg_updated_at
BEFORE UPDATE ON public.tournament_registrations
FOR EACH ROW EXECUTE FUNCTION public.update_updated_at_column();

-- Auto-cancel pending after 30 minutes
CREATE OR REPLACE FUNCTION public.auto_cancel_expired_tournament_regs()
RETURNS INTEGER
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  cnt INTEGER := 0;
BEGIN
  WITH upd AS (
    UPDATE public.tournament_registrations
    SET status = 'cancelled',
        cancelled_at = now(),
        cancellation_reason = 'auto_cancelled_timeout'
    WHERE status = 'pending'
      AND committed_at < (now() - INTERVAL '30 minutes')
    RETURNING 1
  )
  SELECT count(*) INTO cnt FROM upd;
  RETURN cnt;
END;
$$;
