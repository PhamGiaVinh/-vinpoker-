-- ============================================================================
-- void_registration — cancel a CONFIRMED registration + free its seat + refund
-- ============================================================================
-- SOURCE-ONLY (authored here; applied later in a controlled, owner-gated DB
-- session — NOT by `supabase db push`). Companion to the pending-cancel path
-- (a plain UPDATE status='cancelled' done client-side for status='pending').
--
-- Why an RPC (not a client UPDATE): voiding a CONFIRMED registration must cascade
-- atomically — free the live seat, cancel the entry, cancel the receipt, and flip
-- the registration — and must run as the trusted actor. A client cannot do this
-- atomically and RLS-safely.
--
-- Revenue: tournament rake in get_club_finance_summary =
--   tournaments.rake_amount * count(tournament_registrations WHERE status='confirmed').
-- Setting status='cancelled' drops this registration from that count, so the rake
-- auto-reverses on the next read. No reversal row is written.
--
-- Security: actor = auth.uid() ONLY (no client actor id — anti-spoof, matches the
-- guard-v2 pattern); SECURITY DEFINER; SET search_path = public; owner/club_cashier
-- gate; PUBLIC/anon EXECUTE revoked.
--
-- Voidable states: registration must be 'confirmed'; if it produced an entry, that
-- entry must still be 'registered' or 'seated' (a 'busted'/'finished' player is past
-- a clean void — use re-entry instead). A confirmed registration with NO entry
-- (legacy already_confirmed_no_entry class) voids the registration only.
-- ============================================================================

CREATE OR REPLACE FUNCTION public.void_registration(
  p_registration_id UUID,
  p_reason          TEXT DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor_user_id UUID := auth.uid();
  v_authorized    BOOLEAN;
  v_reg           RECORD;
  v_entry         RECORD;
  v_reason        TEXT := NULLIF(TRIM(p_reason), '');
  v_refund        BIGINT;
  v_freed_seat    INTEGER;
BEGIN
  -- 0. Actor from auth.uid() ONLY.
  IF v_actor_user_id IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 1. Lock the registration.
  SELECT * INTO v_reg
  FROM public.tournament_registrations
  WHERE id = p_registration_id
  FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'registration_not_found');
  END IF;

  -- 2. Must be confirmed (pending → use the client pending-cancel path).
  IF v_reg.status = 'cancelled' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_cancelled');
  END IF;
  IF v_reg.status <> 'confirmed' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'invalid_status', 'status', v_reg.status);
  END IF;

  -- 3. Authorization (owner or club_cashier of the tournament's club).
  SELECT EXISTS (
    SELECT 1 FROM public.tournaments t
    LEFT JOIN public.clubs c ON c.id = t.club_id
    LEFT JOIN public.club_cashiers cc ON cc.club_id = t.club_id AND cc.user_id = v_actor_user_id
    WHERE t.id = v_reg.tournament_id
      AND (c.owner_id = v_actor_user_id OR cc.user_id IS NOT NULL)
  ) INTO v_authorized;
  IF NOT v_authorized THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 4. Find the entry this registration produced (latest). If present it must still
  --    be voidable. A SELECT INTO with no row leaves v_entry.* NULL (FOUND=false).
  SELECT * INTO v_entry
  FROM public.tournament_entries
  WHERE registration_id = p_registration_id
  ORDER BY created_at DESC
  LIMIT 1;

  IF FOUND AND v_entry.status NOT IN ('registered', 'seated') THEN
    RETURN jsonb_build_object('ok', false, 'error', 'entry_not_voidable', 'entry_status', v_entry.status);
  END IF;

  v_refund := COALESCE(v_reg.total_pay,
                       COALESCE(v_reg.buy_in, 0) + COALESCE(v_reg.platform_fixed_fee, 0));

  -- 5. If there is an entry, cascade: free seat → cancel entry → cancel receipt.
  IF v_entry.id IS NOT NULL THEN
    -- Free the live seat. status='cancelled' is a valid tournament_seats status;
    -- the sync trigger flips is_active=false when status changes, vacating the slot.
    UPDATE public.tournament_seats
    SET status = 'cancelled'
    WHERE entry_id = v_entry.id AND is_active = true
    RETURNING seat_number INTO v_freed_seat;

    UPDATE public.tournament_entries
    SET status = 'cancelled'
    WHERE id = v_entry.id;

    UPDATE public.seat_draw_receipts
    SET status = 'cancelled', cancelled_at = now()
    WHERE entry_id = v_entry.id AND status IN ('issued', 'printed');
  END IF;

  -- 6. Cancel the registration (revenue auto-reverses — see header).
  UPDATE public.tournament_registrations
  SET status = 'cancelled',
      cancelled_at = now(),
      cancelled_by = v_actor_user_id,
      cancellation_reason = COALESCE(v_reason, 'void')
  WHERE id = p_registration_id;

  RETURN jsonb_build_object(
    'ok', true,
    'registration_id', p_registration_id,
    'entry_id', v_entry.id,
    'freed_seat_number', v_freed_seat,
    'refund_amount', v_refund,
    'reference_code', v_reg.reference_code
  );
END;
$$;

REVOKE ALL ON FUNCTION public.void_registration(UUID, TEXT) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION public.void_registration(UUID, TEXT) TO authenticated;
