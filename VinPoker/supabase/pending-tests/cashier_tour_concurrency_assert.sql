\set ON_ERROR_STOP on
DO $test$
DECLARE v_cash_id uuid; v_bank_id uuid;
BEGIN
  SELECT id INTO v_cash_id FROM public.tournament_registrations
    WHERE player_id='b1000000-0000-4000-8000-000000000002';
  SELECT id INTO v_bank_id FROM public.tournament_registrations
    WHERE player_id='b1000000-0000-4000-8000-000000000003';
  IF (SELECT count(*) FROM public.cashier_buyin_movements
      WHERE registration_id=v_cash_id AND purpose='buyin')<>1
    OR (SELECT coalesce(sum(applied_amount),0) FROM public.cashier_buyin_movements
      WHERE registration_id=v_cash_id AND purpose='buyin')<>6600000
    OR (SELECT cashier_paid_at IS NULL FROM public.tournament_registrations WHERE id=v_cash_id)
    OR (SELECT status<>'pending' FROM public.tournament_registrations WHERE id=v_cash_id)
    OR (SELECT count(*) FROM public.cashier_buyin_movements
      WHERE registration_id=v_bank_id AND purpose='buyin')<>1
    OR (SELECT coalesce(sum(applied_amount),0) FROM public.cashier_buyin_movements
      WHERE registration_id=v_bank_id AND purpose='buyin')<>6600000
    OR (SELECT cashier_paid_at IS NULL OR status<>'pending'
      FROM public.tournament_registrations WHERE id=v_bank_id)
    OR (SELECT status<>'matched' FROM public.bank_transactions
      WHERE id='b5000000-0000-4000-8000-000000000001') THEN
    RAISE EXCEPTION 'cashier same-key or SePay replay recorded duplicate or lost money';
  END IF;
END $test$;
