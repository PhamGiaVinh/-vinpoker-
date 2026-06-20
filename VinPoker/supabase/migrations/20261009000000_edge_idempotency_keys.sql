-- ═══════════════════════════════════════════════════════════════════════════
-- B1.1 — Bulk-path idempotency DB foundation (SOURCE-ONLY; controlled apply later)
-- Date: 2026-10-09  ·  Contract: docs/dealer-swing/B1_BULK_IDEMPOTENCY_DESIGN.md
--
-- WHY: mass-assign / manage-break have no request-level idempotency → double-click / retry
--   → double-assign, duplicate break rows, unintended break extension. This adds the store +
--   atomic-claim helpers so an edge fn can dedup a logical action on a client-supplied key,
--   caching the AGGREGATE response (not a single effect row — that's why assign_dealer_to_table's
--   row-stored Step-0 key can't be reused for bulk). B1.2 wires the edge fns; until then NOTHING
--   changes (the table + helpers are simply unused).
--
-- DESIGN (owner-locked defaults from B1.0):
--   • Dedicated store edge_idempotency_keys, action-instance scoped (key = one user action).
--   • idem_begin = atomic claim (INSERT … ON CONFLICT DO NOTHING) + self-clean expired:
--       claimed=true               → caller executes, then idem_complete.
--       claimed=false,status=completed → caller returns the cached `response` (idempotent replay).
--       claimed=false,status=in_progress → caller returns 409 (concurrent dup → no double effect).
--       fingerprint_match=false    → caller returns 422 (key reused with a different payload).
--   • idem_complete stores the aggregate response + flips status→completed.
--   • TTL via expires_at; lazy delete-expired on each begin (mirrors try_acquire_club_lock).
--
-- SECURITY: SECURITY DEFINER + search_path=public; REVOKE PUBLIC/anon/authenticated + GRANT
--   service_role only (edge fns use the service-role key). Table: RLS ENABLED with NO policy
--   (service_role bypasses RLS) + grants stripped from anon/authenticated → strictly internal.
--
-- SAFETY: source-only. NO db push / deploy_db / schema_migrations write. Additive + idempotent
--   (CREATE TABLE/FUNCTION IF NOT EXISTS / OR REPLACE). Apply = separate owner-gated controlled op.
--   Rollback: docs/emergency_rollbacks/PRE_20261009_edge_idempotency_keys.sql
-- ═══════════════════════════════════════════════════════════════════════════

BEGIN;

-- 1. Store — one row per logical user action (key), caches the aggregate response.
CREATE TABLE IF NOT EXISTS public.edge_idempotency_keys (
  key                 text        PRIMARY KEY,
  scope               text        NOT NULL,
  club_id             uuid,
  actor_id            uuid,
  request_fingerprint text,
  status              text        NOT NULL DEFAULT 'in_progress'
                                  CHECK (status IN ('in_progress', 'completed')),
  response            jsonb,
  created_at          timestamptz NOT NULL DEFAULT now(),
  expires_at          timestamptz NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_edge_idempotency_keys_expires
  ON public.edge_idempotency_keys (expires_at);

-- Internal-only: RLS on with no policy (service_role bypasses RLS) + strip anon/authenticated grants.
ALTER TABLE public.edge_idempotency_keys ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON TABLE public.edge_idempotency_keys FROM PUBLIC, anon, authenticated;
GRANT ALL ON TABLE public.edge_idempotency_keys TO service_role;

-- 2. Atomic claim. Returns the decision the edge fn acts on.
CREATE OR REPLACE FUNCTION public.idem_begin(
  p_key         text,
  p_scope       text,
  p_club_id     uuid,
  p_actor_id    uuid,
  p_fingerprint text,
  p_ttl_seconds integer DEFAULT 86400
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_now      timestamptz := now();
  v_expires  timestamptz := v_now + (GREATEST(p_ttl_seconds, 60) || ' seconds')::interval;
  v_inserted text;
  v_row      public.edge_idempotency_keys%ROWTYPE;
BEGIN
  -- Self-clean expired keys (bounded growth), same idiom as the lock acquire.
  DELETE FROM edge_idempotency_keys WHERE expires_at < v_now;

  INSERT INTO edge_idempotency_keys
    (key, scope, club_id, actor_id, request_fingerprint, status, expires_at)
  VALUES
    (p_key, p_scope, p_club_id, p_actor_id, p_fingerprint, 'in_progress', v_expires)
  ON CONFLICT (key) DO NOTHING
  RETURNING key INTO v_inserted;

  IF v_inserted IS NOT NULL THEN
    -- We claimed it → caller executes the real work, then calls idem_complete.
    RETURN jsonb_build_object('claimed', true, 'status', 'in_progress',
                              'response', NULL, 'fingerprint_match', true);
  END IF;

  -- Key already exists → return the existing decision.
  SELECT * INTO v_row FROM edge_idempotency_keys WHERE key = p_key;
  RETURN jsonb_build_object(
    'claimed', false,
    'status', v_row.status,
    'response', v_row.response,
    'fingerprint_match', (v_row.request_fingerprint IS NOT DISTINCT FROM p_fingerprint)
  );
END;
$$;

-- 3. Complete — store the aggregate response + mark completed (only our in-progress claim).
CREATE OR REPLACE FUNCTION public.idem_complete(
  p_key      text,
  p_response jsonb
)
RETURNS boolean
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
BEGIN
  UPDATE edge_idempotency_keys
     SET status = 'completed', response = p_response
   WHERE key = p_key
     AND status = 'in_progress';
  RETURN FOUND;
END;
$$;

-- 4. Grants — service_role ONLY (REVOKE the default PUBLIC EXECUTE first; no exposure window).
REVOKE ALL ON FUNCTION public.idem_begin(text, text, uuid, uuid, text, integer) FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.idem_complete(text, jsonb)                        FROM PUBLIC, anon, authenticated;
GRANT EXECUTE ON FUNCTION public.idem_begin(text, text, uuid, uuid, text, integer) TO service_role;
GRANT EXECUTE ON FUNCTION public.idem_complete(text, jsonb)                        TO service_role;

COMMENT ON TABLE public.edge_idempotency_keys IS
  'B1.1: bulk-path idempotency store. One row per logical user action (client-supplied key),
   caches the aggregate edge response. service_role-only. Self-cleaning via expires_at.';

COMMIT;
