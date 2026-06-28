-- SePay ingestion — Patch 2 (Hướng 1, semi-auto): cashier manual-confirm + ignore RPCs.
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session (Supabase SQL Editor /
-- Management API), NOT the automated DB-deploy path. schema_migrations untouched.
--
-- WHY: Direction 1 keeps SePay auto-confirm OFF. The reconcile fn calls settle_bank_transaction(bt,
-- p_auto_confirm := false) — an exact match returns 'exact_match' and writes NOTHING (the candidate is
-- surfaced in the Floor "Settlement" UI). A LOGGED-IN cashier then either confirms or dismisses it:
--   - manual_confirm_bank_transaction → draws the seat by REUSING confirm_registration_and_assign_seat
--     with the cashier's OWN identity, and records a 'manual_confirmed' settlement.
--   - ignore_bank_transaction → marks the transfer 'ignored' and records a 'dismissed' settlement.
--
-- THE BRIDGE (why this works where settle/cron cannot): the live confirm RPC = P0-guard-v2
-- (20260811000000) hard-binds the actor — step 2.4 requires p_actor_user_id = auth.uid(); step 2.5
-- requires that actor to be the tournament club's owner or a club_cashiers member. A headless
-- service_role/cron has auth.uid() = NULL → confirm returns 'actor_not_allowed' (this is exactly why
-- the auto path is blocked). Here, manual_confirm is called by an authenticated cashier whose JWT sets
-- auth.uid(). SECURITY DEFINER does NOT reset auth.uid() (it derives from request.jwt.claims, not the
-- executing role), so the cashier's identity flows manual_confirm → confirm intact: we pass auth.uid()
-- as the actor, so confirm's 2.4 (p_actor = auth.uid()) and 2.5 (owner/cashier) both pass. Our gate
-- public.is_club_cashier(auth.uid(), club) uses the SAME predicate as confirm's 2.5 (owner OR
-- club_cashiers — see 20260512184948) → if our gate passes, confirm's guard passes for the same club.
--
-- LOCK ORDER (deadlock-safe, identical to settle_bank_transaction): lock the bank_transactions row
-- FOR UPDATE FIRST, THEN call confirm_registration_and_assign_seat (which locks registrations →
-- tournaments). Global order is always bank_transactions → tournament_registrations → tournaments.
-- ignore_bank_transaction locks only bank_transactions. No path locks in reverse → no deadlock.
--
-- IDEMPOTENCY: at most ONE terminal confirm per bank txn (mirrors uq_settlement_confirm_per_txn, which
-- is partial-unique on outcome IN ('auto_confirmed','manual_confirmed')). A prior flagged_* row does
-- NOT block manual_confirm — the cashier is resolving that flag; the flag stays as history.
--
-- bank_transactions.status (CHECK unmatched/matched/ignored/quarantined): manual_confirm advances a
-- settled row to 'matched' (bank_txn_matched_has_amount requires amount NOT NULL — enforced below);
-- ignore advances to 'ignored'. Both move the row OFF 'unmatched' so the reconcile worklist drops it.
--
-- REVIEWER-APPROVED DECISIONS baked in (relayed 2026-06-27):
--   D1. Amount mismatch is ALLOWED (the cashier saw the statement) but REQUIRES a non-empty p_reason;
--       expected_amount + amount are stored as the numeric audit trail.
--   D2. bt.status → 'matched' on success. If bt.amount IS NULL → reject 'amount_missing' BEFORE confirm
--       (a quarantined row must be amount-filled by the SePay-API reconcile first).
--   D3. Seating failure (confirm → no_table/no_seat) → record ONE 'flagged_seating_failed' for audit
--       (skip if one already exists, so repeat clicks don't spam the ledger) + leave bt 'unmatched' to retry.
--   D4. ignore: gate = is_club_cashier OR super_admin; if the club is unresolvable → super_admin ONLY;
--       settlement.amount = COALESCE(bt.amount, 0) (a dismissed row's amount is a note, 0 = unknown).
--   D5. Cross-club: the club the MONEY belongs to must match the registration's club, else 'club_mismatch'.
--   D6. No duplicate reg.status pre-check — confirm is the single source of truth; we just map its errors.
--
-- TWO HARDENINGS BEYOND THE 6 DECISIONS — flagged for the reviewer (drop if unwanted):
--   H-A (extends D5). Decision 5 keyed only off bt.club_id, but that column is NULL for a flag-only
--       Direction-1 candidate, so the literal check would NEVER fire. To actually fulfil the stated
--       intent ("club A's money must not confirm a club B reg"), the bt's club is resolved from
--       bt.club_id, ELSE from the master-account mapping (exactly one active club). To revert to the
--       strict bt.club_id-only form, delete the ELSE branch that resolves via platform_bank_accounts.
--   H-B (new). One paid settlement per REGISTRATION, in TWO layers: (1) the app block in manual_confirm
--       refuses a second transfer against an already-confirmed reg with a clean 'registration_already_settled'
--       error (good UX); (2) the partial-unique index uq_settlement_confirm_per_reg (created in section 0
--       below) is the DB-level guarantee — even if two concurrent confirms of the SAME reg race past the
--       app check (confirm locks the reg, so the 2nd returns idempotent:true and would still try to INSERT
--       a 2nd 'manual_confirmed'), that 2nd INSERT violates the unique index → rolls back → exactly ONE
--       confirm per reg. (Re-entries are separate registrations with their own reference_code → separate
--       reg ids → unaffected.) The index is ADDITIVE to the 2a ledger; it does NOT edit 20261110000001 (4c8bec7).
--
-- INERT until wired: only the reconcile fn (a later patch) + the Floor Settlement UI call these. Nothing
-- calls them in this migration. EXECUTE granted to authenticated ONLY (the internal gate does the real
-- authorization). Rollback: DROP INDEX IF EXISTS public.uq_settlement_confirm_per_reg;
--                          DROP FUNCTION public.manual_confirm_bank_transaction(uuid,uuid,text);
--                          DROP FUNCTION public.ignore_bank_transaction(uuid,text);
--
-- Idempotent: CREATE UNIQUE INDEX IF NOT EXISTS; CREATE OR REPLACE FUNCTION; explicit REVOKE/GRANT.

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 0. Ledger hardening (ADDITIVE — does NOT edit the 2a ledger file 20261110000001 / 4c8bec7).
--    DB-level guarantee for H-B: at most ONE terminal confirm (auto OR manual) per registration. The
--    app-level check in manual_confirm is best-effort only — two concurrent different-bt confirms of the
--    same reg can race past it (confirm serializes on the reg and returns idempotent:true the 2nd time,
--    which is treated as success and would INSERT a 2nd 'manual_confirmed'). This partial-unique makes
--    that 2nd INSERT fail → rollback → exactly one confirm/reg. tournament_registration_id IS NOT NULL in
--    the predicate so 'dismissed' rows (reg_id NULL) never collide. payment_settlements is empty → instant.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE UNIQUE INDEX IF NOT EXISTS uq_settlement_confirm_per_reg
  ON public.payment_settlements (tournament_registration_id)
  WHERE outcome IN ('auto_confirmed', 'manual_confirmed') AND tournament_registration_id IS NOT NULL;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 1. manual_confirm_bank_transaction — cashier confirms an exact-match (or justified-mismatch) candidate.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.manual_confirm_bank_transaction(
  p_bank_transaction_id uuid,
  p_registration_id     uuid,
  p_reason              text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_bt       public.bank_transactions;
  v_reg      public.tournament_registrations;
  v_club     uuid;            -- the registration's tournament club (authorization + settle club)
  v_bt_club  uuid;            -- the club the MONEY belongs to (bt.club_id, else account mapping) — H-A
  v_cnt      int := 0;
  v_existing text;
  v_mismatch boolean;
  v_confirm  jsonb;
  v_err      text;
BEGIN
  -- 0. Caller must be an authenticated user (auth.uid() drives the gate AND the confirm actor-bind).
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- 1. Lock the bank txn row FIRST (consistent lock order — see header).
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bank_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bank_txn_not_found');
  END IF;

  -- 2. Load the registration the cashier is settling this transfer against.
  SELECT * INTO v_reg FROM public.tournament_registrations WHERE id = p_registration_id;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'registration_not_found');
  END IF;

  -- 3. Authorization club = the registration's TOURNAMENT club (exactly what confirm's guard 2.5
  --    checks). Gating on this club keeps is_club_cashier here consistent with confirm.
  SELECT t.club_id INTO v_club FROM public.tournaments t WHERE t.id = v_reg.tournament_id;
  IF v_club IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'club_unresolved');
  END IF;

  -- 4. GATE — no writes occur before this point. Cashier or owner of the registration's club.
  --    auth.uid() = NULL for a no-JWT/service caller → is_club_cashier false → rejected.
  IF NOT public.is_club_cashier(v_actor, v_club) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
  END IF;

  -- 5. Cross-club money safety (D5 + H-A). Resolve the club the MONEY belongs to: bt.club_id, else the
  --    master-account mapping (exactly one active club). If it resolves and differs from the
  --    registration's club → refuse (club A's money must never confirm a club B registration).
  v_bt_club := v_bt.club_id;
  IF v_bt_club IS NULL THEN
    SELECT count(DISTINCT pba.club_id) INTO v_cnt
    FROM public.platform_bank_accounts pba
    WHERE pba.account_number = v_bt.account_number AND pba.is_active = true AND pba.club_id IS NOT NULL;
    IF v_cnt = 1 THEN
      SELECT pba.club_id INTO v_bt_club
      FROM public.platform_bank_accounts pba
      WHERE pba.account_number = v_bt.account_number AND pba.is_active = true AND pba.club_id IS NOT NULL
      LIMIT 1;
    END IF;
  END IF;
  IF v_bt_club IS NOT NULL AND v_bt_club IS DISTINCT FROM v_club THEN
    RETURN jsonb_build_object('ok', false, 'error', 'club_mismatch', 'bt_club', v_bt_club, 'reg_club', v_club);
  END IF;

  -- 6. One terminal confirm per bank txn (idempotency; matches uq_settlement_confirm_per_txn + settle's
  --    guard). A prior flagged_* row does NOT block — the cashier is resolving that flag.
  SELECT outcome INTO v_existing
  FROM public.payment_settlements
  WHERE bank_transaction_id = p_bank_transaction_id AND outcome IN ('auto_confirmed', 'manual_confirmed')
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_settled', 'outcome', v_existing);
  END IF;

  -- 6b. (H-B) One paid settlement per REGISTRATION — a second transfer against an already-confirmed reg
  --     is an overpayment to reconcile, not a confirm. Re-entries are separate registrations → unaffected.
  SELECT outcome INTO v_existing
  FROM public.payment_settlements
  WHERE tournament_registration_id = v_reg.id AND outcome IN ('auto_confirmed', 'manual_confirmed')
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'registration_already_settled', 'outcome', v_existing);
  END IF;

  -- 7. Amount must be known to confirm (D2). A quarantined row (amount NULL) cannot be confirmed:
  --    bank_txn_matched_has_amount would also block status='matched'. Reconcile fills amount first.
  IF v_bt.amount IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'amount_missing');
  END IF;

  -- 8. Amount discrepancy is ALLOWED but MUST be justified (D1): when bt.amount <> reg.total_pay,
  --    p_reason is required. expected_amount/amount recorded below are the numeric trail; p_reason the note.
  v_mismatch := (v_bt.amount IS DISTINCT FROM v_reg.total_pay);
  IF v_mismatch AND (p_reason IS NULL OR length(btrim(p_reason)) = 0) THEN
    RETURN jsonb_build_object('ok', false, 'error', 'reason_required_on_mismatch',
                              'amount', v_bt.amount, 'expected', v_reg.total_pay);
  END IF;

  -- 9. Confirm by REUSING the canonical RPC, passing the REAL cashier (auth.uid()) as actor (see header).
  v_confirm := public.confirm_registration_and_assign_seat(p_registration_id, v_actor, 'random_balanced');

  IF COALESCE((v_confirm->>'ok')::boolean, false) THEN
    -- Success (incl. confirm's idempotent re-confirm): record the terminal manual confirm + advance the bt.
    UPDATE public.bank_transactions
      SET status = 'matched', processed_at = now(), club_id = v_club
      WHERE id = p_bank_transaction_id;

    INSERT INTO public.payment_settlements
      (bank_transaction_id, tournament_registration_id, club_id, amount, expected_amount,
       reference_code, outcome, confirmed_by, reason)
    VALUES
      (p_bank_transaction_id, v_reg.id, v_club, v_bt.amount, v_reg.total_pay,
       v_reg.reference_code, 'manual_confirmed', v_actor, p_reason);

    RETURN jsonb_build_object('ok', true, 'outcome', 'manual_confirmed',
                              'registration_id', v_reg.id, 'club_id', v_club,
                              'amount_mismatch', v_mismatch, 'confirm', v_confirm);

  ELSIF (v_confirm->>'error') IN ('no_table_available', 'no_seat_available') THEN
    -- Seating failed (D3): record ONE flagged_seating_failed for audit, but keep the bt 'unmatched' so
    -- the cashier can retry once the floor opens a table. Skip if one already exists (no repeat-click spam).
    v_err := v_confirm->>'error';
    IF NOT EXISTS (
      SELECT 1 FROM public.payment_settlements
      WHERE bank_transaction_id = p_bank_transaction_id AND outcome = 'flagged_seating_failed'
    ) THEN
      INSERT INTO public.payment_settlements
        (bank_transaction_id, tournament_registration_id, club_id, amount, expected_amount,
         reference_code, outcome, confirmed_by, reason)
      VALUES
        (p_bank_transaction_id, v_reg.id, v_club, v_bt.amount, v_reg.total_pay,
         v_reg.reference_code, 'flagged_seating_failed', v_actor, v_err);
    END IF;
    RETURN jsonb_build_object('ok', false, 'error', 'seating_failed', 'detail', v_err);

  ELSE
    -- Any other confirm guard (invalid_status, already_confirmed_no_entry, player_already_active,
    -- tournament_not_open, actor_not_allowed, …). Surface it; write nothing; bt stays unmatched (D6).
    RETURN jsonb_build_object('ok', false,
                              'error', COALESCE(v_confirm->>'error', 'confirm_failed'),
                              'detail', v_confirm);
  END IF;
END;
$$;

-- service_role is revoked too: Supabase default-privileges auto-grant EXECUTE on new public functions
-- to service_role; this is a human-cashier RPC (auth.uid()-gated) that no backend role should call.
REVOKE ALL ON FUNCTION public.manual_confirm_bank_transaction(uuid, uuid, text) FROM PUBLIC, anon, service_role;
GRANT  EXECUTE ON FUNCTION public.manual_confirm_bank_transaction(uuid, uuid, text) TO authenticated;

-- ════════════════════════════════════════════════════════════════════════════════════════════════
-- 2. ignore_bank_transaction — cashier (or super_admin) dismisses a transfer that is not a registration.
-- ════════════════════════════════════════════════════════════════════════════════════════════════
CREATE OR REPLACE FUNCTION public.ignore_bank_transaction(
  p_bank_transaction_id uuid,
  p_reason              text DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_actor    uuid := auth.uid();
  v_bt       public.bank_transactions;
  v_club     uuid;
  v_cnt      int := 0;
  v_super    boolean;
  v_existing text;
BEGIN
  IF v_actor IS NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'unauthorized');
  END IF;

  -- Lock the bank txn (only lock taken — ignore touches no registration/tournament → no deadlock).
  SELECT * INTO v_bt FROM public.bank_transactions WHERE id = p_bank_transaction_id FOR UPDATE;
  IF NOT FOUND THEN
    RETURN jsonb_build_object('ok', false, 'error', 'bank_txn_not_found');
  END IF;

  -- Resolve the club this transfer belongs to: bt.club_id if set, else the master-account mapping
  -- (exactly one active club). NULL = unresolvable.
  v_super := public.has_role(v_actor, 'super_admin'::public.app_role);
  IF v_bt.club_id IS NOT NULL THEN
    v_club := v_bt.club_id;
  ELSE
    SELECT count(DISTINCT pba.club_id) INTO v_cnt
    FROM public.platform_bank_accounts pba
    WHERE pba.account_number = v_bt.account_number AND pba.is_active = true AND pba.club_id IS NOT NULL;
    IF v_cnt = 1 THEN
      SELECT pba.club_id INTO v_club
      FROM public.platform_bank_accounts pba
      WHERE pba.account_number = v_bt.account_number AND pba.is_active = true AND pba.club_id IS NOT NULL
      LIMIT 1;
    END IF;
  END IF;

  -- GATE (D4). Resolvable club → a cashier/owner of that club OR a super_admin. Unresolvable club →
  -- super_admin ONLY (a cashier has no club to be scoped against).
  IF v_club IS NOT NULL THEN
    IF NOT (public.is_club_cashier(v_actor, v_club) OR v_super) THEN
      RETURN jsonb_build_object('ok', false, 'error', 'actor_not_allowed');
    END IF;
  ELSE
    IF NOT v_super THEN
      RETURN jsonb_build_object('ok', false, 'error', 'club_unresolved_super_admin_only');
    END IF;
  END IF;

  -- A transfer already confirmed (auto/manual) cannot be ignored.
  SELECT outcome INTO v_existing
  FROM public.payment_settlements
  WHERE bank_transaction_id = p_bank_transaction_id AND outcome IN ('auto_confirmed', 'manual_confirmed')
  LIMIT 1;
  IF v_existing IS NOT NULL THEN
    RETURN jsonb_build_object('ok', false, 'error', 'already_settled', 'outcome', v_existing);
  END IF;

  -- Idempotent: already ignored → no-op (no duplicate dismissed row).
  IF v_bt.status = 'ignored' THEN
    RETURN jsonb_build_object('ok', true, 'already_ignored', true);
  END IF;

  -- Apply: move the bt off the reconcile worklist + append the dismissal to the ledger.
  UPDATE public.bank_transactions
    SET status = 'ignored', processed_at = now()
    WHERE id = p_bank_transaction_id;

  INSERT INTO public.payment_settlements
    (bank_transaction_id, tournament_registration_id, club_id, amount, expected_amount,
     reference_code, outcome, confirmed_by, reason)
  VALUES
    (p_bank_transaction_id, NULL, v_club, COALESCE(v_bt.amount, 0), NULL,
     v_bt.txn_ref, 'dismissed', v_actor, p_reason);

  RETURN jsonb_build_object('ok', true, 'outcome', 'dismissed', 'club_id', v_club);
END;
$$;

REVOKE ALL ON FUNCTION public.ignore_bank_transaction(uuid, text) FROM PUBLIC, anon, service_role;
GRANT  EXECUTE ON FUNCTION public.ignore_bank_transaction(uuid, text) TO authenticated;
