-- Auto-cancel function (idempotent, race-safe)
CREATE OR REPLACE FUNCTION public.auto_cancel_expired_commits()
RETURNS integer
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  r RECORD;
  cnt integer := 0;
BEGIN
  FOR r IN
    SELECT id, backer_id
    FROM public.staking_deals
    WHERE status = 'committed'
      AND committed_at IS NOT NULL
      AND committed_at < (NOW() - INTERVAL '30 minutes')
    FOR UPDATE SKIP LOCKED
  LOOP
    UPDATE public.staking_deals
    SET status = 'listing',
        backer_id = NULL,
        committed_at = NULL,
        transfer_proof_submitted = false,
        transfer_proof_image_url = NULL,
        cancellation_reason = 'auto_cancelled_timeout',
        updated_at = NOW()
    WHERE id = r.id
      AND status = 'committed';

    INSERT INTO public.staking_audit_logs (deal_id, action, performed_by, old_status, new_status, metadata)
    VALUES (
      r.id,
      'auto_cancelled_timeout',
      NULL,
      'committed',
      'listing',
      jsonb_build_object(
        'reason', 'Backer did not complete bank transfer within 30 minutes',
        'released_backer_id', r.backer_id
      )
    );
    cnt := cnt + 1;
  END LOOP;
  RETURN cnt;
END;
$$;

REVOKE EXECUTE ON FUNCTION public.auto_cancel_expired_commits() FROM PUBLIC, anon, authenticated;

-- Schedule every 5 minutes (drop existing schedule first if any)
DO $$
DECLARE jid bigint;
BEGIN
  SELECT jobid INTO jid FROM cron.job WHERE jobname = 'auto-cancel-staking-commits';
  IF jid IS NOT NULL THEN
    PERFORM cron.unschedule(jid);
  END IF;
END$$;

SELECT cron.schedule(
  'auto-cancel-staking-commits',
  '*/5 * * * *',
  $$SELECT public.auto_cancel_expired_commits();$$
);