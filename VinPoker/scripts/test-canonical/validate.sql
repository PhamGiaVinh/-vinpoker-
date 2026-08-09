WITH club_metrics AS (
  SELECT
    c.id AS club_id,
    c.name AS club_name,
    (SELECT count(*) FROM public.tournament_registrations r WHERE r.club_id = c.id) AS registrations,
    (SELECT count(DISTINCT r.player_id) FROM public.tournament_registrations r WHERE r.club_id = c.id AND r.status = 'confirmed') AS attendance,
    (SELECT count(*) FROM public.tournament_registrations r WHERE r.club_id = c.id AND r.status = 'confirmed') AS entries,
    (SELECT count(*) FROM public.dealers d WHERE d.club_id = c.id AND d.deleted_at IS NULL) AS staff,
    (SELECT coalesce(sum(t.rake_amount), 0) FROM public.tournament_registrations r JOIN public.tournaments t ON t.id = r.tournament_id WHERE r.club_id = c.id AND r.status = 'confirmed' AND NOT r.used_free_rake) AS rake_retained_vnd,
    (SELECT coalesce(sum(o.subtotal_vnd), 0) FROM public.fnb_orders o WHERE o.club_id = c.id AND o.status IN ('paid', 'shipped') AND NOT o.is_comp) AS fnb_net_revenue_vnd,
    (SELECT coalesce(sum(cr.prize_total), 0) FROM public.tournament_close_report cr WHERE cr.club_id = c.id)
      - (SELECT coalesce(sum(p.prize_amount), 0) FROM public.tournament_prize_payments p WHERE p.club_id = c.id AND p.status = 'paid') AS pending_liabilities_vnd,
    (SELECT coalesce(sum(dp.net_pay_after_tax_vnd), 0) FROM public.dealer_payroll dp JOIN public.payroll_periods pp ON pp.id = dp.period_id WHERE dp.club_id = c.id AND pp.status = 'draft' AND dp.status = 'pending') AS payroll_provisional_vnd
  FROM public.clubs c
  WHERE c.name IN ('TEST_CLUB_A', 'TEST_CLUB_B')
), expected AS (
  SELECT * FROM (VALUES
    ('TEST_CLUB_A'::text, 12::bigint, 12::bigint, 12::bigint, 2::bigint, 1200000::numeric, 300000::numeric, 3000000::numeric, 1500000::numeric),
    ('TEST_CLUB_B'::text,  5::bigint,  5::bigint,  5::bigint, 1::bigint,  250000::numeric, 125000::numeric,  500000::numeric,  700000::numeric)
  ) AS x(club_name, registrations, attendance, entries, staff, rake_retained_vnd, fnb_net_revenue_vnd, pending_liabilities_vnd, payroll_provisional_vnd)
), compared AS (
  SELECT m.*, (m.registrations = e.registrations
    AND m.attendance = e.attendance
    AND m.entries = e.entries
    AND m.staff = e.staff
    AND m.rake_retained_vnd = e.rake_retained_vnd
    AND m.fnb_net_revenue_vnd = e.fnb_net_revenue_vnd
    AND m.pending_liabilities_vnd = e.pending_liabilities_vnd
    AND m.payroll_provisional_vnd = e.payroll_provisional_vnd) AS matches_expected
  FROM club_metrics m JOIN expected e USING (club_name)
)
SELECT * FROM compared ORDER BY club_name;

DO $$
DECLARE v_bad integer; v_count integer;
BEGIN
  WITH metrics AS (
    SELECT c.name,
      (SELECT count(*) FROM public.tournament_registrations r WHERE r.club_id = c.id) registrations
    FROM public.clubs c WHERE c.name IN ('TEST_CLUB_A','TEST_CLUB_B')
  )
  SELECT count(*) INTO v_bad FROM metrics
  WHERE (name = 'TEST_CLUB_A' AND registrations <> 12)
     OR (name = 'TEST_CLUB_B' AND registrations <> 5);
  SELECT count(*) INTO v_count FROM public.clubs WHERE name IN ('TEST_CLUB_A','TEST_CLUB_B');
  IF v_bad <> 0 OR v_count <> 2 THEN
    RAISE EXCEPTION 'VINPOKER_TEST tenant fixture validation failed';
  END IF;
END $$;

DO $$
DECLARE
  v_bad integer;
  v_rls_missing integer;
  v_policy_missing integer;
BEGIN
  SELECT count(*) INTO v_bad
  FROM public.tournament_registrations r
  JOIN public.tournaments t ON t.id = r.tournament_id
  WHERE r.club_id <> t.club_id
     OR (r.club_id = '10000000-0000-4000-8000-000000000001'::uuid AND t.club_id <> '10000000-0000-4000-8000-000000000001'::uuid)
     OR (r.club_id = '10000000-0000-4000-8000-000000000002'::uuid AND t.club_id <> '10000000-0000-4000-8000-000000000002'::uuid);
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'VINPOKER_TEST cross-club tournament fixture contamination detected';
  END IF;

  SELECT count(*) INTO v_bad
  FROM public.clubs c
  LEFT JOIN public.club_members m
    ON m.club_id = c.id AND m.player_user_id = c.owner_id
  WHERE c.name IN ('TEST_CLUB_A', 'TEST_CLUB_B') AND m.id IS NULL;
  IF v_bad <> 0 THEN
    RAISE EXCEPTION 'VINPOKER_TEST owner membership fixture missing';
  END IF;

  SELECT count(*) INTO v_rls_missing
  FROM pg_class c
  JOIN pg_namespace n ON n.oid = c.relnamespace
  WHERE n.nspname = 'public'
    AND c.relname = ANY (ARRAY[
      'clubs', 'club_members', 'tournament_registrations', 'fnb_orders',
      'dealers', 'dealer_payroll', 'payroll_periods',
      'tournament_close_report', 'tournament_prize_payments'
    ])
    AND NOT c.relrowsecurity;
  IF v_rls_missing <> 0 THEN
    RAISE EXCEPTION 'VINPOKER_TEST expected RLS is not enabled on % digest relations', v_rls_missing;
  END IF;

  SELECT count(*) INTO v_policy_missing
  FROM unnest(ARRAY[
    'clubs', 'club_members', 'tournament_registrations', 'fnb_orders',
    'dealers', 'dealer_payroll', 'payroll_periods',
    'tournament_close_report', 'tournament_prize_payments'
  ]) AS expected(tablename)
  WHERE NOT EXISTS (
    SELECT 1 FROM pg_policies p
    WHERE p.schemaname = 'public' AND p.tablename = expected.tablename
  );
  IF v_policy_missing <> 0 THEN
    RAISE EXCEPTION 'VINPOKER_TEST expected RLS policy is missing on % digest relations', v_policy_missing;
  END IF;
END $$;
