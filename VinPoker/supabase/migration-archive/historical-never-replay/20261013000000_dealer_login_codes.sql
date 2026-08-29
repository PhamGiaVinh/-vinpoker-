-- ═══════════════════════════════════════════════════════════════════════════
-- Dealer-app link-code login (/code) — store for one-time login codes (SOURCE-ONLY)
-- Date: 2026-10-13  ·  Spec: docs/dealer-app/DEALER_LINK_CODE_LOGIN.md
--
-- WHY: the Telegram bot command /code (aliases /malienket, /malien) issues a verified dealer a
--   short, one-time login code; the dealer enters it in the dealer app and the dealer-code-login
--   edge fn exchanges it for a real Supabase session (via verifyOtp). This table holds the codes.
--
-- SECURITY: stores only sha256(code) (never plaintext); single-use + short TTL enforced by the edge
--   via an atomic UPDATE … WHERE used=false AND expires_at>now() RETURNING. service_role-only
--   (RLS on + no policy; grants stripped from anon/authenticated) — the bot + edge use service_role.
--   user_id is the dealer's EXISTING auth account (set by /setup); a code never creates an account.
--
-- SAFETY: source-only. NO db push / deploy_db / schema_migrations write. Additive + idempotent.
--   Apply = separate owner-gated controlled op. Rollback: PRE_20261013_dealer_login_codes.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

CREATE TABLE IF NOT EXISTS public.dealer_login_codes (
  code_hash        text        PRIMARY KEY,         -- sha256 hex of the plaintext code
  user_id          uuid        NOT NULL,            -- dealer's existing auth.users id (dealers.user_id)
  dealer_id        uuid,
  telegram_user_id bigint,                          -- who requested it (audit only)
  expires_at       timestamptz NOT NULL,
  used             boolean     NOT NULL DEFAULT false,
  created_at       timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_dealer_login_codes_expires ON public.dealer_login_codes (expires_at);
CREATE INDEX IF NOT EXISTS idx_dealer_login_codes_user    ON public.dealer_login_codes (user_id);

ALTER TABLE public.dealer_login_codes ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.dealer_login_codes FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.dealer_login_codes TO service_role;

COMMENT ON TABLE public.dealer_login_codes IS
  'One-time dealer-app login codes issued by the Telegram /code command. sha256-hashed, single-use,
   short TTL; redeemed by the dealer-code-login edge fn → Supabase verifyOtp. service_role-only.';

COMMIT;
