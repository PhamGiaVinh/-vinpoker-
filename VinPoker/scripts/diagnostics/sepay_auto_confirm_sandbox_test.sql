-- ============================================================================
-- SePay Patch 2d — FULL AUTO-CONFIRM (system actor) HEADLESS SANDBOX TEST.
-- One-paste, self-contained, BEGIN…ROLLBACK → NOTHING saved. Requires Migration
-- 20261117000000 + 20261118000000 applied. Simulates the cron: auth.uid()=NULL.
-- Uses a REAL non-super auth.users row as the "bot" (the seat-draw audit chain
-- swing_config_audit.changed_by FKs auth.users). Verdict must be PASS on every row.
--
-- ⚠️ Paste and run the WHOLE block at once. Do NOT select/run a portion — the final
--    ROLLBACK must execute so nothing is persisted (runs on production DB; test data
--    uses fake ids aca…/acb…/acc…/acf…/ace…/ac1… that do not collide with real rows).
-- ============================================================================
BEGIN;

DROP TABLE IF EXISTS _ac_results;
CREATE TEMP TABLE _ac_results (case_no int, scenario text, expected text, actual text);

DO $$
DECLARE
  v_test_club  uuid;
  v_other_club uuid;
  v_bot        uuid;                 -- REAL non-super auth.users id (the audit FK needs a real user)
  v_ret        jsonb;
  v_audit_before int;
BEGIN
  -- resolve a test club + a real non-super user as the bot
  SELECT id INTO v_test_club FROM public.clubs ORDER BY created_at, id LIMIT 1;
  IF v_test_club IS NULL THEN RAISE EXCEPTION 'AC-SBX: no club to host the test'; END IF;
  SELECT id INTO v_bot FROM auth.users
    WHERE id NOT IN (SELECT user_id FROM public.user_roles WHERE role = 'super_admin'::public.app_role)
    ORDER BY created_at LIMIT 1;
  IF v_bot IS NULL THEN RAISE EXCEPTION 'AC-SBX: need a non-super auth.users row as the bot'; END IF;
  -- a club the bot is NOT owner/cashier of → for the "club not opted in" negative
  SELECT id INTO v_other_club FROM public.clubs c
    WHERE c.id <> v_test_club
      AND c.owner_id IS DISTINCT FROM v_bot
      AND NOT EXISTS (SELECT 1 FROM public.club_cashiers cc WHERE cc.club_id = c.id AND cc.user_id = v_bot)
    ORDER BY created_at, id LIMIT 1;

  -- provision: settings (bot + DB switch ON) + opt-in test club (bot ∈ club_cashiers)
  UPDATE public.sepay_system_settings SET system_actor_id = v_bot, auto_confirm_enabled = true WHERE id = true;
  INSERT INTO public.club_cashiers (club_id, user_id) VALUES (v_test_club, v_bot) ON CONFLICT DO NOTHING;

  -- tournaments: seatable + no-table (test club); + one in the other club (negative)
  INSERT INTO public.tournaments (id, club_id, name, status, starting_stack, buy_in, start_time) VALUES
    ('aca00000-0000-0000-0000-000000000001', v_test_club, '[ACSBX] seatable','active',10000,100000, now()+interval '1 day'),
    ('aca00000-0000-0000-0000-000000000002', v_test_club, '[ACSBX] no table','active',10000,100000, now()+interval '1 day');
  IF v_other_club IS NOT NULL THEN
    INSERT INTO public.tournaments (id, club_id, name, status, starting_stack, buy_in, start_time) VALUES
      ('aca00000-0000-0000-0000-000000000003', v_other_club,'[ACSBX] other club','active',10000,100000, now()+interval '1 day');
  END IF;

  INSERT INTO public.game_tables (id, club_id, table_name) VALUES
    ('acb00000-0000-0000-0000-000000000001', v_test_club, '[ACSBX] table 1');
  INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status) VALUES
    ('acc00000-0000-0000-0000-000000000001','aca00000-0000-0000-0000-000000000001','acb00000-0000-0000-0000-000000000001',1,9,'active');
  IF v_other_club IS NOT NULL THEN
    INSERT INTO public.game_tables (id, club_id, table_name) VALUES
      ('acb00000-0000-0000-0000-000000000003', v_other_club, '[ACSBX] other table');
    INSERT INTO public.tournament_tables (id, tournament_id, table_id, table_number, max_seats, status) VALUES
      ('acc00000-0000-0000-0000-000000000003','aca00000-0000-0000-0000-000000000003','acb00000-0000-0000-0000-000000000003',1,9,'active');
  END IF;

  -- account → club mapping (settle resolves club via platform_bank_accounts, exactly one active)
  INSERT INTO public.platform_bank_accounts (bank_name, account_number, account_holder, account_type, is_active, club_id) VALUES
    ('[ACSBX] bank','ACSBX-ACCT-T','[ACSBX] holder','escrow', true, v_test_club);
  IF v_other_club IS NOT NULL THEN
    INSERT INTO public.platform_bank_accounts (bank_name, account_number, account_holder, account_type, is_active, club_id) VALUES
      ('[ACSBX] bank','ACSBX-ACCT-O','[ACSBX] holder','escrow', true, v_other_club);
  END IF;

  -- registrations (pending; exact reference_code + total_pay)
  INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status) VALUES
    ('acf00000-0000-0000-0000-000000000001','aca00000-0000-0000-0000-000000000001','ace00000-0000-0000-0000-000000000001', v_test_club,100000,100000,'VINRegAC000001','pending'),
    ('acf00000-0000-0000-0000-000000000002','aca00000-0000-0000-0000-000000000001','ace00000-0000-0000-0000-000000000002', v_test_club,200000,200000,'VINRegAC000002','pending'),
    ('acf00000-0000-0000-0000-000000000003','aca00000-0000-0000-0000-000000000001','ace00000-0000-0000-0000-000000000003', v_test_club,300000,300000,'VINRegAC000003','pending'),
    ('acf00000-0000-0000-0000-000000000005','aca00000-0000-0000-0000-000000000001','ace00000-0000-0000-0000-000000000005', v_test_club,500000,500000,'VINRegAC000005','pending'),
    ('acf00000-0000-0000-0000-000000000006','aca00000-0000-0000-0000-000000000002','ace00000-0000-0000-0000-000000000006', v_test_club,600000,600000,'VINRegAC000006','pending');
  IF v_other_club IS NOT NULL THEN
    INSERT INTO public.tournament_registrations (id, tournament_id, player_id, club_id, buy_in, total_pay, reference_code, status) VALUES
      ('acf00000-0000-0000-0000-000000000004','aca00000-0000-0000-0000-000000000003','ace00000-0000-0000-0000-000000000004', v_other_club,400000,400000,'VINRegAC000004','pending');
  END IF;

  -- bank txns (api_verified, 'in', exact amount; content carries the code)
  INSERT INTO public.bank_transactions (id, provider, provider_txn_id, account_number, amount, transfer_type, content, status, api_verified_at) VALUES
    ('ac100000-0000-0000-0000-000000000001','sepay','AC-01','ACSBX-ACCT-T',100000,'in','ac VINRegAC000001','unmatched', now()),
    ('ac100000-0000-0000-0000-000000000002','sepay','AC-02','ACSBX-ACCT-T',200000,'in','ac VINRegAC000002','unmatched', now()),
    ('ac100000-0000-0000-0000-000000000003','sepay','AC-03','ACSBX-ACCT-T',300000,'in','ac VINRegAC000003','unmatched', now()),
    ('ac100000-0000-0000-0000-000000000005','sepay','AC-05','ACSBX-ACCT-T',555000,'in','ac VINRegAC000005','unmatched', now()),  -- amount != total_pay(500000)
    ('ac100000-0000-0000-0000-000000000006','sepay','AC-06','ACSBX-ACCT-T',600000,'in','ac VINRegAC000006','unmatched', now());
  IF v_other_club IS NOT NULL THEN
    INSERT INTO public.bank_transactions (id, provider, provider_txn_id, account_number, amount, transfer_type, content, status, api_verified_at) VALUES
      ('ac100000-0000-0000-0000-000000000004','sepay','AC-04','ACSBX-ACCT-O',400000,'in','ac VINRegAC000004','unmatched', now());
  END IF;

  -- ════════ HEADLESS: auth.uid() = NULL, exactly like the service-role cron ════════
  PERFORM set_config('request.jwt.claims', '', true);

  -- (a) POSITIVE: exact + all 3 gates on → auto_confirmed
  SELECT count(*) INTO v_audit_before FROM public.swing_config_audit WHERE changed_by = v_bot;
  v_ret := public.settle_bank_transaction('ac100000-0000-0000-0000-000000000001', true);
  INSERT INTO _ac_results VALUES (1,'exact + all gates on -> auto_confirmed','auto_confirmed', coalesce(v_ret->>'outcome', v_ret->>'error', v_ret::text));

  -- (c) reset/no-leak: claims restored to '' after settle (NOT the bot)
  INSERT INTO _ac_results VALUES (2,'claims restored after settle (no leak)','EMPTY',
    CASE WHEN coalesce(current_setting('request.jwt.claims', true),'')='' THEN 'EMPTY' ELSE 'LEAKED' END);

  -- (a) confirmed_by = bot ; reg confirmed ; 1 seat ; bt matched
  INSERT INTO _ac_results VALUES (3,'settlement auto_confirmed confirmed_by=bot','yes',
    (SELECT CASE WHEN outcome='auto_confirmed' AND confirmed_by=v_bot THEN 'yes' ELSE coalesce(outcome,'none')||'/'||coalesce(confirmed_by::text,'null') END
       FROM public.payment_settlements WHERE bank_transaction_id='ac100000-0000-0000-0000-000000000001'));
  INSERT INTO _ac_results VALUES (4,'reg ..01 now confirmed','confirmed',
    (SELECT status::text FROM public.tournament_registrations WHERE id='acf00000-0000-0000-0000-000000000001'));
  INSERT INTO _ac_results VALUES (5,'exactly 1 active seat for player ..01','1',
    (SELECT count(*)::text FROM public.tournament_seats WHERE player_id='ace00000-0000-0000-0000-000000000001' AND is_active));
  INSERT INTO _ac_results VALUES (6,'bt ..01 now matched','matched',
    (SELECT status::text FROM public.bank_transactions WHERE id='ac100000-0000-0000-0000-000000000001'));

  -- (b) swing_config_audit chain ran under the bot (changed_by=bot count increased)
  INSERT INTO _ac_results VALUES (7,'swing_config_audit changed_by=bot (chain ran)','increased',
    CASE WHEN (SELECT count(*) FROM public.swing_config_audit WHERE changed_by = v_bot) > v_audit_before THEN 'increased' ELSE 'no' END);

  -- (d) gate 1 OFF (env): p_auto_confirm=false → flag-only, no settlement
  v_ret := public.settle_bank_transaction('ac100000-0000-0000-0000-000000000002', false);
  INSERT INTO _ac_results VALUES (8,'gate1 env off -> flag-only (no settlement)','flagonly',
    CASE WHEN (v_ret->>'auto_confirm')='false'
          AND NOT EXISTS (SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id='ac100000-0000-0000-0000-000000000002')
         THEN 'flagonly' ELSE coalesce(v_ret->>'outcome','?') END);

  -- (d) gate 2 OFF (DB kill-switch): auto_confirm_enabled=false → flag-only reason=auto_disabled
  UPDATE public.sepay_system_settings SET auto_confirm_enabled = false WHERE id = true;
  v_ret := public.settle_bank_transaction('ac100000-0000-0000-0000-000000000003', true);
  INSERT INTO _ac_results VALUES (9,'gate2 DB off -> flag-only auto_disabled','auto_disabled',
    coalesce(v_ret->>'reason', v_ret->>'outcome','?'));
  INSERT INTO _ac_results VALUES (10,'gate2 off wrote NO settlement','none',
    CASE WHEN EXISTS (SELECT 1 FROM public.payment_settlements WHERE bank_transaction_id='ac100000-0000-0000-0000-000000000003') THEN 'some' ELSE 'none' END);
  UPDATE public.sepay_system_settings SET auto_confirm_enabled = true WHERE id = true;   -- restore

  -- (d) gate 3 OFF (club not opted in): bot not a cashier of other_club → flag-only club_not_opted_in
  IF v_other_club IS NOT NULL THEN
    v_ret := public.settle_bank_transaction('ac100000-0000-0000-0000-000000000004', true);
    INSERT INTO _ac_results VALUES (11,'gate3 club not opted-in -> flag-only','club_not_opted_in',
      coalesce(v_ret->>'reason', v_ret->>'outcome','?'));
    INSERT INTO _ac_results VALUES (12,'gate3 off: reg ..04 still pending','pending',
      (SELECT status::text FROM public.tournament_registrations WHERE id='acf00000-0000-0000-0000-000000000004'));
  ELSE
    INSERT INTO _ac_results VALUES (11,'gate3 (no eligible other club -> SKIPPED)','SKIPPED','SKIPPED');
    INSERT INTO _ac_results VALUES (12,'gate3 reg pending (SKIPPED)','SKIPPED','SKIPPED');
  END IF;

  -- amount mismatch → flagged_amount_mismatch (never confirm)
  v_ret := public.settle_bank_transaction('ac100000-0000-0000-0000-000000000005', true);
  INSERT INTO _ac_results VALUES (13,'amount mismatch -> flagged_amount_mismatch','flagged_amount_mismatch', coalesce(v_ret->>'outcome', v_ret->>'error','?'));

  -- seating fail (no-table tournament, opted-in club) → flagged_seating_failed
  v_ret := public.settle_bank_transaction('ac100000-0000-0000-0000-000000000006', true);
  INSERT INTO _ac_results VALUES (14,'no-table -> flagged_seating_failed','flagged_seating_failed', coalesce(v_ret->>'outcome', v_ret->>'error','?'));

  -- (e) double-run the positive bt → already_settled; still exactly 1 settlement + 1 seat
  v_ret := public.settle_bank_transaction('ac100000-0000-0000-0000-000000000001', true);
  INSERT INTO _ac_results VALUES (15,'double-run -> already_settled','already_settled',
    CASE WHEN (v_ret->>'already_settled')='true' THEN 'already_settled' ELSE coalesce(v_ret->>'outcome','?') END);
  INSERT INTO _ac_results VALUES (16,'double-run: still 1 confirm settlement for bt ..01','1',
    (SELECT count(*)::text FROM public.payment_settlements WHERE bank_transaction_id='ac100000-0000-0000-0000-000000000001' AND outcome='auto_confirmed'));
  INSERT INTO _ac_results VALUES (17,'double-run: still exactly 1 seat for player ..01','1',
    (SELECT count(*)::text FROM public.tournament_seats WHERE player_id='ace00000-0000-0000-0000-000000000001' AND is_active));

  PERFORM set_config('request.jwt.claims', '{}', true);   -- cosmetic; we roll back
END $$;

SELECT case_no, scenario, expected, actual,
       CASE WHEN actual = expected OR expected = 'SKIPPED' THEN 'PASS' ELSE 'FAIL' END AS verdict
FROM _ac_results ORDER BY case_no;

ROLLBACK;
