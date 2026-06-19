-- ═══════════════════════════════════════════════════════════════════════════
-- B2.2a — Club-lock fencing DB foundation (SOURCE-ONLY; controlled apply later)
-- Date: 2026-10-03
--
-- WHY: B2.1 only scaled the lease (reduces FM-1 overrun). FM-2 remains: the legacy
--   release_club_lock(club_id) deletes UNCONDITIONALLY, so an overran worker can delete
--   a NEW worker's lock → cascade. This migration adds the fencing primitives so a worker
--   can prove ownership (token) before extending/releasing. B2.2b wires process-swing to
--   them; until then NOTHING changes behavior — the legacy functions are untouched.
--
-- DESIGN (owner-locked):
--   • Additive only. Legacy try_acquire_club_lock(uuid,integer) / release_club_lock(uuid) /
--     cleanup_expired_club_locks() are LEFT BYTE-UNTOUCHED (backward compatible — live
--     process-swing keeps working before B2.2b).
--   • NEW function NAMES (no overloads, no ambiguous PostgREST dispatch).
--   • Tokened ownership: acquire returns a fresh lock_token; extend/release require it.
--   • Lost ownership (token mismatch or already-expired lease) → returns false (B2.2b ABORTS).
--   • Minimal reclaim logging via RAISE LOG; full metrics deferred to C3.
--
-- SAFETY: source-only. NO db push / deploy_db / schema_migrations write. Idempotent
--   (ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + idempotent GRANT). Apply is a separate
--   owner-gated controlled op. Rollback: docs/emergency_rollbacks/PRE_20261003_lock_fencing_foundation.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Additive fencing columns (nullable / default-safe; old-path acquires leave them NULL).
ALTER TABLE public.club_processing_locks ADD COLUMN IF NOT EXISTS lock_token        uuid;
ALTER TABLE public.club_processing_locks ADD COLUMN IF NOT EXISTS owner_id          text;
ALTER TABLE public.club_processing_locks ADD COLUMN IF NOT EXISTS last_heartbeat_at timestamptz;

-- 2. Tokened acquire (NEW name; mirrors legacy try_acquire_club_lock but stamps + returns a token).
--    Backward-compat: callers that only read `.acquired` still work. p_owner_id is human-readable
--    observability (the run/invocation id), distinct from locked_by (stays 'process-swing').
CREATE OR REPLACE FUNCTION public.try_acquire_club_lock_fenced(
  p_club_id uuid,
  p_timeout_seconds integer DEFAULT 120,
  p_owner_id text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now      timestamptz := NOW();
  v_token    uuid := gen_random_uuid();
  v_expires  timestamptz := v_now + (p_timeout_seconds || ' seconds')::interval;
  v_inserted uuid;
BEGIN
  -- Stale reclaim (identical semantics to legacy try_acquire_club_lock).
  DELETE FROM club_processing_locks WHERE expires_at < v_now;

  INSERT INTO club_processing_locks
    (club_id, locked_by, expires_at, lock_token, owner_id, last_heartbeat_at)
  VALUES
    (p_club_id, 'process-swing', v_expires, v_token, p_owner_id, v_now)
  ON CONFLICT (club_id) DO NOTHING
  RETURNING club_id INTO v_inserted;

  IF v_inserted IS NOT NULL THEN
    RETURN jsonb_build_object(
      'acquired', true,
      'lock_token', v_token,
      'owner_id', p_owner_id,
      'expires_at', v_expires
    );
  ELSE
    RETURN jsonb_build_object(
      'acquired', false,
      'lock_token', NULL,
      'owner_id', NULL,
      'expires_at', NULL
    );
  END IF;
END;
$$;

-- 3. Tokened heartbeat. Extends the lease ONLY if we still own it (token matches) AND it has
--    not already expired (an expired lease may have been reclaimed → treat as lost ownership).
--    Returns false on mismatch/expiry → B2.2b stops mutating and exits the club gracefully.
CREATE OR REPLACE FUNCTION public.extend_club_lock_lease(
  p_club_id uuid,
  p_lock_token uuid,
  p_timeout_seconds integer
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now timestamptz := NOW();
BEGIN
  UPDATE club_processing_locks
     SET expires_at = v_now + (p_timeout_seconds || ' seconds')::interval,
         last_heartbeat_at = v_now
   WHERE club_id = p_club_id
     AND lock_token = p_lock_token
     AND expires_at > v_now;
  IF NOT FOUND THEN
    RAISE LOG 'lock_fencing: extend lost ownership club=% (token mismatch or lease expired)', p_club_id;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

-- 4. Tokened release (NEW name; legacy release_club_lock(uuid) is KEPT, see note below).
--    Deletes ONLY our own lock → an overran worker with a stale token can no longer delete the
--    NEW owner's lock (fixes FM-2). Returns true only if it actually deleted our row.
CREATE OR REPLACE FUNCTION public.release_club_lock_if_owner(
  p_club_id uuid,
  p_lock_token uuid
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  DELETE FROM club_processing_locks
   WHERE club_id = p_club_id
     AND lock_token = p_lock_token;
  IF NOT FOUND THEN
    RAISE LOG 'lock_fencing: release skipped, not owner club=% (stale token — would have clobbered a successor)', p_club_id;
    RETURN false;
  END IF;
  RETURN true;
END;
$$;

-- NOTE: legacy try_acquire_club_lock(uuid,integer), release_club_lock(uuid) and
-- cleanup_expired_club_locks() are intentionally NOT modified here. process-swing keeps using
-- the legacy acquire+release until B2.2b; the old unconditional release_club_lock will be
-- removed/retired only AFTER B2.2b switches process-swing to the tokened functions.

-- 5. Grants — service_role ONLY. REVOKE the default PUBLIC EXECUTE FIRST (B2.2a P0):
--    these are SECURITY DEFINER lock primitives; if PUBLIC / anon / authenticated could
--    call them, any client could acquire a club lock (DoS process-swing) or probe ownership.
--    Revoking in the SAME transaction as the CREATE means the functions are NEVER committed
--    with a PUBLIC grant (no exposure window). Done in the same migration before COMMIT.
--    NOTE: legacy try_acquire_club_lock/release_club_lock/cleanup_expired_club_locks are NOT
--    revoked here — that is a separate, owner-gated hardening (B) after confirming no
--    non-service-role caller; this migration only hardens the NEW fenced functions (A).
REVOKE ALL ON FUNCTION public.try_acquire_club_lock_fenced(uuid, integer, text) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.extend_club_lock_lease(uuid, uuid, integer)        FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.release_club_lock_if_owner(uuid, uuid)             FROM PUBLIC, anon, authenticated;

GRANT EXECUTE ON FUNCTION public.try_acquire_club_lock_fenced(uuid, integer, text) TO service_role;
GRANT EXECUTE ON FUNCTION public.extend_club_lock_lease(uuid, uuid, integer)        TO service_role;
GRANT EXECUTE ON FUNCTION public.release_club_lock_if_owner(uuid, uuid)             TO service_role;

COMMIT;
