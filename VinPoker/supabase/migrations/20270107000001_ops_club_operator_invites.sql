-- Club-owner initiated Ops invitations. SOURCE ONLY: application is owner-gated.
-- Floor and Cashier authority remains club-scoped (club_floors / club_cashiers).
-- An Owner can never be granted from this flow.
--
-- An Auth email may be sent before the database RPC runs. That external action
-- cannot share this transaction; all app authority, invitation state and audit
-- history below must nevertheless commit together or roll back together.

CREATE TABLE IF NOT EXISTS public.club_operator_invites (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  club_id uuid NOT NULL REFERENCES public.clubs(id) ON DELETE CASCADE,
  email_normalized text NOT NULL CHECK (email_normalized = lower(btrim(email_normalized))),
  operator_role text NOT NULL CHECK (operator_role IN ('floor', 'cashier')),
  auth_user_id uuid REFERENCES auth.users(id) ON DELETE SET NULL,
  invited_by uuid NOT NULL REFERENCES auth.users(id) ON DELETE RESTRICT,
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'active', 'revoked')),
  invitation_sent_at timestamptz,
  last_delivery_outcome text NOT NULL DEFAULT 'not_required'
    CHECK (last_delivery_outcome IN ('sent', 'resent', 'not_required')),
  accepted_at timestamptz,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now(),
  revoked_at timestamptz,
  revoked_by uuid REFERENCES auth.users(id) ON DELETE SET NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS club_operator_invites_one_pending_or_active_role
  ON public.club_operator_invites (club_id, email_normalized, operator_role)
  WHERE status IN ('pending', 'active');
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
  'Owner-visible server-side Floor/Cashier invitations. Browser writes are forbidden.';

CREATE OR REPLACE FUNCTION public.apply_club_operator_invite(
  p_actor_id uuid,
  p_club_id uuid,
  p_auth_user_id uuid,
  p_email_normalized text,
  p_operator_role text,
  p_invitation_sent boolean,
  p_delivery_outcome text DEFAULT 'not_required'
)
RETURNS TABLE(invite_id uuid, outcome text, invite_status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_owner_id uuid;
  v_invite public.club_operator_invites%ROWTYPE;
  v_status text;
  v_action text;
  v_membership_exists boolean;
BEGIN
  IF p_operator_role NOT IN ('floor', 'cashier') THEN
    RAISE EXCEPTION 'INVALID_OPERATOR_ROLE' USING ERRCODE = '22023';
  END IF;
  IF p_email_normalized IS NULL OR p_email_normalized <> lower(btrim(p_email_normalized)) THEN
    RAISE EXCEPTION 'INVALID_OPERATOR_EMAIL' USING ERRCODE = '22023';
  END IF;
  IF p_delivery_outcome NOT IN ('sent', 'resent', 'not_required') THEN
    RAISE EXCEPTION 'INVALID_DELIVERY_OUTCOME' USING ERRCODE = '22023';
  END IF;

  -- Canonical order for all mutations: club, invitation, then membership.
  SELECT owner_id INTO v_owner_id
  FROM public.clubs
  WHERE id = p_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLUB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'CLUB_OWNER_REQUIRED' USING ERRCODE = '42501';
  END IF;

  SELECT * INTO v_invite
  FROM public.club_operator_invites
  WHERE club_id = p_club_id
    AND email_normalized = p_email_normalized
    AND operator_role = p_operator_role
    AND status IN ('pending', 'active')
  FOR UPDATE;

  IF p_operator_role = 'floor' THEN
    SELECT EXISTS (
      SELECT 1 FROM public.club_floors
      WHERE club_id = p_club_id AND user_id = p_auth_user_id
    ) INTO v_membership_exists;
  ELSE
    SELECT EXISTS (
      SELECT 1 FROM public.club_cashiers
      WHERE club_id = p_club_id AND user_id = p_auth_user_id
    ) INTO v_membership_exists;
  END IF;

  -- Retrying an already completed grant is a genuine no-op, including audit.
  IF v_invite.id IS NOT NULL AND v_invite.status = 'active'
    AND v_invite.auth_user_id = p_auth_user_id
    AND v_membership_exists THEN
    RETURN QUERY SELECT v_invite.id, 'ALREADY_ACTIVE'::text, v_invite.status;
    RETURN;
  END IF;

  v_status := CASE WHEN p_invitation_sent THEN 'pending' ELSE 'active' END;
  IF p_operator_role = 'floor' THEN
    INSERT INTO public.club_floors (club_id, user_id, granted_by)
    VALUES (p_club_id, p_auth_user_id, p_actor_id)
    ON CONFLICT (club_id, user_id) DO UPDATE SET granted_by = EXCLUDED.granted_by;
  ELSE
    INSERT INTO public.club_cashiers (club_id, user_id, granted_by)
    VALUES (p_club_id, p_auth_user_id, p_actor_id)
    ON CONFLICT (club_id, user_id) DO UPDATE SET granted_by = EXCLUDED.granted_by;
  END IF;

  IF v_invite.id IS NULL THEN
    INSERT INTO public.club_operator_invites (
      club_id, email_normalized, operator_role, auth_user_id, invited_by,
      status, invitation_sent_at, last_delivery_outcome, accepted_at, updated_at
    ) VALUES (
      p_club_id, p_email_normalized, p_operator_role, p_auth_user_id, p_actor_id,
      v_status,
      CASE WHEN p_invitation_sent THEN now() ELSE NULL END,
      p_delivery_outcome,
      CASE WHEN v_status = 'active' THEN now() ELSE NULL END,
      now()
    )
    RETURNING * INTO v_invite;
  ELSE
    UPDATE public.club_operator_invites
    SET auth_user_id = p_auth_user_id,
        invited_by = p_actor_id,
        status = v_status,
        invitation_sent_at = CASE WHEN p_invitation_sent THEN now() ELSE invitation_sent_at END,
        last_delivery_outcome = p_delivery_outcome,
        accepted_at = CASE WHEN v_status = 'active' THEN coalesce(accepted_at, now()) ELSE NULL END,
        revoked_at = NULL,
        revoked_by = NULL,
        updated_at = now()
    WHERE id = v_invite.id
    RETURNING * INTO v_invite;
  END IF;

  v_action := CASE
    WHEN p_delivery_outcome = 'resent' THEN 'ops_operator_invite_resent'
    WHEN p_invitation_sent THEN 'ops_operator_invited'
    ELSE 'ops_operator_granted_existing'
  END;
  INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  VALUES (
    p_club_id, p_actor_id, v_action, 'club_operator_invite', v_invite.id,
    jsonb_build_object('operator_role', p_operator_role, 'status', v_invite.status)
  );

  RETURN QUERY SELECT
    v_invite.id,
    CASE
      WHEN p_delivery_outcome = 'resent' THEN 'RESENT'
      WHEN p_invitation_sent THEN 'INVITED'
      ELSE 'GRANTED_EXISTING'
    END,
    v_invite.status;
END;
$$;

CREATE OR REPLACE FUNCTION public.revoke_club_operator_invite(
  p_actor_id uuid,
  p_invite_id uuid
)
RETURNS TABLE(invite_id uuid, outcome text, invite_status text)
LANGUAGE plpgsql
SECURITY INVOKER
SET search_path = public
AS $$
DECLARE
  v_club_id uuid;
  v_owner_id uuid;
  v_invite public.club_operator_invites%ROWTYPE;
BEGIN
  -- Read the club id, then take the canonical club -> invitation locks.
  SELECT club_id INTO v_club_id
  FROM public.club_operator_invites
  WHERE id = p_invite_id;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  SELECT owner_id INTO v_owner_id
  FROM public.clubs
  WHERE id = v_club_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'CLUB_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_owner_id IS DISTINCT FROM p_actor_id THEN
    RAISE EXCEPTION 'CLUB_OWNER_REQUIRED' USING ERRCODE = '42501';
  END IF;
  SELECT * INTO v_invite
  FROM public.club_operator_invites
  WHERE id = p_invite_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RAISE EXCEPTION 'INVITE_NOT_FOUND' USING ERRCODE = 'P0002';
  END IF;
  IF v_invite.status = 'revoked' THEN
    RETURN QUERY SELECT v_invite.id, 'ALREADY_REVOKED'::text, v_invite.status;
    RETURN;
  END IF;

  IF v_invite.auth_user_id IS NOT NULL THEN
    IF v_invite.operator_role = 'floor' THEN
      DELETE FROM public.club_floors
      WHERE club_id = v_invite.club_id AND user_id = v_invite.auth_user_id;
    ELSE
      DELETE FROM public.club_cashiers
      WHERE club_id = v_invite.club_id AND user_id = v_invite.auth_user_id;
    END IF;
  END IF;
  UPDATE public.club_operator_invites
  SET status = 'revoked', revoked_at = now(), revoked_by = p_actor_id, updated_at = now()
  WHERE id = v_invite.id
  RETURNING * INTO v_invite;
  INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  VALUES (
    v_invite.club_id, p_actor_id, 'ops_operator_revoked', 'club_operator_invite', v_invite.id,
    jsonb_build_object('operator_role', v_invite.operator_role, 'status', v_invite.status)
  );
  RETURN QUERY SELECT v_invite.id, 'REVOKED'::text, v_invite.status;
END;
$$;

REVOKE ALL ON FUNCTION public.apply_club_operator_invite(uuid, uuid, uuid, text, text, boolean, text)
  FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.revoke_club_operator_invite(uuid, uuid)
  FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.apply_club_operator_invite(uuid, uuid, uuid, text, text, boolean, text)
  TO service_role;
GRANT EXECUTE ON FUNCTION public.revoke_club_operator_invite(uuid, uuid)
  TO service_role;

COMMENT ON FUNCTION public.apply_club_operator_invite(uuid, uuid, uuid, text, text, boolean, text) IS
  'Service-only atomic operator invitation grant. Rechecks club ownership.';
COMMENT ON FUNCTION public.revoke_club_operator_invite(uuid, uuid) IS
  'Service-only atomic operator revocation. Rechecks club ownership.';

-- ROLLBACK (owner-gated): REVOKE EXECUTE on the two RPCs. Drop the table only
-- after confirming no deployed source calls it.
