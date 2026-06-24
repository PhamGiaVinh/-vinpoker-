-- Marketing module (MKT-5 follow-up) — search ALL registered accounts for role assignment.
-- DEPENDS ON 000001 (club_marketers) + 000004 (marketing_list_club_members). SOURCE-ONLY.
--
-- WHY: the staff role-assignment UI could only list this club's `club_members`, so a registered
-- account that isn't a member of the club (e.g. "athena") never appeared — not even on search.
-- The owner wants to grant the marketing role to ANY registered account (like the super-admin user
-- list). This adds a 2-arg overload that sources from `public.profiles` (all accounts) with a
-- server-side search, returning ONLY safe columns (display_name, phone) + the is_marketer flag.
-- Owner-gated + SECURITY DEFINER (so it doesn't depend on profiles RLS and never leaks extra cols).
--
-- Additive overload (the 1-arg marketing_list_club_members from 000004 is left intact). Idempotent.

CREATE OR REPLACE FUNCTION public.marketing_list_club_members(p_club_id uuid, p_query text)
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
  IF NOT public.is_club_owner(v_uid, p_club_id) THEN RETURN jsonb_build_object('error', 'Forbidden'); END IF;

  SELECT COALESCE(jsonb_agg(jsonb_build_object(
    'user_id', x.user_id, 'name', x.name, 'phone', x.phone, 'is_marketer', x.is_marketer
  )), '[]'::jsonb) INTO v_arr
  FROM (
    SELECT p.user_id,
           p.display_name AS name,
           p.phone,
           EXISTS (SELECT 1 FROM public.club_marketers m
                    WHERE m.club_id = p_club_id AND m.user_id = p.user_id) AS is_marketer,
           p.created_at
    FROM public.profiles p
    WHERE v_q = ''
       OR lower(COALESCE(p.display_name, '')) LIKE '%' || v_q || '%'
       OR lower(COALESCE(p.phone, ''))        LIKE '%' || v_q || '%'
    -- assigned marketers first, then most-recent accounts; search narrows the pool so the cap is safe.
    ORDER BY is_marketer DESC, p.created_at DESC NULLS LAST
    LIMIT CASE WHEN v_q = '' THEN 500 ELSE 100 END
  ) x;

  RETURN jsonb_build_object('status', 'ok', 'members', v_arr);
END;
$$;

REVOKE ALL ON FUNCTION public.marketing_list_club_members(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.marketing_list_club_members(uuid, text) TO authenticated;

-- ROLLBACK: DROP FUNCTION IF EXISTS public.marketing_list_club_members(uuid, text);
