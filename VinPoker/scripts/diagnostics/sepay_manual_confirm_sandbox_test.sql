-- ============================================================================
-- SePay Patch 2 (Direction 1) — manual_confirm + ignore RPC SANDBOX TEST.
-- ============================================================================
-- One-paste, self-contained, BEGIN…ROLLBACK → NOTHING is saved. It:
--   • reuses TWO existing clubs (no club insert → no 100-table trigger),
--   • makes a synthetic cashier a real club_cashiers member of the test club,
--   • impersonates that cashier (and an outsider, and an existing super_admin)
--     via set_config('request.jwt.claims', …) so auth.uid() flows into the
--     SECURITY DEFINER RPCs exactly like a logged-in cashier,
--   • exercises every reviewer-required case incl. the FIRST real test of the
--     flagged_seating_failed branch and the H-B DB-level unique constraint,
--   • prints a PASS/FAIL grid, then ROLLS BACK.
--
-- REQUIRES live: manual_confirm_bank_transaction, ignore_bank_transaction,
--   uq_settlement_confirm_per_reg, confirm_registration_and_assign_seat,
--   is_club_cashier, has_role, payment_settlements, bank_transactions.
-- Needs ≥2 clubs (one for the club_mismatch case). super_admin cases SKIP if none.
--
-- Read the grid: verdict must be PASS on every row (SKIPPED rows are PASS=SKIPPED).
-- ============================================================================

BEGIN;

DROP TABLE IF EXISTS _mc_results;
CREATE TEMP TABLE _mc_results (case_no int, scenario text, expected text, actual text);

DO $$
DECLARE
  v_test_club  uuid;
  v_other_club uuid;
  v_super      uuid;
  v_cashier    uuid;                                            -- REAL auth.users id (the seat-draw audit chain FKs auth.users)
  v_outsider   uuid := '0ad00000-0000-0000-0000-000000000002';   -- synthetic non-cashier (never reaches confirm/audit)
  c_cashier    text;
  c_outsider   text;
  v_ret        jsonb;
BEGIN
  -- ── resolve clubs + an existing super_admin ──────────────────────────────
  SELECT id INTO v_test_club  FROM public.clubs ORDER BY created_at, id LIMIT 1;
  IF v_test_club IS NULL THEN RAISE EXCEPTION 'SANDBOX: no club exists to host the test'; END IF;
  SELECT id INTO v_other_club FROM public.clubs WHERE id <> v_test_club ORDER BY created_at, id LIMIT 1;
  IF v_other_club IS NULL THEN RAISE EXCEPTION 'SANDBOX: need >= 2 clubs for the club_mismatch case'; END IF;
  SELECT user_id INTO v_super FROM public.user_roles WHERE role = 'super_admin'::public.app_role LIMIT 1;

  -- The seat-draw audit chain (confirm → reg UPDATE → trg_tour_reg_player_count bumps
  -- tournaments.current_players → trg_tournament_audit INSERTs swing_config_audit.changed_by) FKs
  -- auth.users, so auth.uid() (= the cashier) MUST be a real user. club_cashiers.user_id has no FK,
  -- but the audit does. Pick any existing user and make them a cashier of the test club below.
  -- …and NOT a super_admin, so the cashier-vs-super_admin distinction in cases 11/14 holds.
  SELECT id INTO v_cashier FROM auth.users
   WHERE id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role)
   ORDER BY created_at LIMIT 1;
  IF v_cashier IS NULL THEN
    SELECT id INTO v_cashier FROM auth.users ORDER BY created_at LIMIT 1;  -- fallback: every user is super
  END IF;
  IF v_cashier IS NULL THEN RAISE EXCEPTION 'SANDBOX: no auth.users row to use as the test cashier'; END IF;

  c_cashier  := json_build_object('sub', v_cashier)::text;
  c_outsider := json_build_object('sub', v_outsider)::text;

  -- ── make the chosen real user a cashier of the test club (idempotent) ──────────
  INSERT INTO public.club_cashiers (club_id, user_id) VALUES (v_test_club, v_cashier)
  ON CONFLICT (club_id, user_id) DO NOTHING;

  -- ── test data ────────────────────────────────────────────────────────────
  INSERT INTO public.tournaments (id, club_id, name, status, starting_stack, buy_in, start_time) VALUES
    ('a0c00000-0000-0000-0000-000000000001', v_test_club, '[MCSBX] seatable', 'active', 10000, 100000, now() + interval '1 day'),
    ('a0c00000-0000-0000-0000-000000000002', v_test_club, '[MCSBX] no table', 'active', 10000, 100000, now() + interval '1 day');

  INSERT INTO public.game_tables (id, club_id, table_name) VALUES
    ('b0c00000-0000-0000-0000-000000000001', v_test_club, '[MCSBX] table 1');
  INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status) VALUES
    ('c0c00000-0000-0000-0000-000000000001','a0c00000-0000-0000-0000-000000000001','b0c00000-0000-0000-0000-000000000001',1,9,'active');

  INSERT INTO public.platform_bank_accounts (bank_name, account_number, account_holder, account_type, is_active, club_id) VALUES
    ('[MCSBX] bank', 'MCSBX-ACCT-1', '[MCSBX] holder', 'escrow', true, v_test_club);

  -- registrations (all in the test club; distinct player + reference_code + total_pay)
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status) VALUES
    ('f0c00000-0000-0000-0000-000000000001','a0c00000-0000-0000-0000-000000000001','e0c00000-0000-0000-0000-000000000001', v_test_club, 1000000,1000000,'VINRegMC000001','pending'),
    ('f0c00000-0000-0000-0000-000000000002','a0c00000-0000-0000-0000-000000000001','e0c00000-0000-0000-0000-000000000002', v_test_club, 2000000,2000000,'VINRegMC000002','pending'),
    ('f0c00000-0000-0000-0000-000000000004','a0c00000-0000-0000-0000-000000000001','e0c00000-0000-0000-0000-000000000004', v_test_club,  500000, 500000,'VINRegMC000004','pending'),
    ('f0c00000-0000-0000-0000-000000000005','a0c00000-0000-0000-0000-000000000001','e0c00000-0000-0000-0000-000000000005', v_test_club,  700000, 700000,'VINRegMC000005','pending'),
    ('f0c00000-0000-0000-0000-000000000006','a0c00000-0000-0000-0000-000000000001','e0c00000-0000-0000-0000-000000000006', v_test_club,  800000, 800000,'VINRegMC000006','pending'),
    ('f0c00000-0000-0000-0000-000000000007','a0c00000-0000-0000-0000-000000000002','e0c00000-0000-0000-0000-000000000007', v_test_club,  600000, 600000,'VINRegMC000007','pending'),
    ('f0c00000-0000-0000-0000-000000000008','a0c00000-0000-0000-0000-000000000001','e0c00000-0000-0000-0000-000000000008', v_test_club,  900000, 900000,'VINRegMC000008','pending'),
    ('f0c00000-0000-0000-0000-000000000009','a0c00000-0000-0000-0000-000000000001','e0c00000-0000-0000-0000-000000000009', v_test_club,  950000, 950000,'VINRegMC000009','pending');

  -- bank transactions (manual_confirm does NOT require api_verified — the cashier is the verifier).
  -- bt ..0004 carries club_id = the OTHER club to trigger the cross-club guard via bt.club_id.
  -- bt ..0010 uses an account with no platform_bank_accounts row → club unresolvable.
  INSERT INTO public.bank_transactions (id, provider, provider_txn_id, account_number, amount, transfer_type, content, status, club_id) VALUES
    ('1ac00000-0000-0000-0000-000000000001','sepay','MC-TXN-01','MCSBX-ACCT-1',      1000000,'in','mc exact',       'unmatched', NULL),
    ('1ac00000-0000-0000-0000-000000000002','sepay','MC-TXN-02','MCSBX-ACCT-1',      1950000,'in','mc mismatch',    'unmatched', NULL),
    ('1ac00000-0000-0000-0000-000000000003','sepay','MC-TXN-03','MCSBX-ACCT-1',         NULL,'in','mc amt null',    'unmatched', NULL),
    ('1ac00000-0000-0000-0000-000000000004','sepay','MC-TXN-04','MCSBX-ACCT-1',       700000,'in','mc clubmis',     'unmatched', v_other_club),
    ('1ac00000-0000-0000-0000-000000000005','sepay','MC-TXN-05','MCSBX-ACCT-1',       800000,'in','mc dbl',         'unmatched', NULL),
    ('1ac00000-0000-0000-0000-000000000006','sepay','MC-TXN-06','MCSBX-ACCT-1',       800000,'in','mc dbl2',        'unmatched', NULL),
    ('1ac00000-0000-0000-0000-000000000007','sepay','MC-TXN-07','MCSBX-ACCT-1',       600000,'in','mc seatfail',    'unmatched', NULL),
    ('1ac00000-0000-0000-0000-000000000008','sepay','MC-TXN-08','MCSBX-ACCT-1',       100000,'in','mc ign cashier', 'unmatched', NULL),
    ('1ac00000-0000-0000-0000-000000000009','sepay','MC-TXN-09','MCSBX-ACCT-1',       200000,'in','mc ign super',   'unmatched', NULL),
    ('1ac00000-0000-0000-0000-000000000010','sepay','MC-TXN-10','MCSBX-JUNK-NOCLUB',  300000,'in','mc ign unres',   'unmatched', NULL),
    ('1ac00000-0000-0000-0000-000000000011','sepay','MC-TXN-11','MCSBX-ACCT-1',       900000,'in','mc outsider',    'unmatched', NULL);

  -- ════════ GROUP A: as the logged-in CASHIER ════════
  PERFORM set_config('request.jwt.claims', c_cashier, true);

  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000001','f0c00000-0000-0000-0000-000000000001', NULL);
  INSERT INTO _mc_results VALUES (1,'exact match -> manual_confirmed + real seat','manual_confirmed', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000002','f0c00000-0000-0000-0000-000000000002', NULL);
  INSERT INTO _mc_results VALUES (2,'amount mismatch, NO reason -> rejected','reason_required_on_mismatch', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000002','f0c00000-0000-0000-0000-000000000002', 'khach chuyen thieu, bu tien mat');
  INSERT INTO _mc_results VALUES (3,'amount mismatch + reason -> manual_confirmed','manual_confirmed', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000003','f0c00000-0000-0000-0000-000000000004', NULL);
  INSERT INTO _mc_results VALUES (4,'amount NULL (quarantined) -> amount_missing','amount_missing', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000004','f0c00000-0000-0000-0000-000000000005', NULL);
  INSERT INTO _mc_results VALUES (5,'bt club <> reg club -> club_mismatch','club_mismatch', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000005','f0c00000-0000-0000-0000-000000000006', NULL);
  INSERT INTO _mc_results VALUES (6,'double #1 (bt5/reg6) -> manual_confirmed','manual_confirmed', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000005','f0c00000-0000-0000-0000-000000000006', NULL);
  INSERT INTO _mc_results VALUES (7,'double #2 same bt -> already_settled','already_settled', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000006','f0c00000-0000-0000-0000-000000000006', NULL);
  INSERT INTO _mc_results VALUES (8,'diff bt, same reg -> registration_already_settled (H-B app)','registration_already_settled', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000007','f0c00000-0000-0000-0000-000000000007', NULL);
  INSERT INTO _mc_results VALUES (9,'no-table tournament -> seating_failed (FIRST real test)','seating_failed', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.ignore_bank_transaction('1ac00000-0000-0000-0000-000000000008', 'rac, khong phai dang ky');
  INSERT INTO _mc_results VALUES (10,'ignore as cashier (resolved club) -> dismissed','dismissed', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  v_ret := public.ignore_bank_transaction('1ac00000-0000-0000-0000-000000000010', 'rac unres');
  INSERT INTO _mc_results VALUES (11,'ignore unresolved-club as cashier -> rejected','club_unresolved_super_admin_only', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  -- ════════ GROUP B: as an OUTSIDER (not cashier/owner/super) ════════
  PERFORM set_config('request.jwt.claims', c_outsider, true);
  v_ret := public.manual_confirm_bank_transaction('1ac00000-0000-0000-0000-000000000011','f0c00000-0000-0000-0000-000000000008', NULL);
  INSERT INTO _mc_results VALUES (12,'non-cashier confirms -> actor_not_allowed','actor_not_allowed', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));

  -- ════════ GROUP C: as an existing SUPER_ADMIN (skip if none) ════════
  IF v_super IS NULL THEN
    INSERT INTO _mc_results VALUES (13,'ignore as super_admin (no super_admin in DB -> SKIPPED)','SKIPPED','SKIPPED');
    INSERT INTO _mc_results VALUES (14,'ignore unresolved as super_admin (SKIPPED)','SKIPPED','SKIPPED');
  ELSE
    PERFORM set_config('request.jwt.claims', json_build_object('sub', v_super)::text, true);
    v_ret := public.ignore_bank_transaction('1ac00000-0000-0000-0000-000000000009', 'rac super');
    INSERT INTO _mc_results VALUES (13,'ignore as super_admin (resolved club) -> dismissed','dismissed', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));
    v_ret := public.ignore_bank_transaction('1ac00000-0000-0000-0000-000000000010', 'rac super unres');
    INSERT INTO _mc_results VALUES (14,'ignore unresolved-club as super_admin -> dismissed','dismissed', coalesce(v_ret->>'error', v_ret->>'outcome', case when jsonb_exists(v_ret,'already_ignored') then 'already_ignored' end, v_ret::text));
  END IF;

  -- ════════ H-B DB-LEVEL CONSTRAINT (race-proof guarantee, identity-independent) ════════
  -- One terminal confirm exists for reg ..0009; a 2nd direct manual_confirmed INSERT for the SAME reg
  -- must violate uq_settlement_confirm_per_reg (this is what stops the concurrent-confirm race).
  INSERT INTO public.payment_settlements (bank_transaction_id, tournament_registration_id, club_id, amount, outcome, confirmed_by)
    VALUES (NULL, 'f0c00000-0000-0000-0000-000000000009', v_test_club, 100, 'manual_confirmed', v_cashier);
  BEGIN
    INSERT INTO public.payment_settlements (bank_transaction_id, tournament_registration_id, club_id, amount, outcome, confirmed_by)
      VALUES (NULL, 'f0c00000-0000-0000-0000-000000000009', v_test_club, 200, 'manual_confirmed', v_cashier);
    INSERT INTO _mc_results VALUES (15,'H-B index blocks 2nd confirm/reg','blocked','NOT blocked');
  EXCEPTION WHEN unique_violation THEN
    INSERT INTO _mc_results VALUES (15,'H-B index blocks 2nd confirm/reg','blocked','blocked');
  END;

  -- ════════ INVARIANTS (side effects) ════════
  INSERT INTO _mc_results VALUES (101,'INV: exact-match reg ..0001 now confirmed','confirmed',
    (SELECT status::text FROM public.tournament_registrations WHERE id='f0c00000-0000-0000-0000-000000000001'));
  INSERT INTO _mc_results VALUES (102,'INV: exact-match drew exactly 1 seat','1',
    (SELECT count(*)::text FROM public.tournament_seats WHERE player_id='e0c00000-0000-0000-0000-000000000001' AND is_active));
  INSERT INTO _mc_results VALUES (103,'INV: exact-match bt ..0001 now matched','matched',
    (SELECT status::text FROM public.bank_transactions WHERE id='1ac00000-0000-0000-0000-000000000001'));
  INSERT INTO _mc_results VALUES (104,'INV: mismatch+reason settlement stored expected=2000000','2000000',
    (SELECT expected_amount::text FROM public.payment_settlements WHERE bank_transaction_id='1ac00000-0000-0000-0000-000000000002' AND outcome='manual_confirmed'));
  INSERT INTO _mc_results VALUES (105,'INV: seating-fail wrote exactly 1 flagged_seating_failed','1',
    (SELECT count(*)::text FROM public.payment_settlements WHERE bank_transaction_id='1ac00000-0000-0000-0000-000000000007' AND outcome='flagged_seating_failed'));
  INSERT INTO _mc_results VALUES (106,'INV: seating-fail bt still unmatched (retryable)','unmatched',
    (SELECT status::text FROM public.bank_transactions WHERE id='1ac00000-0000-0000-0000-000000000007'));
  INSERT INTO _mc_results VALUES (107,'INV: ignored-by-cashier bt now ignored','ignored',
    (SELECT status::text FROM public.bank_transactions WHERE id='1ac00000-0000-0000-0000-000000000008'));

  PERFORM set_config('request.jwt.claims', '{}', true);   -- reset identity (cosmetic; we roll back)
END $$;

-- Report — verdict must be PASS on every row.
SELECT case_no, scenario, expected, actual,
       CASE WHEN actual = expected THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM _mc_results
ORDER BY case_no;

ROLLBACK;
