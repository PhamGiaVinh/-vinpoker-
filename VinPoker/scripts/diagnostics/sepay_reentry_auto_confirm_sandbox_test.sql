-- ============================================================================
-- PATCH 4 / STAGE C — RE-ENTRY full-auto-confirm HEADLESS TEST.
-- One-paste, self-contained, BEGIN…ROLLBACK → NOTHING saved. Requires migrations
-- 20261122000000 + 20261122000001 + 20261123000000 applied. Simulates the cron: auth.uid()=NULL.
-- Uses a REAL non-super auth.users row as the SePay system "bot" (the seat-draw audit chain FKs auth.users).
-- Verdict must be PASS on every row.
--
-- ⚠️ Paste and run the WHOLE block at once so the final ROLLBACK executes (runs on the production DB; fake
--    ids re5…/re6…/re7… do not collide with real rows).
-- ============================================================================
BEGIN;

DROP TABLE IF EXISTS _re_results;
CREATE TEMP TABLE _re_results (case_no int, scenario text, expected text, actual text);

DO $$
DECLARE
  v_club uuid;
  v_bot  uuid;
  v_ret  jsonb;
  v_seats int;
  v_autoconf int;
  v_st text;
BEGIN
  SELECT id INTO v_club FROM public.clubs ORDER BY created_at, id LIMIT 1;
  IF v_club IS NULL THEN RAISE EXCEPTION 'RE-SBX: no club'; END IF;
  SELECT id INTO v_bot FROM auth.users
    WHERE id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role)
    ORDER BY created_at LIMIT 1;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'RE-SBX: need a non-super auth.users row as the bot'; END IF;

  -- provision the 3 gates: settings (bot + DB switch ON) + opt-in club (bot ∈ club_cashiers)
  UPDATE public.sepay_system_settings SET system_actor_id = v_bot, auto_confirm_enabled = true WHERE id = true;
  INSERT INTO public.club_cashiers (club_id, user_id) VALUES (v_club, v_bot) ON CONFLICT DO NOTHING;

  -- seatable tournament (window OPEN: current_level 1 <= late_reg_close_level 6) + a closed-window one
  INSERT INTO public.tournaments (id, club_id, name, status, starting_stack, buy_in, start_time, current_level, late_reg_close_level) VALUES
    ('re500000-0000-0000-0000-000000000001', v_club, '[RESBX] open',   'active', 10000, 100000, now()+interval '1 day', 1, 6),
    ('re500000-0000-0000-0000-000000000009', v_club, '[RESBX] closed', 'active', 10000, 100000, now()+interval '1 day', 7, 6);
  INSERT INTO public.game_tables (id, club_id, table_name) VALUES
    ('re500000-0000-0000-0000-0000000000a1', v_club, '[RESBX] gt1'),
    ('re500000-0000-0000-0000-0000000000a9', v_club, '[RESBX] gt9');
  INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status) VALUES
    ('re500000-0000-0000-0000-0000000000c1','re500000-0000-0000-0000-000000000001','re500000-0000-0000-0000-0000000000a1',1,9,'active'),
    ('re500000-0000-0000-0000-0000000000c9','re500000-0000-0000-0000-000000000009','re500000-0000-0000-0000-0000000000a9',1,9,'active');
  INSERT INTO public.platform_bank_accounts (bank_name, account_number, account_holder, account_type, is_active, club_id) VALUES
    ('[RESBX] bank','RESBX-ACCT','[RESBX] holder','escrow', true, v_club);

  -- helper inline via explicit rows. Players re6…N. Each: a busted source entry, a PENDING re-entry reg
  -- (source_entry_id set), and an api-verified REENTRY bank txn. Tournament = open unless noted.
  -- entries (busted source) for cases 1,2(seated),3,4,6 ; case 7 uses an INITIAL pending reg (no source).
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack) VALUES
    ('re500000-0000-0000-0000-0000000000e1','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000001',1,'busted',0),
    ('re500000-0000-0000-0000-0000000000e2','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000002',1,'seated',10000),  -- NOT busted
    ('re500000-0000-0000-0000-0000000000e3','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000003',1,'busted',0),
    ('re500000-0000-0000-0000-0000000000e4','re500000-0000-0000-0000-000000000009','re600000-0000-0000-0000-000000000004',1,'busted',0),  -- closed tour
    ('re500000-0000-0000-0000-0000000000e6','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000006',1,'busted',0);
  -- case 3: player 3 ALSO holds an ACTIVE seat (contradiction we force to test the 8b guard)
  INSERT INTO public.tournament_seats (id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, status, entry_id) VALUES
    ('re500000-0000-0000-0000-0000000000f3','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000003',1,'re500000-0000-0000-0000-0000000000a1',8,10000,true,'active','re500000-0000-0000-0000-0000000000e3');

  -- pending re-entry regs (source_entry_id set) + an INITIAL pending reg for case 7
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status, source_entry_id) VALUES
    ('re500000-0000-0000-0000-0000000000r1','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000001', v_club,100000,100000,'REENTRY-RE000001','pending','re500000-0000-0000-0000-0000000000e1'),
    ('re500000-0000-0000-0000-0000000000r2','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000002', v_club,100000,100000,'REENTRY-RE000002','pending','re500000-0000-0000-0000-0000000000e2'),
    ('re500000-0000-0000-0000-0000000000r3','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000003', v_club,100000,100000,'REENTRY-RE000003','pending','re500000-0000-0000-0000-0000000000e3'),
    ('re500000-0000-0000-0000-0000000000r4','re500000-0000-0000-0000-000000000009','re600000-0000-0000-0000-000000000004', v_club,100000,100000,'REENTRY-RE000004','pending','re500000-0000-0000-0000-0000000000e4'),
    ('re500000-0000-0000-0000-0000000000r6','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000006', v_club,100000,100000,'REENTRY-RE000006','pending','re500000-0000-0000-0000-0000000000e6'),
    ('re500000-0000-0000-0000-0000000000r7','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000007', v_club,100000,100000,'VINRegRE000007','pending',NULL);  -- INITIAL (regression)

  INSERT INTO public.bank_transactions (id, provider, provider_txn_id, account_number, amount, transfer_type, content, status, api_verified_at) VALUES
    ('re100000-0000-0000-0000-000000000001','sepay','RE-01','RESBX-ACCT',100000,'in','re REENTRY-RE000001','unmatched', now()),
    ('re100000-0000-0000-0000-000000000002','sepay','RE-02','RESBX-ACCT',100000,'in','re REENTRY-RE000002','unmatched', now()),
    ('re100000-0000-0000-0000-000000000003','sepay','RE-03','RESBX-ACCT',100000,'in','re REENTRY-RE000003','unmatched', now()),
    ('re100000-0000-0000-0000-000000000004','sepay','RE-04','RESBX-ACCT',100000,'in','re REENTRY-RE000004','unmatched', now()),
    ('re100000-0000-0000-0000-000000000005','sepay','RE-05','RESBX-ACCT',555000,'in','re REENTRY-RE000001','unmatched', now()),  -- amount != total_pay; reg already used by case 1? no — see case 5 note
    ('re100000-0000-0000-0000-0000000000d2','sepay','RE-06b','RESBX-ACCT',100000,'in','re REENTRY-RE000006','unmatched', now()),  -- double-pay bt #2 for reg r6
    ('re100000-0000-0000-0000-000000000006','sepay','RE-06','RESBX-ACCT',100000,'in','re REENTRY-RE000006','unmatched', now()),  -- double-pay bt #1 for reg r6
    ('re100000-0000-0000-0000-000000000007','sepay','RE-07','RESBX-ACCT',100000,'in','re VINRegRE000007','unmatched', now());

  -- ════════ HEADLESS: auth.uid() = NULL (service-role cron) ════════
  PERFORM set_config('request.jwt.claims', '', true);

  -- CASE 1 — re-entry pending + exact pay → auto_confirmed + seated + entry_no incremented + confirmed_by=bot
  v_ret := public.settle_bank_transaction('re100000-0000-0000-0000-000000000001', true);
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='re600000-0000-0000-0000-000000000001' AND is_active=true;
  INSERT INTO _re_results VALUES (1, 're-entry exact pay → auto_confirmed + 1 active seat',
    'auto_confirmed + seats=1', format('%s + seats=%s', v_ret->>'outcome', v_seats));

  -- CASE 2 — source entry NOT busted (seated) → flag, no seat
  v_ret := public.settle_bank_transaction('re100000-0000-0000-0000-000000000002', true);
  INSERT INTO _re_results VALUES (2, 'source entry not busted → flag',
    'flagged_* (entry_not_reenterable)', format('%s / %s', v_ret->>'outcome', (SELECT reason FROM public.payment_settlements WHERE bank_transaction_id='re100000-0000-0000-0000-000000000002')));

  -- CASE 3 — player already holds an active seat → flag (player_already_active)
  v_ret := public.settle_bank_transaction('re100000-0000-0000-0000-000000000003', true);
  INSERT INTO _re_results VALUES (3, 'active seat exists → flag',
    'flagged_* (player_already_active)', format('%s / %s', v_ret->>'outcome', (SELECT reason FROM public.payment_settlements WHERE bank_transaction_id='re100000-0000-0000-0000-000000000003')));

  -- CASE 4 — late-reg window closed (current_level 7 > late_reg_close_level 6) → flag
  v_ret := public.settle_bank_transaction('re100000-0000-0000-0000-000000000004', true);
  INSERT INTO _re_results VALUES (4, 'window closed → flag',
    'flagged_* (reentry_window_closed)', format('%s / %s', v_ret->>'outcome', (SELECT reason FROM public.payment_settlements WHERE bank_transaction_id='re100000-0000-0000-0000-000000000004')));

  -- CASE 5 — amount mismatch (555000 != 100000) → flagged_amount_mismatch (settle gate, before confirm)
  -- NB: bt RE-05 carries REENTRY-RE000001, whose reg r1 is now 'confirmed' (case 1) → settle flags as
  -- not_pending BEFORE the amount check. To test amount-mismatch cleanly we use a fresh pending reg:
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack) VALUES
    ('re500000-0000-0000-0000-0000000000e5','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000005',1,'busted',0);
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status, source_entry_id) VALUES
    ('re500000-0000-0000-0000-0000000000r5','re500000-0000-0000-0000-000000000001','re600000-0000-0000-0000-000000000005', v_club,100000,100000,'REENTRY-RE000005','pending','re500000-0000-0000-0000-0000000000e5');
  UPDATE public.bank_transactions SET content='re REENTRY-RE000005' WHERE id='re100000-0000-0000-0000-000000000005';
  v_ret := public.settle_bank_transaction('re100000-0000-0000-0000-000000000005', true);
  INSERT INTO _re_results VALUES (5, 'amount mismatch → flag', 'flagged_amount_mismatch', v_ret->>'outcome');

  -- CASE 6 — DOUBLE-PAY same reg (two bt, same REENTRY code): exactly 1 seat + 1 auto_confirmed; 2nd → flag.
  v_ret := public.settle_bank_transaction('re100000-0000-0000-0000-000000000006', true);  -- bt #1 → auto_confirmed
  v_ret := public.settle_bank_transaction('re100000-0000-0000-0000-0000000000d2', true);  -- bt #2 → flag (reg confirmed)
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='re600000-0000-0000-0000-000000000006' AND is_active=true;
  SELECT count(*) INTO v_autoconf FROM public.payment_settlements WHERE tournament_registration_id='re500000-0000-0000-0000-0000000000r6' AND outcome='auto_confirmed';
  SELECT outcome INTO v_st FROM public.payment_settlements WHERE bank_transaction_id='re100000-0000-0000-0000-0000000000d2';
  INSERT INTO _re_results VALUES (6, 'double-pay → 1 seat + 1 auto_confirmed + 2nd flagged',
    'seats=1 autoconf=1 bt2=flagged_not_pending', format('seats=%s autoconf=%s bt2=%s', v_seats, v_autoconf, v_st));

  -- CASE 7 — INITIAL path regression: source_entry_id NULL → confirm_registration_and_assign_seat (UNCHANGED)
  v_ret := public.settle_bank_transaction('re100000-0000-0000-0000-000000000007', true);
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='re600000-0000-0000-0000-000000000007' AND is_active=true;
  INSERT INTO _re_results VALUES (7, 'INITIAL path still auto_confirms (regression)',
    'auto_confirmed + seats=1', format('%s + seats=%s', v_ret->>'outcome', v_seats));

  PERFORM set_config('request.jwt.claims', '', true);
END $$;

SELECT case_no, scenario, expected, actual,
  CASE
    WHEN case_no IN (1,7) AND actual = 'auto_confirmed + seats=1' THEN 'PASS'
    WHEN case_no = 5 AND actual = 'flagged_amount_mismatch' THEN 'PASS'
    WHEN case_no = 6 AND actual = 'seats=1 autoconf=1 bt2=flagged_not_pending' THEN 'PASS'
    WHEN case_no IN (2,3,4) AND actual LIKE 'flagged_%' THEN 'PASS'
    ELSE 'FAIL'
  END AS verdict
FROM _re_results ORDER BY case_no;

ROLLBACK;
