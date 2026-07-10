-- ============================================================================================
-- PR-E3 (Bước A / Sổ chi phí): fold club_expenses into get_club_finance_summary. SOURCE-ONLY:
-- NOT applied on merge — apply is a SEPARATE owner-gated controlled op preceded by a BEFORE/AFTER
-- GOLDEN-DIFF (same [p_from,p_to], before vs after) on a ZERO-expense month. NO `supabase db push`,
-- NO deploy_db, NO schema_migrations edit here.
--
-- WHY: club_expenses (rent/utilities/marketing/supplies/…) is a real operating cost the Owner
-- Finance Dashboard must recognise; today it is absent from the P&L. This adds it as ONE new cost
-- leg, exactly parallel to the existing [PT] pt_pay leg — additive, minimal, reversible.
--
-- BASE OF THIS BODY: the canonical live body from 20261211000000_finance_summary_pt_wage_restore.sql
-- (the [PT]-restored lineage), copied VERBATIM. CHANGES vs base (golden diff, marked [EXP]):
--   1. empty-state cost object          + 'clubExpenses',0
--   2. new CTE club_exp                 (public.club_expenses, signed amount_vnd, by incurred_at)
--   3. cost.clubExpenses                new itemized cost line
--   4. net                              − club_exp sum
--   5. trend.cost_v + month spine       + club_exp
--   6. perClub.cost_v                   + club_exp
-- Nothing else changes: staking/rake/service-fee/F&B/PT legs byte-identical to base.
--
-- GOLDEN-DIFF acceptance: for a month with NO club_expenses rows, club_exp is empty → `net` and
-- every pre-existing key are numerically identical; the ONLY delta is the additive
-- `cost.clubExpenses: 0` key. Months WITH expenses reduce `net` by exactly Σ amount_vnd (intended;
-- amount_vnd is signed so adjustment rows net out).
--
-- ROLLBACK: re-apply 20261211000000_finance_summary_pt_wage_restore.sql (the exact base body).
-- ============================================================================================

CREATE OR REPLACE FUNCTION public.get_club_finance_summary(p_from timestamp with time zone, p_to timestamp with time zone, p_club_id uuid DEFAULT NULL::uuid)
 RETURNS jsonb
 LANGUAGE plpgsql
 STABLE SECURITY DEFINER
 SET search_path TO 'public'
AS $function$
declare
  v_uid uuid := auth.uid();
  v_super boolean := false;
  v_all_ids uuid[];
  v_club_ids uuid[];
  v_archive_default constant numeric := 199000;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

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
        'rakeOnline',0,'rakeOffline',0,'rakeReentry',0,'serviceFee',0,'fnb',0,'total',0),
      'cost', jsonb_build_object(
        'payrollNet',0,'payrollGross',0,'adjustments',0,'ptWagePaid',0,'fnbCogs',0,'compCogs',0,'clubExpenses',0),  -- [C] +compCogs [PT] +ptWagePaid [EXP] +clubExpenses
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
      rake_amount * greatest(0, n_online - free_used) as cfg_online,
      rake_amount * n_offline                          as cfg_offline,
      rake_amount * n_reentry                          as cfg_reentry,
      service_fee_amount * (n_online + n_offline + n_reentry) as cfg_service,
      actual_sum
    from tour_src
  ),
  -- [C] fnb_rows: REGULAR paid sales only — comps excluded (NOT COALESCE(o.is_comp,false)).
  --     The same per-club fnb_settings JOIN as before.
  fnb_rows as (
    select o.club_id, to_char(o.paid_at, 'YYYY-MM') as ym,
           o.subtotal_vnd::numeric as revenue, o.cogs_vnd::numeric as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.paid_at is not null
      and o.paid_at between p_from and p_to
      and not coalesce(o.is_comp, false)    -- [C] exclude comps from the regular sales COGS
    union all
    select o.club_id, to_char(o.cancelled_at, 'YYYY-MM') as ym,
           -o.subtotal_vnd::numeric as revenue,
           case when o.shipped_at is null then -o.cogs_vnd::numeric else 0 end as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and o.status = 'cancelled' and o.paid_at is not null
      and o.cancelled_at between p_from and p_to
      and not coalesce(o.is_comp, false)    -- [C] exclude comp cancels (handled in fnb_rows_comp)
  ),
  -- [C] fnb_rows_comp: comp-order COGS only, event-time (rev=0 always; cogs=real ingredient cost).
  --     SALE at paid_at; CANCEL reverses COGS if not yet shipped (same rule as regular cancel).
  --     Same per-club gate (fnb_settings.fnb_in_club_net). EMPTY when flag off → golden-diff holds.
  fnb_rows_comp as (
    select o.club_id, to_char(o.paid_at, 'YYYY-MM') as ym,
           0::numeric as revenue, o.cogs_vnd::numeric as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and coalesce(o.is_comp, false)
      and o.paid_at is not null and o.paid_at between p_from and p_to
    union all
    select o.club_id, to_char(o.cancelled_at, 'YYYY-MM') as ym,
           0::numeric as revenue,
           case when o.shipped_at is null then -o.cogs_vnd::numeric else 0 end as cogs
    from public.fnb_orders o
    join public.fnb_settings s on s.club_id = o.club_id and coalesce(s.fnb_in_club_net, false)
    where o.club_id = any(v_club_ids) and coalesce(o.is_comp, false)
      and o.status = 'cancelled' and o.paid_at is not null
      and o.cancelled_at between p_from and p_to
  ),
  rev_all as (
    select club_id, ym, (fixed_fee + percent_fee + archive_fee) as fee from fee_rows
    union all select club_id, ym, fee from payout_rows
    union all select club_id, ym, (cfg_online + cfg_offline + cfg_reentry + cfg_service) as fee from rake_cfg
    union all select club_id, ym, revenue as fee from fnb_rows
    -- [C] fnb_rows_comp.revenue is 0 so omitting from rev_all is equivalent — cleaner.
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
  ),
  -- [PT] Option B (restored from 20261028000001 v4): PART-TIME wage payouts are real cash that does
  --      NOT flow through payment_records; summed into payroll cost on a CASH basis (by paid_at,
  --      non-voided). Dropped by the fnb finance rewrites (…000006/…000011/…000013) — restored here.
  pt_pay as (
    select w.club_id, to_char(w.paid_at, 'YYYY-MM') as ym, w.amount_vnd as amt
    from public.dealer_pt_wage_payments w
    where w.club_id = any(v_club_ids)
      and w.voided_at is null
      and w.paid_at between p_from and p_to
  ),
  -- [EXP] Club operating expenses (rent/utilities/marketing/…): real cash cost from the append-only
  --       club_expenses ledger. amount_vnd is SIGNED (adjustment rows net out). By incurred_at,
  --       between p_from and p_to — same closed-interval basis as pt_pay / fee_rows.
  club_exp as (
    select e.club_id, to_char(e.incurred_at, 'YYYY-MM') as ym, e.amount_vnd as amt
    from public.club_expenses e
    where e.club_id = any(v_club_ids)
      and e.incurred_at between p_from and p_to
  )
  select jsonb_build_object(
    'revenue', jsonb_build_object(
      'stakingFees',    (select coalesce(sum(fixed_fee + percent_fee + archive_fee),0) from fee_rows),
      'stakingFixed',   (select coalesce(sum(fixed_fee),0)   from fee_rows),
      'stakingPercent', (select coalesce(sum(percent_fee),0) from fee_rows),
      'stakingArchive', (select coalesce(sum(archive_fee),0) from fee_rows),
      'payoutFees',     (select coalesce(sum(fee),0) from payout_rows),
      'rake',           (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeActual',     (select coalesce(sum(actual_sum),0) from rake_cfg),
      'rakeExpected',   (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeVariance',   (select coalesce(sum(actual_sum),0) from rake_cfg)
                        - (select coalesce(sum(cfg_online + cfg_offline + cfg_reentry),0) from rake_cfg),
      'rakeOnline',     (select coalesce(sum(cfg_online),0)  from rake_cfg),
      'rakeOffline',    (select coalesce(sum(cfg_offline),0) from rake_cfg),
      'rakeReentry',    (select coalesce(sum(cfg_reentry),0) from rake_cfg),
      'serviceFee',     (select coalesce(sum(cfg_service),0) from rake_cfg),
      'fnb',            (select coalesce(sum(revenue),0) from fnb_rows),
      'total',          (select coalesce(sum(fee),0) from rev_all)
    ),
    'cost', jsonb_build_object(
      -- [PT] payrollNet INCLUDES PT payouts (Option B). ptWagePaid is the itemized PT sub-total
      --      (already inside payrollNet — do NOT add again in the client).
      'payrollNet',   (select coalesce(sum(net),0)   from period_eff) + (select coalesce(sum(amt),0) from pt_pay),
      'payrollGross', (select coalesce(sum(gross),0) from period_eff),
      'adjustments',  (select coalesce(sum(adj),0)   from period_eff),
      'ptWagePaid',   (select coalesce(sum(amt),0)   from pt_pay),
      'fnbCogs',      (select coalesce(sum(cogs),0)  from fnb_rows),           -- regular sales COGS only
      'compCogs',     (select coalesce(sum(cogs),0)  from fnb_rows_comp),        -- [C] comp COGS (separate line)
      'clubExpenses', (select coalesce(sum(amt),0)   from club_exp)              -- [EXP] operating expenses (rent/utilities/…)
    ),
    -- [C] net deducts BOTH regular COGS and comp COGS (owner decision: comp is a real cost).
    -- [PT] and deducts PT wage payouts (restored).
    'net', (select coalesce(sum(fee),0) from rev_all)
           - (select coalesce(sum(net),0) from period_eff)
           - (select coalesce(sum(amt),0) from pt_pay)
           - (select coalesce(sum(cogs),0) from fnb_rows)
           - (select coalesce(sum(cogs),0) from fnb_rows_comp)
           - (select coalesce(sum(amt),0) from club_exp),   -- [EXP] deduct operating expenses
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
          coalesce((select sum(fee) from rev_all r where r.ym = m.ym), 0) as rev_v,
          -- [C] cost_v now includes both regular and comp COGS
          coalesce((select sum(net) from period_eff pe
                    where to_char(make_date(pe.period_year, pe.period_month, 1), 'YYYY-MM') = m.ym), 0)
            + coalesce((select sum(amt) from pt_pay pp where pp.ym = m.ym), 0)              -- [PT]
            + coalesce((select sum(cogs) from fnb_rows f where f.ym = m.ym), 0)
            + coalesce((select sum(cogs) from fnb_rows_comp fc where fc.ym = m.ym), 0)
            + coalesce((select sum(amt) from club_exp ce where ce.ym = m.ym), 0) as cost_v  -- [EXP]
        from (
          select ym from rev_all
          union select to_char(make_date(period_year, period_month, 1), 'YYYY-MM') as ym from period_eff
          union select ym from pt_pay           -- [PT] PT months into the spine
          union select ym from fnb_rows
          union select ym from fnb_rows_comp    -- [C] comp months into the spine
          union select ym from club_exp         -- [EXP] expense months into the spine
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
          coalesce((select sum(fee) from rev_all r where r.club_id = ac.id), 0) as rev_v,
          coalesce((select sum(net) from period_eff pe where pe.club_id = ac.id), 0)
            + coalesce((select sum(amt) from pt_pay pp where pp.club_id = ac.id), 0)                    -- [PT]
            + coalesce((select sum(cogs) from fnb_rows f where f.club_id = ac.id), 0)
            + coalesce((select sum(cogs) from fnb_rows_comp fc where fc.club_id = ac.id), 0)
            + coalesce((select sum(amt) from club_exp ce where ce.club_id = ac.id), 0) as cost_v        -- [EXP]
        from acc_clubs ac
        where ac.id = any(v_club_ids)
      ) pc
      where rev_v <> 0 or cost_v <> 0
    ),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) from acc_clubs)
  ) into v_result;

  return v_result;
end;
$function$
;

-- same grants as the live lineage (20261111000013)
revoke all on function public.get_club_finance_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_club_finance_summary(timestamptz, timestamptz, uuid) to authenticated;
