-- Marketing module (MKT-7 Part 2) — auto-content config + service-role draft generator.
-- DEPENDS ON 000002 (marketing_posts/compliance). SOURCE-ONLY; applied via the marketing-apply workflow.
--
-- WHY: the bots auto-generate marketing posts from ops data (tomorrow's schedule / livestream /
-- overlay) on a schedule. Owner-locked behaviour: generated posts are DRAFTS only (never auto-sent);
-- compliance hard-block runs at creation; idempotency is HARD (one draft per key, never updated).
--
-- NOTE: publish-time compliance is ALREADY enforced — marketing_schedule_post (000006) re-runs
-- marketing_check_compliance before draft→scheduled. So a draft inserted as compliance_status='blocked'
-- can never be published even via the API (the UI also disables the button). No schedule_post change here.

-- ===========================================================================================
-- 1. Per-club auto-content config (one row per club).
-- ===========================================================================================
CREATE TABLE IF NOT EXISTS public.marketing_auto_jobs (
  club_id    uuid NOT NULL PRIMARY KEY REFERENCES public.clubs(id) ON DELETE CASCADE,
  enabled    boolean NOT NULL DEFAULT false,
  kinds      text[] NOT NULL DEFAULT '{}',          -- subset of {schedule,livestream,overlay}
  channels   jsonb  NOT NULL DEFAULT '[]'::jsonb,   -- subset of marketing_channel values
  updated_by uuid,
  created_at timestamptz NOT NULL DEFAULT now(),
  updated_at timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.marketing_auto_jobs ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON public.marketing_auto_jobs FROM PUBLIC, anon, authenticated;
GRANT SELECT ON public.marketing_auto_jobs TO authenticated;
GRANT SELECT ON public.marketing_auto_jobs TO service_role;  -- the cron reads enabled clubs
DROP POLICY IF EXISTS marketing_auto_jobs_select ON public.marketing_auto_jobs;
CREATE POLICY marketing_auto_jobs_select ON public.marketing_auto_jobs
  FOR SELECT TO authenticated
  USING (public.is_club_owner(auth.uid(), club_id) OR public.is_club_marketer(auth.uid(), club_id));
-- Writes are RPC-only (owner-gated below); no client INSERT/UPDATE policy.

-- ===========================================================================================
-- 2. Owner read/write config. Validates kinds + channels (P2-9).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_get_auto_job(p_club_id uuid)
RETURNS jsonb
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid(); v_row public.marketing_auto_jobs;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT (public.is_club_owner(v_uid, p_club_id) OR public.is_club_marketer(v_uid, p_club_id)) THEN
    RETURN jsonb_build_object('error', 'Forbidden');
  END IF;
  SELECT * INTO v_row FROM public.marketing_auto_jobs WHERE club_id = p_club_id;
  RETURN jsonb_build_object(
    'status', 'ok',
    'enabled', COALESCE(v_row.enabled, false),
    'kinds', COALESCE(to_jsonb(v_row.kinds), '[]'::jsonb),
    'channels', COALESCE(v_row.channels, '[]'::jsonb)
  );
END;
$$;

CREATE OR REPLACE FUNCTION public.marketing_set_auto_job(
  p_club_id  uuid,
  p_enabled  boolean,
  p_kinds    text[],
  p_channels jsonb
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE v_uid uuid := auth.uid();
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;
  -- P2-9: only known kinds + channels.
  IF p_kinds IS NULL OR EXISTS (
    SELECT 1 FROM unnest(p_kinds) k WHERE k NOT IN ('schedule', 'livestream', 'overlay')
  ) THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'kinds'); END IF;
  IF p_channels IS NULL OR jsonb_typeof(p_channels) <> 'array' OR EXISTS (
    SELECT 1 FROM jsonb_array_elements_text(p_channels) c WHERE c NOT IN ('telegram', 'facebook', 'zalo')
  ) THEN RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'channels'); END IF;

  INSERT INTO public.marketing_auto_jobs (club_id, enabled, kinds, channels, updated_by)
  VALUES (p_club_id, COALESCE(p_enabled, false), p_kinds, p_channels, v_uid)
  ON CONFLICT (club_id) DO UPDATE
    SET enabled = EXCLUDED.enabled, kinds = EXCLUDED.kinds, channels = EXCLUDED.channels,
        updated_by = EXCLUDED.updated_by, updated_at = now();
  RETURN jsonb_build_object('status', 'ok', 'club_id', p_club_id);
END;
$$;

-- ===========================================================================================
-- 3. Service-role draft generator. Compliance hard-block at creation; HARD idempotency (P1-2a:
--    ON CONFLICT DO NOTHING — never updates an existing draft). Always status='draft' (never sends).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.marketing_create_auto_draft(
  p_club_id           uuid,
  p_kind              text,
  p_title             text,
  p_body              text,
  p_channels          jsonb,
  p_source_ref        jsonb,
  p_client_request_id text
) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public
AS $$
DECLARE
  v_comp   jsonb;
  v_status public.marketing_compliance_status := 'clean';
  v_flags  jsonb := '[]'::jsonb;
  v_id     uuid;
BEGIN
  IF p_body IS NULL OR length(btrim(p_body)) = 0 THEN
    RETURN jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'body');
  END IF;
  v_comp := public.marketing_check_compliance(p_club_id, COALESCE(p_title, '') || ' ' || p_body);
  IF (v_comp->>'status') = 'blocked' THEN v_status := 'blocked'; v_flags := v_comp->'flags'; END IF;

  INSERT INTO public.marketing_posts
    (club_id, title, body, channels, media_urls, hashtags, utm, status,
     compliance_status, compliance_flags, source_kind, source_ref, client_request_id, created_by)
  VALUES (p_club_id, NULLIF(btrim(COALESCE(p_title, '')), ''), btrim(p_body),
          COALESCE(p_channels, '[]'::jsonb), '[]'::jsonb, '{}', '{}'::jsonb, 'draft',
          v_status, v_flags, 'auto_event', p_source_ref, p_client_request_id, NULL)
  ON CONFLICT (club_id, client_request_id) DO NOTHING
  RETURNING id INTO v_id;

  IF v_id IS NULL THEN RETURN jsonb_build_object('status', 'skipped', 'reason', 'exists'); END IF;
  RETURN jsonb_build_object('status', 'ok', 'post_id', v_id, 'compliance', v_status);
END;
$$;

-- ===========================================================================================
-- 4. Grants.
-- ===========================================================================================
REVOKE ALL ON FUNCTION public.marketing_get_auto_job(uuid)                        FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_set_auto_job(uuid, boolean, text[], jsonb) FROM PUBLIC, anon;
REVOKE ALL ON FUNCTION public.marketing_create_auto_draft(uuid, text, text, text, jsonb, jsonb, text) FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_get_auto_job(uuid)                         TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_set_auto_job(uuid, boolean, text[], jsonb) TO authenticated;
GRANT EXECUTE ON FUNCTION public.marketing_create_auto_draft(uuid, text, text, text, jsonb, jsonb, text) TO service_role;

-- ===========================================================================================
-- TEST PLAN (tx + ROLLBACK):
--   SET LOCAL request.jwt.claim.sub='<owner>';
--   SELECT public.marketing_set_auto_job('<club>', true, ARRAY['schedule','overlay'], '["telegram"]'::jsonb); -- ok
--   SELECT public.marketing_set_auto_job('<club>', true, ARRAY['chipleader'], '["telegram"]'::jsonb);          -- INVALID_INPUT kinds
--   SELECT public.marketing_get_auto_job('<club>');                                                            -- enabled/kinds/channels
--   RESET request.jwt.claim.sub; SET ROLE service_role;
--   SELECT public.marketing_create_auto_draft('<club>','schedule','T','Lịch ngày mai ...','["telegram"]'::jsonb,'{"kind":"schedule"}'::jsonb,'auto:schedule:<club>:2026-06-26'); -- ok, draft
--   SELECT public.marketing_create_auto_draft('<club>','schedule','T','...','["telegram"]'::jsonb,'{}'::jsonb,'auto:schedule:<club>:2026-06-26'); -- skipped (idempotent)
--   RESET ROLE;
--   SET LOCAL request.jwt.claim.sub='<other>';
--   SELECT public.marketing_create_auto_draft(...);  -- denied (service_role only)
-- ROLLBACK;
--
-- ROLLBACK (undo):
--   DROP FUNCTION IF EXISTS public.marketing_create_auto_draft(uuid, text, text, text, jsonb, jsonb, text);
--   DROP FUNCTION IF EXISTS public.marketing_set_auto_job(uuid, boolean, text[], jsonb);
--   DROP FUNCTION IF EXISTS public.marketing_get_auto_job(uuid);
--   DROP TABLE IF EXISTS public.marketing_auto_jobs;
-- ===========================================================================================
