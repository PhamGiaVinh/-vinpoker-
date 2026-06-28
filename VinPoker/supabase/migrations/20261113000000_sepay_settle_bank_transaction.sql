-- SePay ingestion — Patch 2-settle: settle_bank_transaction (auto-confirm exact matches; flag the rest).
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: the reconcile edge fn (a LATER patch) will call this per SePay-API-verified incoming transfer.
-- It resolves the club, parses the registration reference_code from the transfer memo, and — ONLY on an
-- exact match (verified + 'in' + amount == total_pay + reg still 'pending') AND when p_auto_confirm=true —
-- auto-confirms by REUSING confirm_registration_and_assign_seat (which atomically draws the seat + issues
-- the receipt). ANY discrepancy → a flagged_* settlement row, NEVER a confirm.
--
-- FRAUD GATE: requires bank_transactions.api_verified_at IS NOT NULL — a forged webhook row is never
-- listed by SePay's API, so it never gets verified and can never auto-confirm.
--
-- LOCK ORDER (deadlock-safe): settle locks the bank_transactions row FIRST (FOR UPDATE), THEN calls
-- confirm_registration_and_assign_seat, which locks tournament_registrations then tournaments. Global
-- order is always bank_transactions → tournament_registrations → tournaments. The Patch-1 webhook only
-- touches bank_transactions (ON CONFLICT DO NOTHING — never updates an existing row); the cashier confirm
-- path locks registrations → tournaments (never bank_transactions). No path locks in reverse → no deadlock.
--
-- WRITES ONLY auto_confirmed + flagged_* into payment_settlements. NEVER writes manual_confirmed (that
-- belongs to the cashier RPC, a later patch). An auto-confirm records confirmed_by = NULL (= system).
--
-- INERT on ship: NOTHING calls settle_bank_transaction yet (the reconcile fn is a later patch), and the
-- default p_auto_confirm=false is flag-only (an exact match is left for the cashier — no auto-confirm,
-- no settlement row). EXECUTE granted to service_role ONLY.
--
-- SEPAY_SYSTEM_ACTOR = '00000000-0000-0000-0000-000000000001' — actor recorded in seat/receipt/history
-- for a system auto-confirm. Verified: no FK to auth.users on those columns, and actor_user_id is NOT
-- NULL so it must be non-null. ⚠️ Confirm out-of-band this UUID is NOT a real auth.users.id before
-- enabling auto-confirm:  select 1 from auth.users where id = '00000000-0000-0000-0000-000000000001';  (expect 0 rows)
--
-- Reference-code formats (verified against the live generators):
--   online   tournament-register:           'VINReg' + 4 hex(tour id) + 4 base36  → e.g. VINReg1A2BKXYZ
--   re-entry reenter_tournament_player:      'REENTRY-' + 8 hex                    → e.g. REENTRY-1A2B3C4D
--   (re-entry rows are inserted already 'confirmed' → they never auto-confirm; matched only for audit.)
--
-- Idempotent: CREATE OR REPLACE FUNCTION; explicit REVOKE/GRANT.

-- ── reference-code parser: case-insensitive, returns EXACTLY ONE token or NULL (never guesses) ────────
CREATE OR REPLACE FUNCTION public.sepay_parse_reference_code(p_text text)
RETURNS text
LANGUAGE plpgsql
IMMUTABLE
SET search_path = public
AS $$
DECLARE
  v_toks text[];
BEGIN
  -- \y = word boundary (Postgres ARE syntax; NOT \b, which is backspace). The boundaries stop a real-
  -- looking prefix being matched inside a longer glued string (e.g. VINREG1A2BKXYZEXTRA → no match).
  SELECT array_agg(DISTINCT m[1])
  INTO v_toks
  FROM regexp_matches(upper(coalesce(p_text, '')),
                      '\y(VINREG[A-Z0-9]{8}|REENTRY-?[A-Z0-9]{8})\y', 'g') AS m;
  IF v_toks IS NULL OR array_length(v_toks, 1) <> 1 THEN
    RETURN NULL;                       -- zero or multiple distinct tokens → ambiguous → flag, never guess
  END IF;
  -- Re-insert the hyphen if a bank stripped it, so it matches the stored 'REENTRY-' format.
  RETURN regexp_replace(v_toks[1], '^REENTRY([A-Z0-9])', 'REENTRY-\1');
END;
$$;
REVOKE ALL ON FUNCTION public.sepay_parse_reference_code(text) FROM PUBLIC, anon, authenticated;

-- ── the settle RPC ───────────────────────────────────────────────────────────────────────────────────
CREATE OR REPLACE FUNCTION public.settle_bank_transaction(
  p_bank_transaction_id uuid,
  p_auto_confirm        boolean DEFAULT false
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  c_system_actor constant uuid := '00000000-0000-0000-0000-000000000001';
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
BEGIN
  -- 1. Lock the bank txn row FIRST (consistent lock order — see header).
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bank_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bank_txn_not_found');
  END IF;

  -- 2. ONE settlement per bank txn (idempotency + anti-duplicate). If this bt already has ANY settlement
  --    (a confirm OR a prior flag) → it is done; return without re-processing. CRITICAL: flagged_* rows
  --    leave status='unmatched', so WITHOUT this the reconcile cron would re-insert a flag every tick
  --    (e.g. 20 flagged_amount_mismatch rows in an hour). The cashier resolves a flagged bt via the
  --    manual RPC (later patch), which flips status off 'unmatched' and ends the loop.
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

  -- 3. Fraud gate + settleable shape (defensive — the reconcile fn already filters to these).
  IF v_bt.api_verified_at IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_api_verified');
  END IF;
  IF v_bt.transfer_type IS DISTINCT FROM 'in' OR v_bt.amount IS NULL THEN
    RETURN jsonb_build_object('ok', true, 'skipped', 'not_settleable_shape');
  END IF;

  -- 4. Resolve club from the MASTER account number. If the account maps to >1 distinct active club (a
  --    misconfiguration), DO NOT guess → leave v_club_id NULL → the row flags (money into the wrong club
  --    is worse than a manual review). Resolve only when there is EXACTLY one distinct club.
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

  -- 7. Decision tree. Exact match + p_auto_confirm → confirm; everything else → flag (never confirm).
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
      IF NOT p_auto_confirm THEN
        -- Flag-only mode (Option A): write NOTHING, leave bt unmatched; the UI surfaces the candidate
        -- and the cashier manual-confirms. No schema change to the landed ledger.
        RETURN jsonb_build_object('ok', true, 'exact_match', true, 'auto_confirm', false,
                                  'registration_id', v_settle_reg_id);
      END IF;
      -- Auto-confirm by REUSING the canonical confirm+seat RPC (atomic; re-locks reg→tournament).
      v_confirm := public.confirm_registration_and_assign_seat(v_reg.id, c_system_actor, 'random_balanced');
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
        v_outcome := 'flagged_not_pending';
        v_reason  := coalesce(v_confirm->>'error', 'confirm_failed');
      END IF;
    END IF;
  END IF;

  -- 8. Record the settlement (every path that reaches here; the flag-only exact match returned above).
  INSERT INTO public.payment_settlements
    (bank_transaction_id, tournament_registration_id, club_id, amount, expected_amount,
     reference_code, outcome, confirmed_by, reason)
  VALUES
    (p_bank_transaction_id, v_settle_reg_id, v_club_id, v_bt.amount, v_expected,
     v_ref, v_outcome, NULL, v_reason);

  RETURN jsonb_build_object('ok', true, 'outcome', v_outcome,
                            'registration_id', v_conf_reg_id, 'club_id', v_club_id);
END;
$$;

REVOKE ALL ON FUNCTION public.settle_bank_transaction(uuid, boolean) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.settle_bank_transaction(uuid, boolean) TO service_role;
