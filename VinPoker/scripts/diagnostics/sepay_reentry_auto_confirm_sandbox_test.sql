-- ============================================================================
-- PATCH 4 / STAGE C — RE-ENTRY full-auto-confirm HEADLESS TEST.
-- One-paste, self-contained, BEGIN…ROLLBACK → NOTHING saved. Requires migrations
-- 20261122000000 + 20261122000001 + 20261123000000 applied. Simulates the cron: auth.uid()=NULL.
-- Uses a REAL non-super auth.users row as the SePay system "bot" (the seat-draw audit chain FKs auth.users).
-- Verdict must be PASS on every row. 9 cases: 1 happy · 2/3/4 guard flags (reason asserted, P1-4) · 5 amount
-- mismatch · 6 sequential double-pay · 7 INITIAL regression · 8 confirm idempotency · 9 table-full seating-failed.
--
-- NOTE (P1-2 / concurrency): this is a single-session SEQUENTIAL harness, so it CANNOT exercise the concurrent
-- double-pay interleave that the settle `FOR UPDATE` belt protects against — case 6 only proves the sequential
-- pending→confirmed flip blocks the 2nd pay. The concurrent path must be reasoned about (the 2nd worker blocks
-- on the reg lock, then reads status='confirmed' → flagged_not_pending) or checked with two real connections.
--
-- ⚠️ Paste and run the WHOLE block at once so the final ROLLBACK executes (runs on the production DB; fake
--    ids ae5…/ae6…/ae1… (valid hex) do not collide with real rows).
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
  v_e1 uuid;
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
    ('ae500000-0000-0000-0000-000000000001', v_club, '[RESBX] open',   'active', 10000, 100000, now()+interval '1 day', 1, 6),
    ('ae500000-0000-0000-0000-000000000009', v_club, '[RESBX] closed', 'active', 10000, 100000, now()+interval '1 day', 7, 6);
  INSERT INTO public.game_tables (id, club_id, table_name) VALUES
    ('ae500000-0000-0000-0000-0000000000a1', v_club, '[RESBX] gt1'),
    ('ae500000-0000-0000-0000-0000000000a9', v_club, '[RESBX] gt9');
  INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status) VALUES
    ('ae500000-0000-0000-0000-0000000000c1','ae500000-0000-0000-0000-000000000001','ae500000-0000-0000-0000-0000000000a1',1,9,'active'),
    ('ae500000-0000-0000-0000-0000000000c9','ae500000-0000-0000-0000-000000000009','ae500000-0000-0000-0000-0000000000a9',1,9,'active');
  INSERT INTO public.platform_bank_accounts (bank_name, account_number, account_holder, account_type, is_active, club_id) VALUES
    ('[RESBX] bank','RESBX-ACCT','[RESBX] holder','escrow', true, v_club);

  -- helper inline via explicit rows. Players re6…N. Each: a busted source entry, a PENDING re-entry reg
  -- (source_entry_id set), and an api-verified REENTRY bank txn. Tournament = open unless noted.
  -- entries (busted source) for cases 1,2(seated),3,4,6 ; case 7 uses an INITIAL pending reg (no source).
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack) VALUES
    ('ae500000-0000-0000-0000-0000000000e1','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000001',1,'busted',0),
    ('ae500000-0000-0000-0000-0000000000e2','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000002',1,'seated',10000),  -- NOT busted
    ('ae500000-0000-0000-0000-0000000000e3','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000003',1,'busted',0),
    ('ae500000-0000-0000-0000-0000000000e4','ae500000-0000-0000-0000-000000000009','ae600000-0000-0000-0000-000000000004',1,'busted',0),  -- closed tour
    ('ae500000-0000-0000-0000-0000000000e6','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000006',1,'busted',0);
  -- case 3: player 3 ALSO holds an ACTIVE seat (contradiction we force to test the 8b guard)
  INSERT INTO public.tournament_seats (id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, status, entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000f3','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000003',1,'ae500000-0000-0000-0000-0000000000c1',8,10000,true,'active','ae500000-0000-0000-0000-0000000000e3');

  -- pending re-entry regs (source_entry_id set) + an INITIAL pending reg for case 7
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status, source_entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000b1','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000001', v_club,100000,100000,'REENTRY-RE000001','pending','ae500000-0000-0000-0000-0000000000e1'),
    ('ae500000-0000-0000-0000-0000000000b2','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000002', v_club,100000,100000,'REENTRY-RE000002','pending','ae500000-0000-0000-0000-0000000000e2'),
    ('ae500000-0000-0000-0000-0000000000b3','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000003', v_club,100000,100000,'REENTRY-RE000003','pending','ae500000-0000-0000-0000-0000000000e3'),
    ('ae500000-0000-0000-0000-0000000000b4','ae500000-0000-0000-0000-000000000009','ae600000-0000-0000-0000-000000000004', v_club,100000,100000,'REENTRY-RE000004','pending','ae500000-0000-0000-0000-0000000000e4'),
    ('ae500000-0000-0000-0000-0000000000b6','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000006', v_club,100000,100000,'REENTRY-RE000006','pending','ae500000-0000-0000-0000-0000000000e6'),
    ('ae500000-0000-0000-0000-0000000000b7','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000007', v_club,100000,100000,'VINRegRE000007','pending',NULL);  -- INITIAL (regression)

  INSERT INTO public.bank_transactions (id, provider, provider_txn_id, account_number, amount, transfer_type, content, status, api_verified_at) VALUES
    ('ae100000-0000-0000-0000-000000000001','sepay','RE-01','RESBX-ACCT',100000,'in','re REENTRY-RE000001','unmatched', now()),
    ('ae100000-0000-0000-0000-000000000002','sepay','RE-02','RESBX-ACCT',100000,'in','re REENTRY-RE000002','unmatched', now()),
    ('ae100000-0000-0000-0000-000000000003','sepay','RE-03','RESBX-ACCT',100000,'in','re REENTRY-RE000003','unmatched', now()),
    ('ae100000-0000-0000-0000-000000000004','sepay','RE-04','RESBX-ACCT',100000,'in','re REENTRY-RE000004','unmatched', now()),
    ('ae100000-0000-0000-0000-000000000005','sepay','RE-05','RESBX-ACCT',555000,'in','re REENTRY-RE000001','unmatched', now()),  -- amount != total_pay; reg already used by case 1? no — see case 5 note
    ('ae100000-0000-0000-0000-0000000000d2','sepay','RE-06b','RESBX-ACCT',100000,'in','re REENTRY-RE000006','unmatched', now()),  -- double-pay bt #2 for reg r6
    ('ae100000-0000-0000-0000-000000000006','sepay','RE-06','RESBX-ACCT',100000,'in','re REENTRY-RE000006','unmatched', now()),  -- double-pay bt #1 for reg r6
    ('ae100000-0000-0000-0000-000000000007','sepay','RE-07','RESBX-ACCT',100000,'in','re VINRegRE000007','unmatched', now());

  -- ════════ HEADLESS: auth.uid() = NULL (service-role cron) ════════
  PERFORM set_config('request.jwt.claims', '', true);

  -- CASE 1 — re-entry pending + exact pay → auto_confirmed + seated + entry_no incremented + confirmed_by=bot
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000001', true);
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='ae600000-0000-0000-0000-000000000001' AND is_active=true;
  INSERT INTO _re_results VALUES (1, 're-entry exact pay → auto_confirmed + 1 active seat',
    'auto_confirmed + seats=1', format('%s + seats=%s', v_ret->>'outcome', v_seats));

  -- CASE 2 — source entry NOT busted (seated) → flag, no seat
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000002', true);
  INSERT INTO _re_results VALUES (2, 'source entry not busted → flag',
    'flagged_* (entry_not_reenterable)', format('%s / %s', v_ret->>'outcome', (SELECT reason FROM public.payment_settlements WHERE bank_transaction_id='ae100000-0000-0000-0000-000000000002')));

  -- CASE 3 — player already holds an active seat → flag (player_already_active)
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000003', true);
  INSERT INTO _re_results VALUES (3, 'active seat exists → flag',
    'flagged_* (player_already_active)', format('%s / %s', v_ret->>'outcome', (SELECT reason FROM public.payment_settlements WHERE bank_transaction_id='ae100000-0000-0000-0000-000000000003')));

  -- CASE 4 — late-reg window closed (current_level 7 > late_reg_close_level 6) → flag
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000004', true);
  INSERT INTO _re_results VALUES (4, 'window closed → flag',
    'flagged_* (reentry_window_closed)', format('%s / %s', v_ret->>'outcome', (SELECT reason FROM public.payment_settlements WHERE bank_transaction_id='ae100000-0000-0000-0000-000000000004')));

  -- CASE 5 — amount mismatch (555000 != 100000) → flagged_amount_mismatch (settle gate, before confirm)
  -- NB: bt RE-05 carries REENTRY-RE000001, whose reg r1 is now 'confirmed' (case 1) → settle flags as
  -- not_pending BEFORE the amount check. To test amount-mismatch cleanly we use a fresh pending reg:
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack) VALUES
    ('ae500000-0000-0000-0000-0000000000e5','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000005',1,'busted',0);
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status, source_entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000b5','ae500000-0000-0000-0000-000000000001','ae600000-0000-0000-0000-000000000005', v_club,100000,100000,'REENTRY-RE000005','pending','ae500000-0000-0000-0000-0000000000e5');
  UPDATE public.bank_transactions SET content='re REENTRY-RE000005' WHERE id='ae100000-0000-0000-0000-000000000005';
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000005', true);
  INSERT INTO _re_results VALUES (5, 'amount mismatch → flag', 'flagged_amount_mismatch', v_ret->>'outcome');

  -- CASE 6 — DOUBLE-PAY same reg (two bt, same REENTRY code): exactly 1 seat + 1 auto_confirmed; 2nd → flag.
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000006', true);  -- bt #1 → auto_confirmed
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-0000000000d2', true);  -- bt #2 → flag (reg confirmed)
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='ae600000-0000-0000-0000-000000000006' AND is_active=true;
  SELECT count(*) INTO v_autoconf FROM public.payment_settlements WHERE tournament_registration_id='ae500000-0000-0000-0000-0000000000b6' AND outcome='auto_confirmed';
  SELECT outcome INTO v_st FROM public.payment_settlements WHERE bank_transaction_id='ae100000-0000-0000-0000-0000000000d2';
  INSERT INTO _re_results VALUES (6, 'double-pay → 1 seat + 1 auto_confirmed + 2nd flagged',
    'seats=1 autoconf=1 bt2=flagged_not_pending', format('seats=%s autoconf=%s bt2=%s', v_seats, v_autoconf, v_st));

  -- CASE 7 — INITIAL path regression: source_entry_id NULL → confirm_registration_and_assign_seat (UNCHANGED)
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-000000000007', true);
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='ae600000-0000-0000-0000-000000000007' AND is_active=true;
  INSERT INTO _re_results VALUES (7, 'INITIAL path still auto_confirms (regression)',
    'auto_confirmed + seats=1', format('%s + seats=%s', v_ret->>'outcome', v_seats));

  -- CASE 8 (P1-5) — direct confirm idempotency: re-calling confirm_reentry_and_assign_seat on the
  -- ALREADY-confirmed re-entry reg r1 (confirmed in case 1) returns idempotent:true with the SAME entry, and
  -- the active-seat count stays exactly 1 (no double-seat on a confirm re-run). Impersonate the bot because
  -- guard 2.4 requires p_actor = auth.uid(); restore the headless empty claim right after.
  SELECT id INTO v_e1 FROM public.tournament_entries
    WHERE registration_id='ae500000-0000-0000-0000-0000000000b1' ORDER BY created_at ASC LIMIT 1;
  PERFORM set_config('request.jwt.claims', json_build_object('sub', v_bot::text)::text, true);
  v_ret := public.confirm_reentry_and_assign_seat('ae500000-0000-0000-0000-0000000000b1', v_bot, 'random_balanced');
  PERFORM set_config('request.jwt.claims', '', true);
  SELECT count(*) INTO v_seats FROM public.tournament_seats WHERE player_id='ae600000-0000-0000-0000-000000000001' AND is_active=true;
  INSERT INTO _re_results VALUES (8, 'confirm idempotency → idempotent, same entry, seats stay 1',
    'idempotent=true same_entry=t seats=1',
    format('idempotent=%s same_entry=%s seats=%s',
           coalesce(v_ret->>'idempotent','false'), ((v_ret->>'entry_id') = v_e1::text), v_seats));

  -- CASE 9 (P1-5) — table FULL at re-seat → flagged_seating_failed AND the re-entry reg STAYS pending
  -- (money recoverable, NO fake confirmed reg). Dedicated tournament re…00b: a single 1-seat table already
  -- filled by a filler player, plus a busted source entry + pending re-entry reg + api-verified bank txn for
  -- the re-entrant. The shared helper finds no table with free capacity → no_table_available → settle maps it
  -- to flagged_seating_failed; confirm_reentry returns BEFORE flipping the reg, so it remains 'pending'.
  INSERT INTO public.tournaments (id, club_id, name, status, starting_stack, buy_in, start_time, current_level, late_reg_close_level) VALUES
    ('ae500000-0000-0000-0000-00000000000b', v_club, '[RESBX] full', 'active', 10000, 100000, now()+interval '1 day', 1, 6);
  INSERT INTO public.game_tables (id, club_id, table_name) VALUES
    ('ae500000-0000-0000-0000-0000000000ab', v_club, '[RESBX] gtb');
  INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status) VALUES
    ('ae500000-0000-0000-0000-0000000000cb','ae500000-0000-0000-0000-00000000000b','ae500000-0000-0000-0000-0000000000ab',1,1,'active');
  INSERT INTO public.tournament_entries (id, tournament_id, player_id, entry_no, status, current_stack) VALUES
    ('ae500000-0000-0000-0000-0000000000eb','ae500000-0000-0000-0000-00000000000b','ae600000-0000-0000-0000-00000000000b',1,'seated',10000),  -- filler, occupies the only seat
    ('ae500000-0000-0000-0000-0000000000ea','ae500000-0000-0000-0000-00000000000b','ae600000-0000-0000-0000-00000000000a',1,'busted',0);     -- re-entrant's busted source
  -- filler seat: table_id = tournament_tables.id (cb) so the helper's capacity count sees it (matches the
  -- production seat-draw contract; NOT game_tables.id)
  INSERT INTO public.tournament_seats (id, tournament_id, player_id, entry_number, table_id, seat_number, chip_count, is_active, status, entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000fb','ae500000-0000-0000-0000-00000000000b','ae600000-0000-0000-0000-00000000000b',1,'ae500000-0000-0000-0000-0000000000cb',1,10000,true,'active','ae500000-0000-0000-0000-0000000000eb');
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status, source_entry_id) VALUES
    ('ae500000-0000-0000-0000-0000000000bb','ae500000-0000-0000-0000-00000000000b','ae600000-0000-0000-0000-00000000000a', v_club,100000,100000,'REENTRY-RE00000B','pending','ae500000-0000-0000-0000-0000000000ea');
  INSERT INTO public.bank_transactions (id, provider, provider_txn_id, account_number, amount, transfer_type, content, status, api_verified_at) VALUES
    ('ae100000-0000-0000-0000-00000000000b','sepay','RE-0B','RESBX-ACCT',100000,'in','re REENTRY-RE00000B','unmatched', now());
  v_ret := public.settle_bank_transaction('ae100000-0000-0000-0000-00000000000b', true);
  SELECT status INTO v_st FROM public.tournament_registrations WHERE id='ae500000-0000-0000-0000-0000000000bb';
  INSERT INTO _re_results VALUES (9, 'table full → flagged_seating_failed, reg stays pending',
    'flagged_seating_failed reg=pending', format('%s reg=%s', v_ret->>'outcome', v_st));

  PERFORM set_config('request.jwt.claims', '', true);
END $$;

SELECT case_no, scenario, expected, actual,
  CASE
    WHEN case_no IN (1,7) AND actual = 'auto_confirmed + seats=1' THEN 'PASS'
    WHEN case_no = 5 AND actual = 'flagged_amount_mismatch' THEN 'PASS'
    WHEN case_no = 6 AND actual = 'seats=1 autoconf=1 bt2=flagged_not_pending' THEN 'PASS'
    -- P1-4 (STAGE C review): assert the SPECIFIC reason, not just any flag. A flag raised for an unrelated
    -- cause (parser miss → flagged_no_match, etc.) must NOT pass these — the reason proves the guard fired.
    WHEN case_no = 2 AND actual LIKE 'flagged_%' AND actual LIKE '%entry_not_reenterable%' THEN 'PASS'
    WHEN case_no = 3 AND actual LIKE 'flagged_%' AND actual LIKE '%player_already_active%' THEN 'PASS'
    WHEN case_no = 4 AND actual LIKE 'flagged_%' AND actual LIKE '%reentry_window_closed%' THEN 'PASS'
    -- P1-5 (STAGE C review): confirm idempotency (no double-seat on re-run) + table-full seating-failed
    -- (money recoverable, reg stays pending).
    WHEN case_no = 8 AND actual = 'idempotent=true same_entry=t seats=1' THEN 'PASS'
    WHEN case_no = 9 AND actual = 'flagged_seating_failed reg=pending' THEN 'PASS'
    ELSE 'FAIL'
  END AS verdict
FROM _re_results ORDER BY case_no;

ROLLBACK;
