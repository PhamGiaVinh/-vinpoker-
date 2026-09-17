-- Bankroll safety: user deletes are reversible for seven days.
-- This migration intentionally moves all delete/purge authority to server-side functions.

ALTER TABLE public.bankroll_entries
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz,
  ADD COLUMN IF NOT EXISTS deleted_by uuid,
  ADD COLUMN IF NOT EXISTS delete_reason text,
  ADD COLUMN IF NOT EXISTS purge_after timestamptz;

CREATE INDEX IF NOT EXISTS idx_bankroll_entries_user_active_date
  ON public.bankroll_entries(user_id, entry_date DESC)
  WHERE deleted_at IS NULL;

CREATE INDEX IF NOT EXISTS idx_bankroll_entries_purge_after
  ON public.bankroll_entries(purge_after)
  WHERE deleted_at IS NOT NULL;

CREATE TABLE IF NOT EXISTS public.bankroll_entry_audit (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  entry_id uuid NOT NULL,
  user_id uuid NOT NULL,
  actor_id uuid,
  operation text NOT NULL CHECK (operation IN ('soft_deleted', 'restored', 'purged')),
  reason text,
  metadata jsonb NOT NULL DEFAULT '{}'::jsonb,
  created_at timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS idx_bankroll_entry_audit_entry_created
  ON public.bankroll_entry_audit(entry_id, created_at DESC);

ALTER TABLE public.bankroll_entry_audit ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.bankroll_entry_audit FROM PUBLIC, anon, authenticated;

-- Active records can be edited directly; deletion fields are server-owned.
DROP POLICY IF EXISTS "Users insert own bankroll entries" ON public.bankroll_entries;
CREATE POLICY "Users insert own bankroll entries"
ON public.bankroll_entries FOR INSERT
WITH CHECK (auth.uid() = user_id AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Users update own bankroll entries" ON public.bankroll_entries;
CREATE POLICY "Users update own bankroll entries"
ON public.bankroll_entries FOR UPDATE
USING (auth.uid() = user_id AND deleted_at IS NULL)
WITH CHECK (auth.uid() = user_id AND deleted_at IS NULL);

DROP POLICY IF EXISTS "Users delete own bankroll entries" ON public.bankroll_entries;
REVOKE DELETE, TRUNCATE ON TABLE public.bankroll_entries FROM PUBLIC, anon, authenticated;
REVOKE UPDATE (deleted_at, deleted_by, delete_reason, purge_after)
  ON TABLE public.bankroll_entries FROM PUBLIC, anon, authenticated;

CREATE OR REPLACE FUNCTION public.soft_delete_bankroll_entry(
  p_entry_id uuid,
  p_reason text DEFAULT 'user_requested'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'user_requested'), 120);
  v_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.bankroll_entries
  SET deleted_at = v_now,
      deleted_by = v_actor,
      delete_reason = v_reason,
      purge_after = v_now + interval '7 days',
      updated_at = v_now
  WHERE id = p_entry_id
    AND user_id = v_actor
    AND deleted_at IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RAISE EXCEPTION 'bankroll_entry_not_found_or_already_deleted';
  END IF;

  INSERT INTO public.bankroll_entry_audit(entry_id, user_id, actor_id, operation, reason)
  VALUES (p_entry_id, v_actor, v_actor, 'soft_deleted', v_reason);

  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.soft_delete_all_bankroll_entries(
  p_reason text DEFAULT 'user_requested_bulk'
)
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_now timestamptz := clock_timestamp();
  v_reason text := left(coalesce(nullif(trim(p_reason), ''), 'user_requested_bulk'), 120);
  v_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  WITH marked AS (
    UPDATE public.bankroll_entries
    SET deleted_at = v_now,
        deleted_by = v_actor,
        delete_reason = v_reason,
        purge_after = v_now + interval '7 days',
        updated_at = v_now
    WHERE user_id = v_actor
      AND deleted_at IS NULL
    RETURNING id, user_id
  )
  INSERT INTO public.bankroll_entry_audit(entry_id, user_id, actor_id, operation, reason)
  SELECT id, user_id, v_actor, 'soft_deleted', v_reason
  FROM marked;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

CREATE OR REPLACE FUNCTION public.restore_bankroll_entry(p_entry_id uuid)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor uuid := auth.uid();
  v_count integer;
BEGIN
  IF v_actor IS NULL THEN
    RAISE EXCEPTION 'not_authenticated';
  END IF;

  UPDATE public.bankroll_entries
  SET deleted_at = NULL,
      deleted_by = NULL,
      delete_reason = NULL,
      purge_after = NULL,
      updated_at = clock_timestamp()
  WHERE id = p_entry_id
    AND user_id = v_actor
    AND deleted_at IS NOT NULL
    AND purge_after IS NOT NULL
    AND purge_after > clock_timestamp();

  GET DIAGNOSTICS v_count = ROW_COUNT;
  IF v_count = 0 THEN
    RETURN false;
  END IF;

  INSERT INTO public.bankroll_entry_audit(entry_id, user_id, actor_id, operation)
  VALUES (p_entry_id, v_actor, v_actor, 'restored');

  RETURN true;
END;
$$;

CREATE OR REPLACE FUNCTION public.purge_deleted_bankroll_entries()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count integer;
BEGIN
  WITH deleted AS (
    DELETE FROM public.bankroll_entries
    WHERE deleted_at IS NOT NULL
      AND purge_after IS NOT NULL
      AND purge_after <= clock_timestamp()
    RETURNING id, user_id, delete_reason
  )
  INSERT INTO public.bankroll_entry_audit(entry_id, user_id, operation, reason, metadata)
  SELECT id, user_id, 'purged', delete_reason,
         jsonb_build_object('purged_at', clock_timestamp())
  FROM deleted;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.purge_deleted_bankroll_entries() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.soft_delete_bankroll_entry(uuid, text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.soft_delete_all_bankroll_entries(text) FROM PUBLIC;
REVOKE ALL ON FUNCTION public.restore_bankroll_entry(uuid) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.soft_delete_bankroll_entry(uuid, text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.soft_delete_all_bankroll_entries(text) TO authenticated;
GRANT EXECUTE ON FUNCTION public.restore_bankroll_entry(uuid) TO authenticated;

CREATE EXTENSION IF NOT EXISTS pg_cron;

DO $$
BEGIN
  IF EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'purge-deleted-bankroll-entries') THEN
    PERFORM cron.unschedule('purge-deleted-bankroll-entries');
  END IF;
END
$$;

SELECT cron.schedule(
  'purge-deleted-bankroll-entries',
  '15 * * * *',
  $$ SELECT public.purge_deleted_bankroll_entries(); $$
);
