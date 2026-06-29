-- PATCH 4 / STAGE C — settle_bank_transaction: dispatch re-entry confirms to confirm_reentry_and_assign_seat.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session AFTER 20261122000000 (STAGE B,
-- source_entry_id) + 20261122000001 (confirm_reentry_and_assign_seat). schema_migrations untouched.
--
-- BYTE-BASELINE = 20261118000000_sepay_settle_auto_confirm_system_actor.sql (the production-validated body).
-- TWO deliberate changes vs that baseline, NOTHING else:
--   (1) The single exact-match confirm call becomes a dispatch on v_reg.source_entry_id —
--         source_entry_id IS NULL  → confirm_registration_and_assign_seat   (INITIAL path, BYTE-UNCHANGED)
--         source_entry_id NOT NULL → confirm_reentry_and_assign_seat        (pay-first re-entry)
--   (2) P1-2 (STAGE C review) — the matched-registration SELECT (step 6) gains `FOR UPDATE` so two settlement
--       workers carrying the same reference_code (a double-pay) serialize on the reg row: the 2nd blocks, then
--       sees status='confirmed' → flagged_not_pending, instead of racing into confirm and RAISEing on the
--       per-reg auto_confirmed unique index. This is the only expansion beyond the dispatch; it hardens BOTH
--       paths and changes neither path's single-payment behaviour (confirm_* re-locks the same row anyway).
-- Everything else (lock order, idempotency, fraud gate, club resolution, exact-match gate, the 3 system-actor
-- gates, bot impersonation save/restore, outcome mapping incl. raw error → reason, the settlement INSERT) is
-- IDENTICAL. A re-entry confirm failure (entry_not_reenterable / reentry_window_closed / no_table / etc.) flows
-- through the SAME outcome handling → flagged (never silent-lost); the raw error is preserved in `reason`.
--
-- Plus a double-pay safeguard: at most ONE auto_confirmed settlement per registration.
-- Idempotent: CREATE OR REPLACE FUNCTION; CREATE UNIQUE INDEX IF NOT EXISTS.
-- Rollback: CREATE OR REPLACE settle_bank_transaction back to the 20261118000000 body (instant, no DDL);
--   DROP INDEX uniq_payment_settlements_autoconfirm_per_reg. (See docs/sepay/ runbook.)

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
      -- P1-2 (STAGE C review): lock the matched registration row HERE, before the status/pending gate below.
      -- This is the ONLY intentional behavioural change beyond the source_entry_id dispatch block. Two
      -- settlement workers carrying the SAME reference_code (a double-pay = two bank txns) now SERIALIZE on
      -- this row: the 2nd blocks until the 1st commits, then re-reads status='confirmed' → falls to
      -- flagged_not_pending at the status gate, instead of both passing the pending gate, racing into confirm,
      -- and the 2nd RAISEing on the uniq_payment_settlements_autoconfirm_per_reg belt (which would roll back
      -- and leave its bank txn unmatched for ~5 min). Deterministic result: exactly 1 auto_confirmed + 1 seat;
      -- the 2nd payment is cleanly flagged for cashier refund. Hardens BOTH paths' concurrent double-pay; the
      -- single-payment behaviour of each path is unchanged (confirm_*_and_assign_seat re-locks the same row
      -- inside its own body, so this is a no-op there).
      SELECT * INTO v_reg
      FROM public.tournament_registrations tr WHERE upper(tr.reference_code) = upper(v_ref) LIMIT 1
      FOR UPDATE;
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
        -- PATCH 4: dispatch on source_entry_id. INITIAL path is BYTE-UNCHANGED; re-entry uses the pay-first confirm.
        IF v_reg.source_entry_id IS NULL THEN
          v_confirm := public.confirm_registration_and_assign_seat(v_reg.id, v_actor_id, 'random_balanced');
        ELSE
          v_confirm := public.confirm_reentry_and_assign_seat(v_reg.id, v_actor_id, 'random_balanced');
        END IF;
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

-- Double-pay safeguard: at most ONE auto_confirmed settlement per registration. The per-reg pending→confirmed
-- flip already blocks a 2nd auto-confirm in sequential cron processing; this is the concurrency belt.
-- (If this errors on apply, an existing duplicate auto_confirmed exists — investigate before forcing.)
CREATE UNIQUE INDEX IF NOT EXISTS uniq_payment_settlements_autoconfirm_per_reg
  ON public.payment_settlements (tournament_registration_id)
  WHERE outcome = 'auto_confirmed';
