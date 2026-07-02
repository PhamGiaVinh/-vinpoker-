-- SePay ingestion — GQR-M4: settle FNB- guest bank transfers (F&B guest QR ordering, plan PART 11).
--
-- SOURCE-ONLY migration. NOT applied on merge. Apply in a controlled session AFTER 20261111000017/18/19
-- (fnb payment columns/RPCs) — and note this file MUST be applied BEFORE any table QR is printed:
-- an FNB- transfer settling through the CURRENT live settle would write flagged_no_match, and the
-- one-settlement-per-txn idempotency would park that transfer until a manual ignore.
--
-- ⚠️ NUMBERING: deliberately TAIL-NUMBERED (after 20261211000000, the current tail) and NOT in the
-- 20261111 F&B series — settle_bank_transaction is owned by 20261118000000 and
-- sepay_parse_reference_code by 20261113000000; a 20261111-numbered redefinition would be
-- overwritten on any fresh replay. schema_migrations untouched.
--
-- WHAT (three pieces):
--   1. payment_settlements += fnb_order_id (nullable FK) — settlement rows for F&B carry the order.
--      The outcome CHECK is UNTOUCHED (F&B reuses auto_confirmed / flagged_* / …).
--   2. sepay_parse_reference_code: clone of the …1113 body + the FNB-{8hex} alternation.
--      STATED REGRESSION (accepted): a memo containing BOTH a VINREG and an FNB token now parses
--      NULL (ambiguous → flag) instead of matching the VINREG — consistent with "never guess".
--   3. fnb_settle_bank_paid (NEW, system-actor) + settle_bank_transaction: clone of the CURRENT LIVE
--      …1118 body with ONE inserted, self-contained FNB branch right after ref-parse. The tournament
--      decision tree below the branch is BYTE-IDENTICAL (review: diff against …1118).
--
-- F&B AUTO-CONFIRM GATE: per-club fnb_settings.guest_bank_auto_confirm (default false). The
-- tournament p_auto_confirm (edge SEPAY_AUTO_CONFIRM env) is DELIBERATELY NOT consulted for FNB —
-- flipping F&B auto-confirm on/off never changes tournament behavior and vice versa. Gate off →
-- flag-only return (writes NOTHING, bt stays 'unmatched') so the match stays recoverable.
--
-- NO IMPERSONATION NEEDED (unlike the tournament branch): F&B actor columns (fnb_orders.paid_by,
-- fnb_order_events.actor, fnb_stock_movements.actor) are plain nullable uuids with no FK — the
-- system settle writes NULL + event metadata {via:'sepay_auto', bank_transaction_id}.
--
-- PRICE SEMANTICS (deliberate difference from fnb_mark_paid): the staff mark_paid re-reads live menu
-- prices at PAID. The bank settle must NOT — the guest already transferred EXACTLY the create-time
-- subtotal (the VietQR amount, matched below against bt.amount). fnb_settle_bank_paid therefore
-- KEEPS the create-time unit_price_snapshot/subtotal and freezes ONLY COGS at settle time.
--
-- Idempotent: CREATE OR REPLACE / ADD COLUMN IF NOT EXISTS; explicit REVOKE/GRANT. ROLLBACK: bottom.

-- ===========================================================================================
-- 1. payment_settlements — carry the F&B order on settlement rows (NULL for tournament rows).
-- ===========================================================================================
ALTER TABLE public.payment_settlements
  ADD COLUMN IF NOT EXISTS fnb_order_id uuid REFERENCES public.fnb_orders(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_payment_settlements_fnb_order
  ON public.payment_settlements (fnb_order_id) WHERE fnb_order_id IS NOT NULL;

-- ===========================================================================================
-- 2. sepay_parse_reference_code — …1113 clone + FNB token. Case-insensitive; EXACTLY ONE distinct
--    token across ALL patterns or NULL (never guesses).
-- ===========================================================================================
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
                      '\y(VINREG[A-Z0-9]{8}|REENTRY-?[A-Z0-9]{8}|FNB-?[A-Z0-9]{8})\y', 'g') AS m;
  IF v_toks IS NULL OR array_length(v_toks, 1) <> 1 THEN
    RETURN NULL;                       -- zero or multiple distinct tokens → ambiguous → flag, never guess
  END IF;
  -- Re-insert the hyphen if a bank stripped it, so it matches the stored 'REENTRY-'/'FNB-' formats.
  RETURN regexp_replace(regexp_replace(v_toks[1],
           '^REENTRY([A-Z0-9])', 'REENTRY-\1'),
           '^FNB([A-Z0-9])',     'FNB-\1');
END;
$$;
REVOKE ALL ON FUNCTION public.sepay_parse_reference_code(text) FROM PUBLIC, anon, authenticated;

-- ===========================================================================================
-- 3a. fnb_settle_bank_paid — INTERNAL system-actor atomic PAID for a guest bank order. Mirrors the
--     …0010 fnb_mark_paid sequence (RECIPE_REQUIRED guard → fixed-order ingredient locks → shortage
--     BLOCK → stock decrement + 'sale' ledger → COGS freeze → flip) with three deliberate deltas:
--       • no auth.uid() gate — callable ONLY by settle_bank_transaction / service_role (REVOKE all
--         client roles below; never GRANT to authenticated/anon);
--       • prices NOT re-read (see PRICE SEMANTICS in header) — create-time snapshots kept;
--       • system actor: paid_by NULL, ledger/event actor NULL, event metadata carries the bank txn.
--     Accepts status='pending' PLUS a BOUNDED REVIVE: 'expired' orders newer than 2h (expiry moved
--     no stock — revive is the identical PAID sequence with fresh stock checks under lock).
--     RECIPE_REQUIRED / INSUFFICIENT_STOCK RAISE (check_violation) → caller maps to a flagged row.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_settle_bank_paid(
  p_order_id            uuid,
  p_bank_transaction_id uuid
) RETURNS jsonb
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_order     public.fnb_orders%ROWTYPE;
  v_old       text;
  v_revived   boolean := false;
  v_shortages jsonb;
  v_norecipe  jsonb;
  v_need      record;
  v_after     numeric;
  v_avg       numeric;
  v_subtotal  bigint;
  v_cogs      bigint;
BEGIN
  SELECT * INTO v_order FROM public.fnb_orders WHERE id = p_order_id FOR UPDATE;
  IF NOT FOUND THEN RETURN jsonb_build_object('ok', false, 'error', 'ORDER_NOT_FOUND'); END IF;

  IF v_order.status = 'paid' THEN
    RETURN jsonb_build_object('ok', true, 'order_id', p_order_id, 'idempotent', true);
  END IF;
  IF v_order.status = 'expired' AND v_order.created_at > now() - interval '2 hours' THEN
    v_revived := true;                                   -- bounded revive: money arrived after the TTL sweep
  ELSIF v_order.status <> 'pending' THEN
    RETURN jsonb_build_object('ok', false, 'error', 'BAD_STATE', 'status', v_order.status);
  END IF;
  v_old := v_order.status;

  -- (P0-3) RECIPE REQUIRED — identical guard to …0010 (a guest bank order still consumes real stock).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'menu_item_id', oi.menu_item_id, 'name', oi.name_snapshot, 'qty', oi.qty)), '[]'::jsonb)
    INTO v_norecipe
  FROM public.fnb_order_items oi
  JOIN public.fnb_menu_items mi ON mi.id = oi.menu_item_id
  WHERE oi.order_id = p_order_id
    AND COALESCE(mi.tracks_inventory, true)
    AND NOT EXISTS (SELECT 1 FROM public.fnb_recipe_items ri WHERE ri.menu_item_id = oi.menu_item_id);
  IF jsonb_array_length(v_norecipe) > 0 THEN
    RAISE EXCEPTION 'RECIPE_REQUIRED' USING DETAIL = v_norecipe::text, ERRCODE = 'check_violation';
  END IF;

  -- lock EVERY needed ingredient in the fixed id order (deadlock-safe vs mark_paid/cancel/stocktake).
  PERFORM 1 FROM public.fnb_ingredients i
  WHERE i.id IN (
    SELECT DISTINCT ri.ingredient_id
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = p_order_id
  )
  ORDER BY i.id
  FOR UPDATE;

  -- #A BLOCK — abort the whole settle on shortage (caller maps the RAISE to a flagged settlement).
  SELECT COALESCE(jsonb_agg(jsonb_build_object(
           'ingredient_id', s.ingredient_id, 'name', s.name, 'need', s.need, 'on_hand', s.on_hand)), '[]'::jsonb)
    INTO v_shortages
  FROM (
    SELECT ri.ingredient_id, ing.name, SUM(oi.qty * ri.qty) AS need, ing.on_hand
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
    WHERE oi.order_id = p_order_id
    GROUP BY ri.ingredient_id, ing.name, ing.on_hand
    HAVING SUM(oi.qty * ri.qty) > ing.on_hand
  ) s;
  IF jsonb_array_length(v_shortages) > 0 THEN
    RAISE EXCEPTION 'INSUFFICIENT_STOCK' USING DETAIL = v_shortages::text, ERRCODE = 'check_violation';
  END IF;

  -- NOTE: NO price re-read here (deliberate — see header). The guest paid the create-time subtotal.

  -- decrement stock + one 'sale' ledger row per ingredient (actor NULL = system), fixed id order.
  FOR v_need IN
    SELECT ri.ingredient_id AS ingredient_id, SUM(oi.qty * ri.qty) AS need
    FROM public.fnb_order_items oi
    JOIN public.fnb_recipe_items ri ON ri.menu_item_id = oi.menu_item_id
    WHERE oi.order_id = p_order_id
    GROUP BY ri.ingredient_id
    ORDER BY ri.ingredient_id
  LOOP
    UPDATE public.fnb_ingredients
      SET on_hand = on_hand - v_need.need, version = version + 1, updated_at = now()
      WHERE id = v_need.ingredient_id
      RETURNING on_hand, avg_unit_cost INTO v_after, v_avg;
    INSERT INTO public.fnb_stock_movements
      (club_id, ingredient_id, delta, reason, unit_cost, balance_after, ref_type, ref_id, actor)
    VALUES
      (v_order.club_id, v_need.ingredient_id, -v_need.need, 'sale', v_avg, v_after, 'order', p_order_id, NULL);
  END LOOP;

  -- freeze COGS per line (identical formula to …0010).
  UPDATE public.fnb_order_items oi
    SET unit_cost_snapshot = COALESCE((
      SELECT SUM(ri.qty * ing.avg_unit_cost)
      FROM public.fnb_recipe_items ri
      JOIN public.fnb_ingredients ing ON ing.id = ri.ingredient_id
      WHERE ri.menu_item_id = oi.menu_item_id
    ), 0)
    WHERE oi.order_id = p_order_id;

  SELECT COALESCE(SUM(unit_price_snapshot * qty), 0),
         COALESCE(ROUND(SUM(unit_cost_snapshot * qty)), 0)
    INTO v_subtotal, v_cogs
  FROM public.fnb_order_items WHERE order_id = p_order_id;

  UPDATE public.fnb_orders
    SET status = 'paid', paid_by = NULL, paid_at = now(),
        subtotal_vnd = v_subtotal, cogs_vnd = v_cogs, updated_at = now()
    WHERE id = p_order_id;
  UPDATE public.fnb_order_items SET line_status = 'paid' WHERE order_id = p_order_id;
  INSERT INTO public.fnb_order_events (order_id, club_id, action, old_status, new_status, actor, metadata)
  VALUES (p_order_id, v_order.club_id, 'paid', v_old, 'paid', NULL,
          jsonb_build_object('via', 'sepay_auto', 'bank_transaction_id', p_bank_transaction_id,
                             'revived', v_revived));

  RETURN jsonb_build_object('ok', true, 'order_id', p_order_id,
                            'subtotal_vnd', v_subtotal, 'cogs_vnd', v_cogs,
                            'revived', v_revived, 'idempotent', false);
END;
$$;

REVOKE ALL ON FUNCTION public.fnb_settle_bank_paid(uuid, uuid) FROM PUBLIC, anon, authenticated;
GRANT  EXECUTE ON FUNCTION public.fnb_settle_bank_paid(uuid, uuid) TO service_role;

-- ===========================================================================================
-- 3b. settle_bank_transaction — …1118 clone + ONE self-contained FNB branch (marked [FNB]) right
--     after ref-parse. Everything below the branch (the tournament decision tree, gates,
--     impersonation, settlement insert) is BYTE-IDENTICAL to …1118.
-- ===========================================================================================
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
  -- [FNB] guest-order branch locals
  v_ord           public.fnb_orders%ROWTYPE;
  v_ord_count     int := 0;
  v_fnb_gate      boolean := false;
  v_fnb           jsonb;
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

  -- 5. Parse the reference_code (exactly one VINReg/REENTRY/FNB token or NULL) from memo + ref.
  v_ref := public.sepay_parse_reference_code(coalesce(v_bt.content,'') || ' ' || coalesce(v_bt.txn_ref,''));

  -- ── [FNB] guest-order branch — self-contained; the tournament tree below never sees FNB refs ──
  IF v_ref IS NOT NULL AND v_ref LIKE 'FNB-%' THEN
    SELECT count(*) INTO v_ord_count
    FROM public.fnb_orders o WHERE upper(o.reference_code) = upper(v_ref);
    IF v_ord_count = 1 THEN
      SELECT * INTO v_ord FROM public.fnb_orders o WHERE upper(o.reference_code) = upper(v_ref) LIMIT 1;
    END IF;

    IF v_ord_count <> 1 THEN
      v_outcome := 'flagged_no_match';
      v_reason  := format('fnb ref=%s order_count=%s', v_ref, v_ord_count);
    ELSIF v_club_id IS NULL OR v_ord.club_id IS DISTINCT FROM v_club_id THEN
      v_outcome := 'flagged_no_match';
      v_reason  := 'fnb club unresolved or club mismatch';
    ELSIF v_bt.amount IS DISTINCT FROM v_ord.subtotal_vnd THEN
      v_outcome := 'flagged_amount_mismatch';
      v_reason  := format('amount=%s expected=%s', v_bt.amount, v_ord.subtotal_vnd);
    ELSIF v_ord.status <> 'pending'
          AND NOT (v_ord.status = 'expired' AND v_ord.created_at > now() - interval '2 hours') THEN
      v_outcome := 'flagged_not_pending';
      v_reason  := format('fnb order.status=%s', v_ord.status);
    ELSE
      -- EXACT F&B MATCH. Gate = per-club fnb_settings.guest_bank_auto_confirm ONLY (the tournament
      -- p_auto_confirm env gate is deliberately NOT consulted — independent kill switches).
      SELECT COALESCE(s.guest_bank_auto_confirm, false) INTO v_fnb_gate
      FROM public.fnb_settings s WHERE s.club_id = v_ord.club_id;
      IF NOT COALESCE(v_fnb_gate, false) THEN
        -- flag-only: write NOTHING, leave bt unmatched → recoverable (re-settle after the gate flips,
        -- or the cashier marks the order paid manually).
        RETURN jsonb_build_object('ok', true, 'exact_match', true, 'auto_confirm', false,
                                  'reason', 'fnb_auto_disabled', 'fnb_order_id', v_ord.id);
      END IF;

      BEGIN
        v_fnb := public.fnb_settle_bank_paid(v_ord.id, p_bank_transaction_id);
        IF COALESCE((v_fnb->>'ok')::boolean, false) THEN
          v_outcome := 'auto_confirmed';
          UPDATE public.bank_transactions
            SET status = 'matched', processed_at = now(), club_id = v_club_id
            WHERE id = p_bank_transaction_id;
        ELSE
          v_outcome := 'flagged_not_pending';
          v_reason  := coalesce(v_fnb->>'error', 'fnb_settle_failed');
        END IF;
      EXCEPTION WHEN OTHERS THEN
        -- RECIPE_REQUIRED / INSUFFICIENT_STOCK (check_violation) or any unexpected error: the order
        -- stays pending (subtx rolled back) → the cashier can fix stock and mark it paid manually.
        v_outcome := 'flagged_not_pending';
        v_reason  := left(coalesce(SQLERRM, 'fnb_settle_exception'), 200);
      END;
    END IF;

    INSERT INTO public.payment_settlements
      (bank_transaction_id, tournament_registration_id, fnb_order_id, club_id, amount, expected_amount,
       reference_code, outcome, confirmed_by, reason)
    VALUES
      (p_bank_transaction_id, NULL, CASE WHEN v_ord_count = 1 THEN v_ord.id ELSE NULL END,
       v_club_id, v_bt.amount, CASE WHEN v_ord_count = 1 THEN v_ord.subtotal_vnd ELSE NULL END,
       v_ref, v_outcome, NULL, v_reason);

    RETURN jsonb_build_object('ok', true, 'outcome', v_outcome,
                              'fnb_order_id', CASE WHEN v_ord_count = 1 THEN v_ord.id ELSE NULL END,
                              'club_id', v_club_id);
  END IF;
  -- ── [FNB] end of branch — below this line is BYTE-IDENTICAL to …1118 ─────────────────────────

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

-- ===========================================================================================
-- Controlled-apply PROOF PLAN (BEGIN … ROLLBACK, after …0017/18/19 + this; fixture club with an
-- active escrow account whose account_number matches a test bank_transactions row):
--   -- TOURNAMENT REGRESSION FIRST (the branch must be invisible to non-FNB refs):
--   -- (r1) a VINREG exact-match transfer with p_auto_confirm=false → {exact_match:true} flag-only,
--   --      byte-identical behavior to …1118 (no settlement row, bt unmatched).
--   -- (r2) a REENTRY ref parses with the hyphen restored; (r3) memo with BOTH a VINREG and an FNB
--   --      token → parse NULL → flagged_no_match ('never guess' — stated regression).
--   -- FNB BRANCH:
--   -- (a) guest bank order (from …0018) + a matching api-verified 'in' bt with memo 'FNB-XXXXXXXX'
--   --     amount == subtotal, gate ON → settle → {outcome:'auto_confirmed'}; order paid (paid_by
--   --     NULL, event metadata via='sepay_auto'), stock decremented, COGS>0, bt matched,
--   --     payment_settlements row carries fnb_order_id.
--   -- (b) same but gate OFF → {exact_match:true, reason:'fnb_auto_disabled'}, NO settlement row,
--   --     bt stays unmatched (recoverable). Flip gate on, re-settle → auto_confirmed.
--   -- (c) wrong amount → flagged_amount_mismatch (expected_amount = subtotal recorded).
--   -- (d) order already paid (duplicate transfer, same memo) → flagged_not_pending.
--   -- (e) order expired <2h ago → REVIVED + paid (event metadata revived:true); expired >2h →
--   --     flagged_not_pending.
--   -- (f) out-of-stock at settle → INSUFFICIENT_STOCK caught → flagged_not_pending with reason;
--   --     order STAYS pending (subtx rolled back) → cashier restocks and fnb_mark_paid works.
--   -- (g) settle idempotency: second settle of the same bt → {already_settled:true}.
--   -- (h) price-edit drill: owner raises the menu price AFTER the guest ordered → settle still
--   --     succeeds at the create-time subtotal (== amount paid); subtotal_vnd unchanged.
--   -- (i) anon/authenticated CANNOT call fnb_settle_bank_paid (permission denied).
-- ROLLBACK;
--
-- Read-only VERIFY after apply:
--   SELECT public.sepay_parse_reference_code('chuyen tien FNB1A2B3C4D');   -- 'FNB-1A2B3C4D'
--   SELECT public.sepay_parse_reference_code('VINREG1A2BKXYZ FNB-AAAA1111'); -- NULL (ambiguous)
--   SELECT has_function_privilege('authenticated','public.fnb_settle_bank_paid(uuid,uuid)','EXECUTE'); -- f
--   SELECT column_name FROM information_schema.columns
--     WHERE table_name='payment_settlements' AND column_name='fnb_order_id';  -- 1 row
-- ===========================================================================================
--
-- ROLLBACK (undo this migration):
--   Re-apply the …1118 settle_bank_transaction body and the …1113 sepay_parse_reference_code body;
--   DROP FUNCTION IF EXISTS public.fnb_settle_bank_paid(uuid, uuid);
--   DROP INDEX IF EXISTS public.idx_payment_settlements_fnb_order;
--   ALTER TABLE public.payment_settlements DROP COLUMN IF EXISTS fnb_order_id;
-- ===========================================================================================
