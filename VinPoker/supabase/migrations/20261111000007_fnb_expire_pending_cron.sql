-- F&B module (FNB-P7) — TTL auto-expire for stale PENDING orders. DEPENDS ON 000002 (tables).
--
-- SOURCE-ONLY migration. APPLY LAST among the F&B DB patches, in a controlled session (Management
-- API / `supabase db query --linked --file`, NOT `db push` / not deploy_db). schema_migrations is
-- NOT touched. pg_cron is already enabled in this project (used by marketing-dispatch /
-- auto_soft_delete_old_tournaments) — this migration does NOT create the extension.
--
-- WHY: a guest can place a table order (flow A) and walk away without paying. Such PENDING orders
-- must auto-expire so they don't clutter the counter queue. A PENDING order has moved NO stock and
-- NO money (stock/money happen only at PAID), so expiry is a PURE STATUS FLIP + an audit event —
-- nothing to reverse, no ledger, no finance impact.
--
-- SAFETY: the sweep takes the candidate PENDING rows with `FOR UPDATE SKIP LOCKED`, so it can NEVER
-- contend with an in-flight fnb_mark_paid (which holds FOR UPDATE on that order): a row being paid
-- right now is locked → skipped this tick; by the next tick it is already 'paid' → no longer a
-- candidate. So a paying customer can never have their order expired out from under them.
--
-- CADENCE: every 5 minutes (NOT every minute) — Supabase free-tier load consideration; a 15-min
-- default TTL needs no per-minute precision. Per-club TTL via fnb_settings.pending_ttl_secs (900s default).

-- ===========================================================================================
-- 1. The sweep function (set-based; proven SKIP-LOCKED claim idiom from marketing_claim_due_posts).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_expire_pending_orders()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_count int := 0;
BEGIN
  WITH due AS (
    SELECT o.id, o.club_id
    FROM public.fnb_orders o
    WHERE o.status = 'pending'
      AND o.created_at < now() - (
            COALESCE((SELECT s.pending_ttl_secs FROM public.fnb_settings s WHERE s.club_id = o.club_id), 900)
            * interval '1 second')
    FOR UPDATE SKIP LOCKED                       -- never contend with an in-flight fnb_mark_paid
  ),
  upd AS (
    UPDATE public.fnb_orders o
      SET status = 'expired', updated_at = now()
      FROM due
      WHERE o.id = due.id
      RETURNING o.id, o.club_id
  ),
  ev AS (
    INSERT INTO public.fnb_order_events (order_id, club_id, action, old_status, new_status)
    SELECT id, club_id, 'expired', 'pending', 'expired' FROM upd
    RETURNING 1
  )
  SELECT count(*) INTO v_count FROM upd;          -- PENDING never moved stock → pure status flip + event

  RETURN v_count;
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_expire_pending_orders() FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.fnb_expire_pending_orders() TO service_role;

-- ===========================================================================================
-- 2. Schedule it every 5 minutes — idempotent (only if not already scheduled).
-- ===========================================================================================
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'fnb-expire-pending') THEN
    PERFORM cron.schedule(
      'fnb-expire-pending',
      '*/5 * * * *',                              -- every 5 minutes (NOT every minute)
      $cron$ SELECT public.fnb_expire_pending_orders(); $cron$
    );
    RAISE NOTICE 'Scheduled fnb-expire-pending cron job';
  ELSE
    RAISE NOTICE 'fnb-expire-pending cron job already exists, skipping';
  END IF;
END $$;

-- Verify (run manually after apply):
--   SELECT jobname, schedule, command FROM cron.job WHERE jobname = 'fnb-expire-pending';
--   -- one PENDING order older than its TTL → run the sweep → it becomes 'expired' with an event:
--   SELECT public.fnb_expire_pending_orders();   -- returns count expired
--   SELECT status FROM public.fnb_orders WHERE id = '<order>';                  -- 'expired'
--   SELECT action FROM public.fnb_order_events WHERE order_id = '<order>' AND action = 'expired';
--
-- ROLLBACK:
--   SELECT cron.unschedule('fnb-expire-pending');
--   DROP FUNCTION IF EXISTS public.fnb_expire_pending_orders();
