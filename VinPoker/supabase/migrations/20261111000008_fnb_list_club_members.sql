-- F&B module (FNB-F4-pre) — staff/account search for role assignment. DEPENDS ON 000001
-- (club_fnb_staff, fnb_role_kind, is_club_owner). SOURCE-ONLY.
--
-- Apply in a controlled session (Supabase SQL Editor / Management API), owner-gated, AFTER owner
-- review. NOT `db push` / not deploy_db. schema_migrations untouched. Number 20261111000008 is FREE
-- on origin/main (no 20261111* on main; main at 20261117 SePay; F&B series independent of SePay).
--
-- WHY: FnbStaffManager (F4) needs to find an account, then toggle its cashier/server/kitchen facets
-- (fnb_grant_staff / fnb_revoke_staff already live in 000001). There is no client-readable search
-- path today (club_fnb_staff is SELECT-only per-row; public.profiles has its own RLS). This adds ONE
-- read RPC and nothing else.
--
-- DESIGN — clone of the LIVE `marketing_list_club_members(uuid, text)` in 20261101000005: it searches
-- ALL registered accounts in public.profiles, so the owner can grant F&B roles to staff who are NOT
-- poker members (a barista, a kitchen hand, …), returning ONLY safe columns + the 3 current facet
-- flags for THIS club.
--   ⚠ NOTE vs the plan text: Part 2 sketched a 1-arg `fnb_list_club_members(p_club_id)` over
--   union(club_members ∪ club_fnb_staff). This uses the proven 2-arg profiles-search instead. The
--   RETURN CONTRACT is IDENTICAL — {members:[{user_id,name,phone,is_cashier,is_server,is_kitchen}]} —
--   only the candidate pool is broader (all accounts, not just this club's members). Owner: confirm
--   this scope at review; if you want it narrowed to club members only, say so and I'll swap the FROM.
--
-- THE P3-LEVEL GUARANTEES (read-only, but the same posture as a P3 RPC):
--   (1) OWNER-ONLY: is_club_owner(auth.uid(), p_club_id). A cashier/server/kitchen facet holder can
--       NOT enumerate accounts — only the club owner assigns roles (§7).
--   (2) READ-ONLY: STABLE, no INSERT/UPDATE/DELETE — it cannot mutate anything.
--   (3) SAFE COLUMNS ONLY: returns user_id + display_name + phone + the 3 facet booleans; never email,
--       auth secrets, or any other profiles column. SECURITY DEFINER (so it does not depend on
--       profiles RLS), but the SELECT list is fixed to these safe columns.
--   (4) BOUNDED + club-scoped: LIMIT 500 (browse) / 100 (search), server-side, so an owner cannot dump
--       the whole table unbounded; the facet flags are computed against p_club_id only (no cross-club
--       leak — owning club A never reveals a user's facets in club B).
--   (5) SECURITY DEFINER + SET search_path = public + REVOKE PUBLIC/anon + GRANT authenticated.

-- ===========================================================================================
-- fnb_list_club_members — owner-only account search; returns each account's 3 F&B facet flags
-- for THIS club. Idempotent (CREATE OR REPLACE).
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_list_club_members(p_club_id uuid, p_query text)
RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid uuid := auth.uid();
  v_q   text := lower(btrim(COALESCE(p_query, '')));
  v_arr jsonb;
BEGIN
  IF v_uid IS NULL THEN RETURN jsonb_build_object('error', 'Unauthorized'); END IF;
  -- (1) owner-only — role assignment is not a cashier/server/kitchen task.
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  -- (3)(4) fixed safe columns + the 3 facet flags scoped to p_club_id; bounded; assigned staff first.
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id',    x.user_id,
    'name',       x.name,
    'phone',      x.phone,
    'is_cashier', x.is_cashier,
    'is_server',  x.is_server,
    'is_kitchen', x.is_kitchen
  )), '[]'::jsonb) INTO v_arr
  FROM (
    SELECT p.user_id,
           p.display_name AS name,
           p.phone,
           EXISTS (SELECT 1 FROM public.club_fnb_staff s
                    WHERE s.club_id = p_club_id AND s.user_id = p.user_id
                      AND s.kind = 'cashier'::public.fnb_role_kind) AS is_cashier,
           EXISTS (SELECT 1 FROM public.club_fnb_staff s
                    WHERE s.club_id = p_club_id AND s.user_id = p.user_id
                      AND s.kind = 'server'::public.fnb_role_kind)  AS is_server,
           EXISTS (SELECT 1 FROM public.club_fnb_staff s
                    WHERE s.club_id = p_club_id AND s.user_id = p.user_id
                      AND s.kind = 'kitchen'::public.fnb_role_kind) AS is_kitchen,
           EXISTS (SELECT 1 FROM public.club_fnb_staff s
                    WHERE s.club_id = p_club_id AND s.user_id = p.user_id)        AS is_any,
           p.created_at
    FROM public.profiles p
    WHERE v_q = ''
       OR lower(COALESCE(p.display_name, '')) LIKE '%' || v_q || '%'
       OR lower(COALESCE(p.phone, ''))        LIKE '%' || v_q || '%'
    -- assigned F&B staff first, then most-recent accounts; the search narrows the pool so the cap is safe.
    ORDER BY is_any DESC, p.created_at DESC NULLS LAST
    LIMIT CASE WHEN v_q = '' THEN 500 ELSE 100 END
  ) x;

  RETURN jsonb_build_object('status', 'ok', 'members', v_arr);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_list_club_members(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.fnb_list_club_members(uuid, text) TO authenticated;

-- ===========================================================================================
-- Controlled-apply TEST PLAN (after 000000..000001 + this; run in a tx + ROLLBACK).
--   Fixture: <owner> owns <club>; <cashier> has the cashier facet in <club>; <other> owns nothing.
--
-- BEGIN;
--   -- (1) a non-owner facet holder is refused:
--   SET LOCAL request.jwt.claim.sub = '<cashier>'; SELECT public.fnb_list_club_members('<club>', '');   -- {error: Forbidden}
--   SET LOCAL request.jwt.claim.sub = '<other>';   SELECT public.fnb_list_club_members('<club>', '');   -- {error: Forbidden}
--   -- owner browses (empty query) → {status:ok, members:[...]} capped at 500; <cashier> shows is_cashier=true:
--   SET LOCAL request.jwt.claim.sub = '<owner>';   SELECT public.fnb_list_club_members('<club>', '');
--   -- owner searches by name/phone (cap 100), facets reflect THIS club only:
--   SET LOCAL request.jwt.claim.sub = '<owner>';   SELECT public.fnb_list_club_members('<club>', 'barista');
--   -- (2) read-only: no rows changed anywhere (this is a SELECT-only function).
-- ROLLBACK;
--
-- Read-only VERIFY after apply (owner session): confirm grant + ownership + read-only.
--   SELECT proname, prosecdef, provolatile        -- prosecdef=t (definer), provolatile='s' (stable)
--     FROM pg_proc WHERE proname = 'fnb_list_club_members';
--   SELECT has_function_privilege('authenticated','public.fnb_list_club_members(uuid,text)','EXECUTE'); -- t
--   SELECT has_function_privilege('anon',         'public.fnb_list_club_members(uuid,text)','EXECUTE'); -- f
-- ===========================================================================================
--
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.fnb_list_club_members(uuid, text);
-- ===========================================================================================
