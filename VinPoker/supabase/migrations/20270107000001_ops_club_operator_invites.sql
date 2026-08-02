-- Club-owner initiated Ops invitations. SOURCE ONLY: application is owner-gated.
-- Floor and Cashier authority remains club-scoped (club_floors / club_cashiers).
-- An Owner can never be granted from this flow.

CREATE TABLE IF NOT EXISTS public.club_operator_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  email_normalized text NOT NULL CHECK (email_normalized = lower(btrim(email_normalized))),
  operator_role text NOT NULL CHECK (operator_role IN ('floor', 'cashier')),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'revoked')),
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS club_operator_invites_one_active_role
  ON public.club_operator_invites (club_id, email_normalized, operator_role)
  WHERE status = 'active';
CREATE INDEX IF NOT EXISTS club_operator_invites_club_created_at
  ON public.club_operator_invites (club_id, created_at DESC);

ALTER TABLE public.club_operator_invites ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.club_operator_invites FROM PUBLIC, anon, authenticated;
GRANT SELECT ON TABLE public.club_operator_invites TO authenticated;

DROP POLICY IF EXISTS club_operator_invites_select_owner ON public.club_operator_invites;
CREATE POLICY club_operator_invites_select_owner
  ON public.club_operator_invites FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.clubs c
    WHERE c.id = club_operator_invites.club_id AND c.owner_id = auth.uid()
  ));

COMMENT ON TABLE public.club_operator_invites IS
  'Owner-visible server-side Floor/Cashier invitations. Client writes are forbidden.';

-- ROLLBACK (owner-gated): DROP TABLE IF EXISTS public.club_operator_invites;
