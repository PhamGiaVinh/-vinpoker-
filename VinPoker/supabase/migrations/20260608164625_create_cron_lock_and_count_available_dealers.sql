-- Phase 5 PR #3: BUG #3 (shortage stale) + BUG #4 (force-release hybrid) + Gaps #4, #5, #6
-- Creates try_acquire_cron_lock, release_cron_lock, and count_available_dealers RPCs

-- ═══ Advisory lock functions for cron deduplication ═══
-- Used by run-dealer-ready-backup and future crons to prevent concurrent execution per club

CREATE OR REPLACE FUNCTION public.try_acquire_cron_lock(p_lock_name text)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_acquired boolean;
BEGIN
  SELECT pg_try_advisory_xact_lock(
    ('x' || md5(p_lock_name))::bit(64)::bigint
  ) INTO v_acquired;
  
  RETURN v_acquired;
END;
$$;

CREATE OR REPLACE FUNCTION public.release_cron_lock(p_lock_name text)
RETURNS void
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = 'public'
AS $$
BEGIN
  -- Transaction-level advisory locks are released automatically at COMMIT/ROLLBACK.
  -- This function exists for API symmetry with try_acquire_cron_lock.
  -- No explicit action needed.
  RETURN;
END;
$$;

-- ═══ count_available_dealers: real-time count of available dealers for a club ═══
-- Returns count of dealer_attendance rows in 'available' state for a club.
-- Joins through dealers to get club_id (dealer_attendance has no club_id column).
-- Used by Pass 3 shortage escalation for time-based recount.

CREATE OR REPLACE FUNCTION public.count_available_dealers(p_club_id uuid)
RETURNS integer
LANGUAGE plpgsql
STABLE SECURITY DEFINER
SET search_path = 'public'
AS $$
DECLARE
  v_count integer;
BEGIN
  SELECT COUNT(*) INTO v_count
  FROM public.dealer_attendance da
  JOIN public.dealers d ON d.id = da.dealer_id
  WHERE d.club_id = p_club_id
    AND da.current_state = 'available'
    AND da.status = 'checked_in'
    AND da.check_out_time IS NULL;
  
  RETURN COALESCE(v_count, 0);
END;
$$;

COMMENT ON FUNCTION public.try_acquire_cron_lock(text) IS
  'Phase 5 PR #3: Acquires a transaction-level advisory lock for cron deduplication.
   Returns true if lock acquired, false if already held by another session.
   Lock is released automatically at transaction end.';
COMMENT ON FUNCTION public.release_cron_lock(text) IS
  'Phase 5 PR #3: No-op for transaction-level advisory lock (released at COMMIT).
   Exists for API symmetry with try_acquire_cron_lock.';
COMMENT ON FUNCTION public.count_available_dealers(uuid) IS
  'Phase 5 PR #3: Returns count of available dealers for a club.
   Joins dealer_attendance with dealers via dealer_id to get club_id.
   Filters by current_state=available AND status=checked_in AND check_out_time IS NULL.
   Used by Pass 3 shortage escalation for time-based recount.';