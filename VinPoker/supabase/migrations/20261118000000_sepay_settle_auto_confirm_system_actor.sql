-- SePay ingestion — Patch 2d: settle_bank_transaction auto-confirm via the SePay SYSTEM ACTOR.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session AFTER 20261117000000.
-- schema_migrations untouched.
--
-- WHAT CHANGES vs 20261113000000 (only the auto-confirm branch; the decision tree, fraud gate, exact-match
-- gate, lock order, idempotency, and ALL flag branches are BYTE-IDENTICAL):
--   • Drop the fake `c_system_actor` sentinel. The auto branch reads `system_actor_id` from
--     public.sepay_system_settings WHERE auto_confirm_enabled=true (the DB global kill-switch).
--   • If no actor (kill-switch off / not provisioned) → flag-only (return exact_match, write NOTHING, leave
--     bt unmatched) so a valid match stays recoverable and the cashier can still confirm.
--   • Gate 3 is checked EXPLICITLY via public.is_club_cashier(actor, club) BEFORE confirm (NOT inferred from
--     confirm's error string). Not opted in → flag-only. is_club_cashier uses the SAME predicate as confirm
--     guard 2.5 (owner ∪ club_cashiers), so pre-check pass ⇒ guard 2.5 passes.
--   • Otherwise IMPERSONATE the bot ONLY around the confirm call: SAVE the caller's claims, set
--     request.jwt.claims.sub = bot so auth.uid()=bot → confirm guard 2.4 (p_actor=auth.uid()) passes; RESTORE
--     the saved claims on EVERY path (success OR raise) via BEGIN/EXCEPTION + is_local, so the settlement
--     INSERT + bt UPDATE run as the ORIGINAL caller (service_role for the cron), never as the bot.
--   • `actor_not_allowed` arises only from confirm guard 2.4 (impossible here: p_actor=auth.uid()=bot) or 2.5
--     (pre-checked above) → a post-confirm actor_not_allowed is unexpected and treated as a generic error.
--   • On success: confirmed_by = the bot uid (honest machine identity), not NULL.
--
-- confirm_registration_and_assign_seat + P0-guard-v2 are NOT touched. The bot is a real auth.users row, so
-- the trigger chain (reg UPDATE → tournaments.current_players → trg_tournament_audit → swing_config_audit.
-- changed_by, which FKs auth.users) is satisfied with changed_by = bot.
--
-- THREE GATES, all must be ON to auto-confirm; ANY off ⇒ no confirm (flag / flag-only):
--   (1) edge env SEPAY_AUTO_CONFIRM → passed as p_auto_confirm.
--   (2) DB sepay_system_settings.auto_confirm_enabled.
--   (3) bot ∈ club_cashiers of the resolved club (is_club_cashier pre-check + confirm guard 2.5).
--
-- Idempotent: CREATE OR REPLACE FUNCTION; explicit REVOKE/GRANT. The sepay_parse_reference_code parser is
-- unchanged (defined in 20261113000000) — NOT re-emitted here.

CREATE OR REPLACE FUNCTION public.settle_bank_transaction(
  p_bank_transaction_id uuid,
  p_auto_confirm        boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_bt            public.bank_transactions;
  v_club_id       uuid;
  v_ref           text;
  v_reg           public.tournament_registrations;
  v_reg_count     int := 0;
  v_club_count    int := 0;
  v_existing      text;
  v_settle_reg_id uuid := NULL;
  v_expected      bigint := NULL;
  v_confirm       jsonb;
  v_outcome       text;
  v_reason        text := NULL;
  v_conf_reg_id   uuid := NULL;
  v_actor_id      uuid := NULL;     -- the SePay system bot (read from sepay_system_settings); NULL = auto off
  v_saved         text;             -- caller's original request.jwt.claims, saved before impersonation
BEGIN
  -- 1. Lock the bank txn row FIRST (consistent lock order — see header).
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bank_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bank_txn_not_found');
  END IF;

  -- 2. ONE settlement per bank txn (idempotency + anti-duplicate).
  SELECT outcome INTO v_existing
  FROM public.payment_settlements
  WHERE bank_transaction_id = p_bank_transaction_id
  ORDER BY created_at DESC
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', true, 'already_settled', true, 'outcome', v_existing);
  END IF;
  IF v_bt.status <> 'unmatched' THEN
    RETURN jsonb_build_object('ok', true, 'skipped', v_bt.status);
  END IF;

  -- 3. Fraud gate + settleable shape.
  IF v_bt.api_verified_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_api_verified');
  END IF;
  IF v_bt.transfer_type IS DISTINCT FROM 'in' OR v_bt.amount IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_settleable_shape');
  END IF;

  -- 4. Resolve club from the MASTER account number (exactly one active club, else NULL → flag).
  SELECT count(DISTINCT pba.club_id) INTO v_club_count
  FROM public.platform_bank_accounts pba
  WHERE pba.account_number = v_bt.account_number AND pba.is_active = true AND pba.club_id IS NOT NULL;
  IF v_club_count = 1 THEN
    SELECT pba.club_id INTO v_club_id
    FROM public.platform_bank_accounts pba
    WHERE pba.account_number = v_bt.account_number AND pba.is_active = true AND pba.club_id IS NOT NULL
    LIMIT 1;
  END IF;

  -- 5. Parse the reference_code (exactly one VINReg/REENTRY token or NULL) from memo + ref.
  v_ref := public.sepay_parse_reference_code(coalesce(v_bt.content,'') || ' ' || coalesce(v_bt.txn_ref,''));

  -- 6. Match the registration (reference_code is globally UNIQUE; compare case-insensitively).
  IF v_ref IS NOT NULL THEN
    SELECT count(*) INTO v_reg_count
    FROM public.tournament_registrations tr WHERE upper(tr.reference_code) = upper(v_ref);
    IF v_reg_count = 1 THEN
      SELECT * INTO v_reg
      FROM public.tournament_registrations tr WHERE upper(tr.reference_code) = upper(v_ref) LIMIT 1;
      v_settle_reg_id := v_reg.id;
      v_expected      := v_reg.total_pay;
    END IF;
  END IF;

  -- 7. Decision tree. Exact match + all 3 gates → auto-confirm; everything else → flag (never confirm).
  IF v_ref IS NULL OR v_reg_count = 0 THEN
    v_outcome := 'flagged_no_match';
    v_reason  := format('ref=%s reg_count=%s', coalesce(v_ref, '<none>'), v_reg_count);
  ELSIF v_reg_count > 1 THEN
    v_outcome := 'flagged_duplicate';
    v_reason  := format('reg_count=%s', v_reg_count);
  ELSE
    -- exactly one reg (v_reg assigned)
    IF v_club_id IS NULL OR v_reg.club_id IS DISTINCT FROM v_club_id THEN
      v_outcome := 'flagged_no_match';
      v_reason  := 'club unresolved or club mismatch';
    ELSIF v_reg.status <> 'pending' THEN
      v_outcome := 'flagged_not_pending';
      v_reason  := format('reg.status=%s', v_reg.status);
    ELSIF v_bt.amount IS DISTINCT FROM v_reg.total_pay THEN
      v_outcome := 'flagged_amount_mismatch';
      v_reason  := format('amount=%s expected=%s', v_bt.amount, v_reg.total_pay);
    ELSE
      -- EXACT MATCH.
      -- Gate 1: edge env (via p_auto_confirm). OFF → flag-only (write nothing; cashier confirms).
      IF NOT p_auto_confirm THEN
        RETURN jsonb_build_object('ok', true, 'exact_match', true, 'auto_confirm', false,
                                  'registration_id', v_settle_reg_id);
      END IF;

      -- Gate 2: DB global kill-switch + provisioned system actor.
      SELECT s.system_actor_id INTO v_actor_id
      FROM public.sepay_system_settings s
      WHERE s.auto_confirm_enabled = true
      LIMIT 1;
      IF v_actor_id IS NULL THEN
        RETURN jsonb_build_object('ok', true, 'exact_match', true, 'auto_confirm', false,
                                  'reason', 'auto_disabled', 'registration_id', v_settle_reg_id);
      END IF;

      -- Gate 3 (EXPLICIT — NOT inferred from confirm's error string): the bot must be a cashier (or owner)
      -- of the resolved club = the club opted in. is_club_cashier uses the SAME predicate as confirm's
      -- guard 2.5 (owner OR club_cashiers). If not opted in → flag-only (semi-auto; cashier confirms).
      IF NOT public.is_club_cashier(v_actor_id, v_club_id) THEN
        RETURN jsonb_build_object('ok', true, 'exact_match', true, 'auto_confirm', false,
                                  'reason', 'club_not_opted_in', 'registration_id', v_settle_reg_id);
      END IF;

      -- Auto-confirm by REUSING confirm+seat, impersonating the bot ONLY around that call.
      -- SAVE the caller's original claims and RESTORE them on EVERY path (success OR raise). If settle is
      -- ever called WITH a JWT (not just the headless cron), that identity is preserved and the bot identity
      -- never leaks into the settlement INSERT / bt UPDATE below (which must run as the original caller).
      BEGIN
        v_saved := current_setting('request.jwt.claims', true);
        PERFORM set_config('request.jwt.claims', json_build_object('sub', v_actor_id::text)::text, true);
        v_confirm := public.confirm_registration_and_assign_seat(v_reg.id, v_actor_id, 'random_balanced');
        PERFORM set_config('request.jwt.claims', COALESCE(v_saved, ''), true);
      EXCEPTION WHEN OTHERS THEN
        PERFORM set_config('request.jwt.claims', COALESCE(v_saved, ''), true);
        v_confirm := jsonb_build_object('ok', false, 'error', 'confirm_exception');
      END;

      IF COALESCE((v_confirm->>'ok')::boolean, false) THEN
        v_outcome     := 'auto_confirmed';
        v_conf_reg_id := v_reg.id;
        UPDATE public.bank_transactions
          SET status = 'matched', processed_at = now(), club_id = v_club_id
          WHERE id = p_bank_transaction_id;
      ELSIF (v_confirm->>'error') IN ('no_table_available', 'no_seat_available') THEN
        v_outcome := 'flagged_seating_failed';
        v_reason  := v_confirm->>'error';
      ELSE
        -- Any other confirm failure (incl. an UNEXPECTED actor_not_allowed — gate 3 verified above) → flag.
        v_outcome := 'flagged_not_pending';
        v_reason  := coalesce(v_confirm->>'error', 'confirm_failed');
      END IF;
    END IF;
  END IF;

  -- 8. Record the settlement (every path that reaches here; the flag-only returns exited above).
  --    confirmed_by = the bot uid on auto_confirmed (honest machine identity), else NULL.
  INSERT INTO public.payment_settlements
    (bank_transaction_id, tournament_registration_id, club_id, amount, expected_amount,
     reference_code, outcome, confirmed_by, reason)
  VALUES
    (p_bank_transaction_id, v_settle_reg_id, v_club_id, v_bt.amount, v_expected,
     v_ref, v_outcome, CASE WHEN v_outcome = 'auto_confirmed' THEN v_actor_id ELSE NULL END, v_reason);

  RETURN jsonb_build_object('ok', true, 'outcome', v_outcome,
                            'registration_id', v_conf_reg_id, 'club_id', v_club_id);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_bank_transaction(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.settle_bank_transaction(uuid, boolean) TO service_role;
