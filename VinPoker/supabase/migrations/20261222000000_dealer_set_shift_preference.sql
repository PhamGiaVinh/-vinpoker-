-- 20261222000000_dealer_set_shift_preference.sql
--
-- Dealer self-service: a dealer sets their OWN auto-fill shift preference
-- (dealers.shift_preference ∈ som | muon | linh_hoat | NULL) from the dealer app.
--
-- Why an RPC: the dealers table write policies (20260522000001 dealers_update_control)
-- allow UPDATE only for dealer_control / super_admin — a dealer cannot write their
-- own row directly. This SECURITY-DEFINER RPC is the dealer's only write path,
-- authorised by _dealer_user_owns (dealers.user_id = auth.uid()), exactly mirroring
-- dealer_submit_availability / dealer_request_leave_or_swap (20260906000000). It
-- touches ONLY dealers.shift_preference — never swing / attendance / payroll.
--
-- Requires the shift_preference column (20261220000000, owner-applied).
-- SOURCE-ONLY: apply is owner-gated (SQL editor). authenticated only, never anon.

CREATE OR REPLACE FUNCTION public.dealer_set_shift_preference(
  p_dealer_id uuid,
  p_preference text DEFAULT NULL
)
RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_updated boolean;
BEGIN
  IF NOT public._dealer_user_owns(p_dealer_id) THEN
    RAISE EXCEPTION 'not authorized for dealer %', p_dealer_id;
  END IF;

  -- NULL clears the preference (back to flexible). Any other value must be valid.
  IF p_preference IS NOT NULL AND p_preference NOT IN ('som', 'muon', 'linh_hoat') THEN
    RETURN jsonb_build_object('outcome', 'invalid_preference', 'preference', p_preference);
  END IF;

  UPDATE public.dealers
    SET shift_preference = p_preference
    WHERE id = p_dealer_id
    RETURNING true INTO v_updated;

  IF v_updated IS NULL THEN
    RETURN jsonb_build_object('outcome', 'not_found');
  END IF;

  RETURN jsonb_build_object('outcome', 'updated', 'dealer_id', p_dealer_id, 'preference', p_preference);
END;
$$;

REVOKE ALL ON FUNCTION public.dealer_set_shift_preference(uuid, text) FROM PUBLIC, anon;
GRANT EXECUTE ON FUNCTION public.dealer_set_shift_preference(uuid, text) TO authenticated;

COMMENT ON FUNCTION public.dealer_set_shift_preference(uuid, text) IS
  'Dealer self-service: set own dealers.shift_preference (som|muon|linh_hoat|NULL). Auth via _dealer_user_owns; authenticated only.';
