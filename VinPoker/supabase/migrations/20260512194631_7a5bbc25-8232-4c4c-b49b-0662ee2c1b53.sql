
-- 1) Add 'club_cashier' role enum value
ALTER TYPE public.app_role ADD VALUE IF NOT EXISTS 'club_cashier';

-- 2) Profile verification columns
ALTER TABLE public.profiles
  ADD COLUMN IF NOT EXISTS verification_status TEXT NOT NULL DEFAULT 'unverified',
  ADD COLUMN IF NOT EXISTS verified_by_club_id UUID REFERENCES public.clubs(id) ON DELETE SET NULL,
  ADD COLUMN IF NOT EXISTS verified_at TIMESTAMPTZ;

-- 3) Membership verification requests
CREATE TABLE IF NOT EXISTS public.membership_verification_requests (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  player_user_id UUID NOT NULL,
  club_id UUID NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  member_card_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','approved','rejected')),
  reviewed_by UUID,
  reviewed_at TIMESTAMPTZ,
  rejection_reason TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_mvr_club_status ON public.membership_verification_requests(club_id, status);
CREATE INDEX IF NOT EXISTS idx_mvr_player ON public.membership_verification_requests(player_user_id);

ALTER TABLE public.membership_verification_requests ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS "mvr player select own" ON public.membership_verification_requests;
CREATE POLICY "mvr player select own" ON public.membership_verification_requests
  FOR SELECT TO authenticated
  USING (auth.uid() = player_user_id);

DROP POLICY IF EXISTS "mvr player insert own" ON public.membership_verification_requests;
CREATE POLICY "mvr player insert own" ON public.membership_verification_requests
  FOR INSERT TO authenticated
  WITH CHECK (auth.uid() = player_user_id AND status = 'pending');

DROP POLICY IF EXISTS "mvr cashier select club" ON public.membership_verification_requests;
CREATE POLICY "mvr cashier select club" ON public.membership_verification_requests
  FOR SELECT TO authenticated
  USING (public.is_club_cashier(auth.uid(), club_id));

DROP POLICY IF EXISTS "mvr cashier update club" ON public.membership_verification_requests;
CREATE POLICY "mvr cashier update club" ON public.membership_verification_requests
  FOR UPDATE TO authenticated
  USING (public.is_club_cashier(auth.uid(), club_id))
  WITH CHECK (public.is_club_cashier(auth.uid(), club_id));

DROP POLICY IF EXISTS "mvr admin all" ON public.membership_verification_requests;
CREATE POLICY "mvr admin all" ON public.membership_verification_requests
  FOR ALL TO authenticated
  USING (public.has_role(auth.uid(), 'super_admin'::public.app_role))
  WITH CHECK (public.has_role(auth.uid(), 'super_admin'::public.app_role));
