-- F&B module (FNB-P0-fix gate …0011) — FINANCE/REPORT recognized by EVENT-TIME, not a status snapshot.
-- DEPENDS ON 000004 (fnb_get_report, live) + 000006 (get_club_finance_summary = the byte-faithful live
-- clone + F&B hooks, live). SOURCE-ONLY. Apply in a controlled session (Management API / db query
-- --file), owner-gated, AFTER review + the golden-diff proof. NOT db push / not deploy_db.
-- schema_migrations untouched. Number 20261111000011 is FREE on origin/main.
--
-- WHY (owner P0 review 2026-06-29 — P0-1, a real LIVE accounting bug): BOTH fnb_get_report and
-- get_club_finance_summary recognized F&B revenue with `status='paid'`. But fnb_mark_shipped flips
-- order.status → 'shipped' once all lines ship, so a COMPLETED (shipped) sale — the normal happy path —
-- DROPPED OUT of revenue AND COGS. This rewrites recognition to EVENT-TIME accrual.
--
-- THE MODEL (both functions):
--   SALE   recognized at paid_at      → +subtotal_vnd, +cogs_vnd  (counts whether the order is later
--                                        'paid' OR 'shipped'); bucketed by paid_at.
--   REFUND recognized at cancelled_at (status='cancelled', paid_at IS NOT NULL)
--          → -subtotal_vnd, and -cogs_vnd ONLY if shipped_at IS NULL (a paid-not-shipped cancel was
--            restocked) else 0 (a shipped-cancel refunds money but the goods are consumed → COGS stays);
--            bucketed by cancelled_at.
--   Behavior: paid→shipped counts; paid→cancel-before-ship nets to 0 + stock restored; shipped→refund =
--   revenue 0 but COGS stays (real loss); a later-month refund never distorts the earlier sale month.
--
-- WHAT CHANGED — get_club_finance_summary: ONLY the `fnb_rows` CTE is rewritten (paid-snapshot →
--   sale@paid_at UNION refund@cancelled_at). Everything downstream (rev_all, revenue.fnb, cost.fnbCogs,
--   net, trend, perClub) already reads fnb_rows, so it flows through unchanged. The per-club
--   fnb_settings JOIN (coalesce(fnb_in_club_net,false)) is kept inside BOTH legs.
-- WHAT CHANGED — fnb_get_report: revenue/cogs/grossProfit/dailyTrend/topItems use the SAME event-time
--   recognition; topItems NETS pre-ship refund lines so it can't drift from the totals; orderCount =
--   paid orders in range; statusCounts (ops snapshot) + lowStock (current inventory) unchanged.
--
-- GOLDEN-DIFF GATE (unchanged bar): with every club's fnb_in_club_net=false (the default), BOTH legs of
-- fnb_rows are EMPTY → output byte-identical to the CURRENT live get_club_finance_summary EXCEPT the two
-- additive zero keys revenue.fnb=0 + cost.fnbCogs=0. Prove OLD (current live) vs NEW (this) on a real
-- club/range; PASS only if the ONLY delta is +fnb:0 / +fnbCogs:0. (No club has opted in + no real F&B
-- orders exist yet, so it is trivially satisfied today; the event-time logic only bites post-UAT.)

CREATE OR REPLACE FUNCTION public.get_club_finance_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_super boolean := false;
  v_all_ids uuid[];     -- full accessible set (for the clubs dropdown)
  v_club_ids uuid[];    -- aggregation scope (after the optional p_club_id filter)
  v_archive_default constant numeric := 199000;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- KEEP the live super_admin check verbatim (user_roles, NOT has_role) — changing the auth logic
  -- in the finance RPC is a behaviour change. Only F&B is added below.
  select exists (
    select 1 from public.user_roles ur where ur.user_id = v_uid and ur.role = 'super_admin'
  ) into v_super;

  if v_super then
    select coalesce(array_agg(id), '{}') into v_all_ids from public.clubs;
  else
    select coalesce(array_agg(id), '{}') into v_all_ids from public.clubs where owner_id = v_uid;
  end if;

  if p_club_id is not null then
    if not (p_club_id = any(v_all_ids)) then
      raise exception 'forbidden' using errcode = '42501';
    end if;
    v_club_ids := array[p_club_id];
  else
    v_club_ids := v_all_ids;
  end if;

  if v_all_ids is null or array_length(v_all_ids, 1) is null then
    return jsonb_build_object(
      'revenue', jsonb_build_object(
        'stakingFees',0,'stakingFixed',0,'stakingPercent',0,'stakingArchive',0,'payoutFees',0,
        'rake',0,'rakeActual',0,'rakeExpected',0,'rakeVariance',0,
        'rakeOnline',0,'rakeOffline',0,'rakeReentry',0,'serviceFee',0,'fnb',0,'total',0),  -- (5) +fnb
      'cost', jsonb_build_object('payrollNet',0,'payrollGross',0,'adjustments',0,'fnbCogs',0),  -- (5) +fnbCogs
      'net', 0, 'statusTotals', '{}'::jsonb, 'unpaidTotal', 0, 'reconciledTotal', 0,
      'aging', jsonb_build_object('d0_30',0,'d31_60',0,'d61_90',0,'d90p',0),
      'trend', '[]'::jsonb, 'perPeriod', '[]'::jsonb, 'perClub', '[]'::jsonb, 'clubs', '[]'::jsonb
    );
  end if;

  with
  acc_clubs as (
    select id, name from public.clubs where id = any(v_all_ids)
  ),
  fee_rows as (
    select d.club_id, to_char(d.created_at, 'YYYY-MM') as ym,
      ( case when d.player_checked_in and coalesce(d.platform_fixed_fee,0) > 0 then coalesce(d.platform_fixed_fee,0) else 0 end ) as fixed_fee,
      ( case when d.player_checked_in and coalesce(d.platform_percent_fee,0) > 0 then coalesce(d.platform_percent_fee,0) else 0 end ) as percent_fee,
      ( case when d.status = 'completed' and coalesce(d.result_prize_vnd,0) > 0
             then least(coalesce(d.platform_archive_fee, v_archive_default), coalesce(d.result_prize_vnd,0)) else 0 end ) as archive_fee
    from public.staking_deals d
    where d.club_id = any(v_club_ids) and d.created_at between p_from and p_to
  ),
  payout_rows as (
    select d.club_id, to_char(pr.created_at, 'YYYY-MM') as ym, coalesce(pr.platform_fee_vnd,0) as fee
    from public.payout_recipients pr
    join public.staking_deals d on d.id = pr.deal_id
    where d.club_id = any(v_club_ids) and pr.created_at between p_from and p_to
  ),
  -- Tournament rake + service fee are BOTH configured per tour (single fixed values set at setup,
  -- identical online & offline). Revenue = amount × paying confirmed entries, split by source via
  -- reference_code prefix. Free-rake slots are consumed by ONLINE entries (rake only — service fee
  -- is always charged). rake_actual (Σ total_pay − buy_in − service_fee) is RAKE-ONLY reconciliation.
  reg_src as (
    select t.id as tour_id, t.club_id, to_char(t.created_at, 'YYYY-MM') as ym,
           coalesce(t.rake_amount,0) as rake_amount,
           coalesce(t.service_fee_amount,0) as service_fee_amount,
           case when t.free_rake_enabled then coalesce(t.free_rake_used,0) else 0 end as free_used,
           case
             when tr.reference_code like 'REENTRY-%' then 'reentry'
             when tr.reference_code like 'CASH-%'    then 'offline'
             else 'online'
           end as src,
           greatest(0, coalesce(tr.total_pay,0) - coalesce(tr.buy_in,0) - coalesce(t.service_fee_amount,0)) as rake_actual
    from public.tournament_registrations tr
    join public.tournaments t on t.id = tr.tournament_id
    where tr.status = 'confirmed'
      and t.club_id = any(v_club_ids)
      and t.created_at between p_from and p_to
  ),
  tour_src as (
    select tour_id, club_id, ym, rake_amount, service_fee_amount, free_used,
      count(*) filter (where src = 'online')  as n_online,
      count(*) filter (where src = 'offline') as n_offline,
      count(*) filter (where src = 'reentry') as n_reentry,
      coalesce(sum(rake_actual),0)            as actual_sum
    from reg_src
    group by tour_id, club_id, ym, rake_amount, service_fee_amount, free_used
  ),
  rake_cfg as (
    select club_id, ym,
      rake_amount * greatest(0, n_online - free_used) as cfg_online,   -- free-rake applies to online
      rake_amount * n_offline                          as cfg_offline,
      rake_amount * n_reentry                          as cfg_reentry,
      service_fee_amount * (n_online + n_offline + n_reentry) as cfg_service,  -- service fee on every paying entry
      actual_sum
    from tour_src
  ),
  -- (P0-1 fix) F&B recognized by EVENT-TIME (flag-gated PER CLUB — NO global bool_or). SALE at paid_at
  --     (counts even after the order flips to 'shipped'); REFUND at cancelled_at (revenue reverses; COGS
  --     reverses ONLY if never shipped). The fnb_settings JOIN means a not-opted-in club yields ZERO rows,
  --     so with every flag off BOTH legs are empty → byte-identical to the live body except fnb=0/fnbCogs=0.
  fnb_rows as (
    select o.club_id, to_char(o.paid_at, 'YYYY-MM') as ym,
           o.subtotal_vnd::numeric as revenue, o.cogs_vnd::numeric as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.paid_at is not null
      and o.paid_at between p_from and p_to
    union all
    select o.club_id, to_char(o.cancelled_at, 'YYYY-MM') as ym,
           -o.subtotal_vnd::numeric as revenue,
           case when o.shipped_at is null then -o.cogs_vnd::numeric else 0 end as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.status = 'cancelled' and o.paid_at is not null
      and o.cancelled_at between p_from and p_to
  ),
  -- Total/trend/perClub revenue uses CONFIGURED rake + service fee (+ F&B revenue via fnb_rows).
  rev_all as (
    select club_id, ym, (fixed_fee + percent_fee + archive_fee) as fee from fee_rows
    union all select club_id, ym, fee from payout_rows
    union all select club_id, ym, (cfg_online + cfg_offline + cfg_reentry + cfg_service) as fee from rake_cfg
    union all select club_id, ym, revenue as fee from fnb_rows   -- (2) F&B revenue into the total
  ),
  period_agg as (
    select pp.id as period_id, pp.club_id, pp.period_year, pp.period_month, pp.period_end,
      pp.status as period_status, pp.locked_at, pp.approved_at, pp.submitted_at,
      coalesce(sum(dp.net_pay_vnd)   filter (where coalesce(dp.status,'') <> 'excluded'), 0) as net,
      coalesce(sum(dp.gross_pay_vnd) filter (where coalesce(dp.status,'') <> 'excluded'), 0) as gross,
      coalesce(sum(dp.total_adjustments_vnd) filter (where coalesce(dp.status,'') <> 'excluded'), 0) as adj
    from public.payroll_periods pp
    left join public.dealer_payroll dp on dp.period_id = pp.id
    where pp.club_id = any(v_club_ids)
      and pp.period_start <= p_to::date and pp.period_end >= p_from::date
    group by pp.id, pp.club_id, pp.period_year, pp.period_month, pp.period_end,
             pp.status, pp.locked_at, pp.approved_at, pp.submitted_at
  ),
  pay as (
    select distinct on (pr.period_id) pr.period_id, pr.status as pay_status,
      pr.paid_at, pr.reconciled_at, pr.prepared_at
    from public.payment_records pr
    where pr.club_id = any(v_club_ids)
    order by pr.period_id, pr.created_at desc
  ),
  period_eff as (
    select pa.period_id, pa.club_id, pa.period_year, pa.period_month, pa.net, pa.gross, pa.adj,
      case
        when py.reconciled_at is not null or py.pay_status = 'reconciled' then 'reconciled'
        when py.paid_at is not null or py.pay_status = 'paid' then 'paid'
        when py.prepared_at is not null or py.pay_status in ('prepared','payment_prepared') then 'payment_prepared'
        when lower(coalesce(pa.period_status,'')) in
             ('draft','submitted','approved','locked','rejected','payment_prepared','paid','reconciled')
          then lower(pa.period_status)
        else 'other'
      end as eff_status,
      coalesce(py.prepared_at, pa.locked_at, pa.approved_at, pa.submitted_at, pa.period_end::timestamptz) as unpaid_anchor
    from period_agg pa
    left join pay py on py.period_id = pa.period_id
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'stakingFees',    (select coalesce(sum(fixed_fee + percent_fee + archive_fee),0) from fee_rows),
      'stakingFixed',   (select coalesce(sum(fixed_fee),0)   from fee_rows),
      'stakingPercent', (select coalesce(sum(percent_fee),0) from fee_rows),
      'stakingArchive', (select coalesce(sum(archive_fee),0) from fee_rows),
      'payoutFees',     (select coalesce(sum(fee),0) from payout_rows),
      -- headline = CONFIGURED rake (rake_amount × paying entries; free-rake on online)
      'rake',           (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeActual',     (select coalesce(sum(actual_sum),0) from rake_cfg),   -- rake-only reconciliation (Σ total_pay − buy_in − service_fee)
      'rakeExpected',   (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeVariance',   (select coalesce(sum(actual_sum),0) from rake_cfg)
                        - (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeOnline',     (select coalesce(sum(cfg_online),0)  from rake_cfg),
      'rakeOffline',    (select coalesce(sum(cfg_offline),0) from rake_cfg),
      'rakeReentry',    (select coalesce(sum(cfg_reentry),0) from rake_cfg),
      'serviceFee',     (select coalesce(sum(cfg_service),0) from rake_cfg),  -- configured service fee × paying entries
      'fnb',            (select coalesce(sum(revenue),0) from fnb_rows),       -- (2) F&B paid revenue (opted-in clubs only)
      'total',          (select coalesce(sum(fee),0) from rev_all)            -- includes F&B via rev_all union
    ),
    'cost', jsonb_build_object(
      'payrollNet',   (select coalesce(sum(net),0)   from period_eff),
      'payrollGross', (select coalesce(sum(gross),0) from period_eff),
      'adjustments',  (select coalesce(sum(adj),0)   from period_eff),
      'fnbCogs',      (select coalesce(sum(cogs),0)  from fnb_rows)            -- (3) F&B cost of goods sold (opted-in clubs only)
    ),
    -- (3) F&B revenue is already in rev_all → already in net; subtract its COGS once → net gets (rev − cogs).
    'net', (select coalesce(sum(fee),0) from rev_all)
           - (select coalesce(sum(net),0) from period_eff)
           - (select coalesce(sum(cogs),0) from fnb_rows),
    'statusTotals', (
      select coalesce(jsonb_object_agg(eff_status, total), '{}'::jsonb)
      from (select eff_status, sum(net) as total from period_eff group by eff_status) s
    ),
    'unpaidTotal', (select coalesce(sum(net),0) from period_eff
                    where eff_status in ('submitted','approved','locked','payment_prepared')),
    'reconciledTotal', (select coalesce(sum(net),0) from period_eff where eff_status = 'reconciled'),
    'aging', (
      select jsonb_build_object(
        'd0_30',  coalesce(sum(net) filter (where days <= 30), 0),
        'd31_60', coalesce(sum(net) filter (where days > 30 and days <= 60), 0),
        'd61_90', coalesce(sum(net) filter (where days > 60 and days <= 90), 0),
        'd90p',   coalesce(sum(net) filter (where days > 90), 0)
      )
      from (
        select net, greatest(0, floor(extract(epoch from (now() - unpaid_anchor)) / 86400))::int as days
        from period_eff
        where eff_status in ('submitted','approved','locked','payment_prepared')
      ) a
    ),
    'trend', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'key', to_char(to_date(ym, 'YYYY-MM'), 'MM/YY'), 'revenue', rev_v, 'cost', cost_v
      ) order by ym), '[]'::jsonb)
      from (
        select m.ym,
          coalesce((select sum(fee) from rev_all r where r.ym = m.ym), 0) as rev_v,   -- rev_v already includes F&B (rev_all)
          coalesce((select sum(net) from period_eff pe
                    where to_char(make_date(pe.period_year, pe.period_month, 1), 'YYYY-MM') = m.ym), 0)
            + coalesce((select sum(cogs) from fnb_rows f where f.ym = m.ym), 0) as cost_v  -- (4) + F&B COGS
        from (
          select ym from rev_all
          union
          select to_char(make_date(period_year, period_month, 1), 'YYYY-MM') as ym from period_eff
          union
          select ym from fnb_rows                                              -- (4) F&B months into the spine
        ) m
      ) t
    ),
    'perPeriod', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'id', pe.period_id, 'clubId', pe.club_id,
        'clubName', coalesce((select name from acc_clubs ac where ac.id = pe.club_id), '—'),
        'periodKey', lpad(pe.period_month::text, 2, '0') || '/' || pe.period_year::text,
        'gross', pe.gross, 'net', pe.net, 'status', pe.eff_status
      ) order by pe.period_year desc, pe.period_month desc), '[]'::jsonb)
      from period_eff pe
    ),
    'perClub', (
      select coalesce(jsonb_agg(jsonb_build_object(
        'clubId', cid, 'name', cname, 'revenue', rev_v, 'cost', cost_v, 'net', rev_v - cost_v
      ) order by (rev_v - cost_v) desc), '[]'::jsonb)
      from (
        select ac.id as cid, ac.name as cname,
          coalesce((select sum(fee) from rev_all r where r.club_id = ac.id), 0) as rev_v,   -- includes F&B (rev_all)
          coalesce((select sum(net) from period_eff pe where pe.club_id = ac.id), 0)
            + coalesce((select sum(cogs) from fnb_rows f where f.club_id = ac.id), 0) as cost_v  -- (4) + F&B COGS
        from acc_clubs ac
        where ac.id = any(v_club_ids)
      ) pc
      where rev_v <> 0 or cost_v <> 0
    ),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) from acc_clubs)
  ) into v_result;

  return v_result;
end;
$function$;

-- Re-assert the live security posture (CREATE OR REPLACE preserves grants; this is idempotent and
-- only touches PUBLIC/anon (revoke) + authenticated (grant), matching the original 20260826000000).
revoke all on function public.get_club_finance_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_club_finance_summary(timestamptz, timestamptz, uuid) to authenticated;

-- ===========================================================================================
-- fnb_get_report — (P0-1 fix) event-time recognition for every money facet. STABLE/read-only; SAME
-- scope (fnb_club_ids) + authz as 000004. Reproduced in full with ONLY the recognition changed.
-- ===========================================================================================
CREATE OR REPLACE FUNCTION public.fnb_get_report(
  p_from    timestamptz,
  p_to      timestamptz,
  p_club_id uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE plpgsql
STABLE
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_uid     uuid := auth.uid();
  v_all_ids uuid[];
  v_scope   uuid[];
  v_result  jsonb;
BEGIN
  IF v_uid IS NULL THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;

  SELECT COALESCE(array_agg(x), '{}') INTO v_all_ids FROM public.fnb_club_ids(v_uid) x;

  IF p_club_id IS NOT NULL THEN
    IF NOT (p_club_id = ANY(v_all_ids)) THEN RAISE EXCEPTION 'forbidden' USING ERRCODE = '42501'; END IF;
    v_scope := ARRAY[p_club_id];
  ELSE
    v_scope := v_all_ids;
  END IF;

  WITH
  -- SALE recognized at paid_at (counts even after status flips to 'shipped').
  sale AS (
    SELECT o.id, o.subtotal_vnd::numeric AS revenue, o.cogs_vnd::numeric AS cogs, o.paid_at AS recog_at
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND o.paid_at IS NOT NULL AND o.paid_at BETWEEN p_from AND p_to
  ),
  -- REFUND recognized at cancelled_at; COGS reverses ONLY if never shipped.
  refund AS (
    SELECT o.id, -o.subtotal_vnd::numeric AS revenue,
           CASE WHEN o.shipped_at IS NULL THEN -o.cogs_vnd::numeric ELSE 0 END AS cogs,
           o.cancelled_at AS recog_at
    FROM public.fnb_orders o
    WHERE o.club_id = ANY(v_scope) AND o.status = 'cancelled' AND o.paid_at IS NOT NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
  ),
  recog AS (
    SELECT id, revenue, cogs, recog_at FROM sale
    UNION ALL
    SELECT id, revenue, cogs, recog_at FROM refund
  ),
  -- topItems: sale lines (paid_at in range) NET pre-ship refund lines (cancelled_at in range), so the
  -- per-item revenue can't drift from the recognized total.
  item_recog AS (
    SELECT oi.menu_item_id, oi.name_snapshot,
           oi.qty::numeric AS qty, (oi.unit_price_snapshot * oi.qty)::numeric AS revenue
    FROM public.fnb_order_items oi
    JOIN sale s ON s.id = oi.order_id
    UNION ALL
    SELECT oi.menu_item_id, oi.name_snapshot,
           -oi.qty::numeric AS qty, -(oi.unit_price_snapshot * oi.qty)::numeric AS revenue
    FROM public.fnb_order_items oi
    JOIN public.fnb_orders o ON o.id = oi.order_id
    WHERE o.club_id = ANY(v_scope) AND o.status = 'cancelled' AND o.paid_at IS NOT NULL AND o.shipped_at IS NULL
      AND o.cancelled_at BETWEEN p_from AND p_to
  ),
  itms AS (
    SELECT menu_item_id, name_snapshot, SUM(qty) AS qty, SUM(revenue) AS revenue
    FROM item_recog GROUP BY menu_item_id, name_snapshot
  ),
  status_rows AS (
    SELECT status::text AS status, COUNT(*) AS cnt
    FROM public.fnb_orders
    WHERE club_id = ANY(v_scope) AND created_at BETWEEN p_from AND p_to
    GROUP BY status
  ),
  low AS (
    SELECT id, name, on_hand, low_stock_threshold, stock_unit
    FROM public.fnb_ingredients
    WHERE club_id = ANY(v_scope) AND is_active AND on_hand <= low_stock_threshold
  ),
  daily AS (
    SELECT to_char(recog_at, 'YYYY-MM-DD') AS d, SUM(revenue) AS revenue, SUM(cogs) AS cogs
    FROM recog GROUP BY to_char(recog_at, 'YYYY-MM-DD')
  )
  SELECT jsonb_build_object(
    'revenue',     (SELECT COALESCE(SUM(revenue), 0) FROM recog),
    'cogs',        (SELECT COALESCE(SUM(cogs), 0) FROM recog),
    'grossProfit', (SELECT COALESCE(SUM(revenue), 0) - COALESCE(SUM(cogs), 0) FROM recog),
    'orderCount',  (SELECT COUNT(*) FROM sale),
    'statusCounts',(SELECT COALESCE(jsonb_object_agg(status, cnt), '{}'::jsonb) FROM status_rows),
    'topItems',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'menuItemId', menu_item_id, 'name', name_snapshot, 'qty', qty, 'revenue', revenue)
                       ORDER BY revenue DESC), '[]'::jsonb)
                    FROM (SELECT * FROM itms WHERE qty <> 0 OR revenue <> 0 ORDER BY revenue DESC LIMIT 10) t),
    'lowStock',    (SELECT COALESCE(jsonb_agg(jsonb_build_object(
                       'ingredientId', id, 'name', name, 'onHand', on_hand,
                       'threshold', low_stock_threshold, 'unit', stock_unit)
                       ORDER BY (on_hand - low_stock_threshold)), '[]'::jsonb)
                    FROM low),
    'dailyTrend',  (SELECT COALESCE(jsonb_agg(jsonb_build_object('date', d, 'revenue', revenue, 'cogs', cogs)
                       ORDER BY d), '[]'::jsonb)
                    FROM daily)
  ) INTO v_result;

  RETURN v_result;
END;
$$;

revoke all on function public.fnb_get_report(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.fnb_get_report(timestamptz, timestamptz, uuid) to authenticated;

-- ===========================================================================================
-- GOLDEN-DIFF PROOF — get_club_finance_summary (run in a tx you ROLLBACK; flags all OFF):
--   -- BEFORE (current live) vs AFTER (this), same club/range:
--   --   select public.get_club_finance_summary('2026-01-01','2026-12-31','<club>');   -> OLD / NEW
--   --   with o as (select '<OLD jsonb>'::jsonb j), n as (select '<NEW jsonb>'::jsonb j)
--   --   select n.j #> '{revenue,fnb}' as fnb, n.j #> '{cost,fnbCogs}' as fnbcogs,
--   --          (o.j #- '{revenue,fnb}' #- '{cost,fnbCogs}') = (n.j #- '{revenue,fnb}' #- '{cost,fnbCogs}') as identical
--   --   from o, n;   -- EXPECT fnb=0, fnbcogs=0, identical=true
--
-- EVENT-TIME SCENARIO (fixture club opted-in: fnb_settings.fnb_in_club_net=true; 3 cross-month cases):
--   (1) paid→shipped in month A           → month A keeps revenue + COGS (the bug: previously vanished).
--   (2) paid→cancel-before-ship in month A → month A nets to 0 (sale +, refund −) + stock restored.
--   (3) paid in month A, cancel in month B → A unchanged; B carries the negative refund row
--       (revenue −subtotal; COGS −cogs only if not shipped, else 0). fnb_get_report over each window
--       shows the same; topItems nets pre-ship refunds so it never drifts from the revenue total.
-- ===========================================================================================
--
-- ROLLBACK:
--   get_club_finance_summary → re-apply ../../../live_finance_rpc.sql (exact pre-F&B live body) OR the
--                              000006 body (this file's base) to restore the paid-snapshot recognition.
--   fnb_get_report           → re-apply the 000004 fnb_get_report body (paid-snapshot).
