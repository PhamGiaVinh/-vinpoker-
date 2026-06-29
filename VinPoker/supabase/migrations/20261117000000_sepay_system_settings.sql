-- SePay ingestion — Patch 2d (full auto-confirm): system-actor settings + per-club opt-in.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: full auto-confirm needs a REAL, AUTHORIZED identity to call confirm_registration_and_assign_seat
-- (P0-guard-v2 demands p_actor = auth.uid() AND that actor be the club owner/cashier; a headless cron has
-- auth.uid()=NULL). This stores the single global "SePay system bot" auth.users id + a DB-level global
-- kill-switch, and provides a super_admin-gated opt-in that adds/removes the bot as a club_cashiers member
-- (the per-club gate). settle_bank_transaction (20261118000000) reads system_actor_id and impersonates the
-- bot ONLY around the confirm call.
--
-- SECURITY: the table is RLS-locked with NO policies → only service_role (RLS bypass) + SECURITY DEFINER
-- functions touch it. The bot id is NOT a secret (security = the bot has no login + is a cashier only of
-- opted-in clubs); it is stored plainly. Setters are super_admin-gated. The system_actor MUST be a real
-- auth.users row (validated) — the inverse of the old settle header's "must NOT be a real user" note.
--
-- PROVISIONING (owner, out-of-band — NOT in this migration):
--   1. Create the bot account (admin API createUser, banned + no password + no identities; or a dedicated
--      signup whose password is kept secret then banned before production) → uuid B.
--   2. In a controlled session: SET LOCAL request.jwt.claims = '{"sub":"<super_admin uid>"}'; then
--        select public.sepay_set_system_actor('<B>'::uuid);
--        select public.sepay_set_club_autoconfirm('<club id>'::uuid, true);
--        select public.sepay_set_auto_confirm_enabled(true);
--      (or, as postgres in SQL Editor, write the table + club_cashiers directly — RLS is bypassed there.)
--
-- Idempotent: CREATE TABLE IF NOT EXISTS, CREATE OR REPLACE FUNCTION, explicit REVOKE/GRANT.

CREATE TABLE IF NOT EXISTS public.sepay_system_settings (
  id                   boolean PRIMARY KEY DEFAULT true CHECK (id = true),  -- single-row table
  system_actor_id      uuid,                                                -- the SePay bot (REAL auth.users id); NULL until provisioned
  auto_confirm_enabled boolean NOT NULL DEFAULT false,                      -- DB-level global kill-switch (belt-and-suspenders vs the edge env)
  updated_at           timestamptz NOT NULL DEFAULT now(),
  updated_by           uuid
);
INSERT INTO public.sepay_system_settings (id) VALUES (true) ON CONFLICT (id) DO NOTHING;

ALTER TABLE public.sepay_system_settings ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.sepay_system_settings FROM PUBLIC, anon, authenticated;
-- No policies → service_role + SECURITY DEFINER functions only. settle reads it as DEFINER (RLS bypass).

-- ── set the system bot actor (super_admin only; VALIDATES it is a real auth.users row) ────────────────
CREATE OR REPLACE FUNCTION public.sepay_set_system_actor(p_actor_id uuid)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_super_admin');
  END IF;
  IF p_actor_id IS NULL OR NOT EXISTS (SELECT 1 FROM auth.users u WHERE u.id = p_actor_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_a_real_user');
  END IF;
  UPDATE public.sepay_system_settings
    SET system_actor_id = p_actor_id, updated_at = now(), updated_by = auth.uid()
    WHERE id = true;
  RETURN jsonb_build_object('ok', true, 'system_actor_id', p_actor_id);
END;
$$;

-- ── global DB kill-switch (super_admin only) ──────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.sepay_set_auto_confirm_enabled(p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_super_admin');
  END IF;
  UPDATE public.sepay_system_settings
    SET auto_confirm_enabled = COALESCE(p_enabled, false), updated_at = now(), updated_by = auth.uid()
    WHERE id = true;
  RETURN jsonb_build_object('ok', true, 'auto_confirm_enabled', COALESCE(p_enabled, false));
END;
$$;

-- ── per-club opt-in: add/remove the bot as a club_cashiers member (super_admin only) ──────────────────
CREATE OR REPLACE FUNCTION public.sepay_set_club_autoconfirm(p_club_id uuid, p_enabled boolean)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid;
BEGIN
  IF NOT public.has_role(auth.uid(), 'super_admin'::public.app_role) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'not_super_admin');
  END IF;
  IF p_club_id IS NULL OR NOT EXISTS (SELECT 1 FROM public.clubs c WHERE c.id = p_club_id) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'club_not_found');
  END IF;
  SELECT system_actor_id INTO v_actor FROM public.sepay_system_settings WHERE id = true;
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'system_actor_not_set');
  END IF;
  IF p_enabled THEN
    INSERT INTO public.club_cashiers (club_id, user_id, granted_by)
      VALUES (p_club_id, v_actor, auth.uid())
      ON CONFLICT (club_id, user_id) DO NOTHING;
  ELSE
    DELETE FROM public.club_cashiers WHERE club_id = p_club_id AND user_id = v_actor;
  END IF;
  RETURN jsonb_build_object('ok', true, 'club_id', p_club_id, 'enabled', COALESCE(p_enabled, false));
END;
$$;

REVOKE ALL ON FUNCTION public.sepay_set_system_actor(uuid)            FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sepay_set_system_actor(uuid)            TO authenticated;
REVOKE ALL ON FUNCTION public.sepay_set_auto_confirm_enabled(boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sepay_set_auto_confirm_enabled(boolean) TO authenticated;
REVOKE ALL ON FUNCTION public.sepay_set_club_autoconfirm(uuid, boolean) FROM PUBLIC, anon;
GRANT  EXECUTE ON FUNCTION public.sepay_set_club_autoconfirm(uuid, boolean) TO authenticated;
