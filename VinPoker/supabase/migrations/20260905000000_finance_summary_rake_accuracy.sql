-- get_club_finance_summary v2 — RAKE ACCURACY + source split + staking sub-fees.
-- SOURCE-ONLY: NOT applied here. Apply is an owner-gated controlled op (Management API:
-- preflight pg_get_functiondef -> CREATE OR REPLACE -> verify body/grants/SECURITY DEFINER/
-- search_path -> idempotency rerun). NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
-- Supersedes the body in 20260826000000 (CREATE OR REPLACE, same signature). Read-only / STABLE /
-- zero writes. Never recomputes payroll. No registration/cashier/staking/payroll BEHAVIOR change.
--
-- WHAT CHANGED (reporting only):
--   * Tournament rake is now measured from the ACTUAL collected fee per confirmed registration:
--        rakeActual = SUM( GREATEST(0, tournament_registrations.total_pay - buy_in) )  WHERE status='confirmed'
--     Rationale: the ONLINE register edge fn (tournament-register) stores platform_fixed_fee = 0 and
--     puts the rake into total_pay (total_pay = buy_in + rake). Offline buy-in / re-entry store the fee
--     in platform_fixed_fee, but for them (total_pay - buy_in) == that fee too. So (total_pay - buy_in)
--     is the ONE definition that is correct across all three sources (summing platform_fixed_fee would
--     undercount every online entry to 0).
--   * rakeExpected = the previous estimate (tournaments.rake_amount × GREATEST(0, confirmed - free_rake_used)).
--   * rakeVariance = rakeActual - rakeExpected.
--   * Source split of rakeActual by reference_code prefix (deterministic from the writers):
--        online  = reference_code 'VINReg…' (NOT CASH-/REENTRY-)   [tournament-register edge fn]
--        offline = reference_code 'CASH-%'                          [create_offline_buyin_and_seat]
--        reentry = reference_code 'REENTRY-%'                       [reenter_tournament_player]
--   * Staking fees split into stakingFixed / stakingPercent / stakingArchive (was one lumped stakingFees).
--   * HEADLINE CHANGE: revenue.rake, revenue.total and net now use ACTUAL collected rake (real money in),
--     not the count×rake_amount estimate. Staking fees remain a SEPARATE stream (never mixed into rake).
--
-- Revenue streams (club-attributable), kept strictly separate:
--   TOURNAMENT  -> rake (actual; online+offline+reentry)            [tournament rake]
--   STAKING     -> stakingFixed + stakingPercent + stakingArchive   [staking service/txn/archive fees]
--               -> payoutFees                                       [staking payout / ITM / cash-out fee]
-- EXCLUDED from revenue/net: tournament buy-in (prize-pool pass-through), staking capital/escrow,
--   cashier cash, bankroll_entries.rake, F&B. Cost = SAVED dealer payroll (never recomputed).
--
-- ROLLBACK: CREATE OR REPLACE the function back to the 20260826000000 body (prior count-based `rake`,
--   no rakeActual/Expected/Variance/Online/Offline/Reentry/stakingFixed/Percent/Archive fields). The
--   useClubFinanceSummary hook tolerates missing fields (treats them as 0) so a rollback is safe.

create or replace function public.get_club_finance_summary(
  p_from timestamptz,
  p_to timestamptz,
  p_club_id uuid default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
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
        'rakeOnline',0,'rakeOffline',0,'rakeReentry',0,'total',0),
      'cost', jsonb_build_object('payrollNet',0,'payrollGross',0,'adjustments',0),
      'net', 0, 'statusTotals', '{}'::jsonb, 'unpaidTotal', 0, 'reconciledTotal', 0,
      'aging', jsonb_build_object('d0_30',0,'d31_60',0,'d61_90',0,'d90p',0),
      'trend', '[]'::jsonb, 'perPeriod', '[]'::jsonb, 'perClub', '[]'::jsonb, 'clubs', '[]'::jsonb
    );
  end if;

  with
  acc_clubs as (
    select id, name from public.clubs where id = any(v_all_ids)
  ),
  -- Staking fees, split into the three sub-components (check-in fixed + percent, completed archive).
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
  -- Expected (estimate) tournament rake = rake_amount × paying confirmed entries.
  tour_confirmed as (
    select tr.tournament_id, count(*)::numeric as confirmed
    from public.tournament_registrations tr
    where tr.status = 'confirmed'
      and tr.tournament_id in (
        select id from public.tournaments
        where club_id = any(v_club_ids) and created_at between p_from and p_to
      )
    group by tr.tournament_id
  ),
  rake_rows as (
    select t.club_id, to_char(t.created_at, 'YYYY-MM') as ym,
      coalesce(t.rake_amount,0) * greatest(0, coalesce(tc.confirmed,0)
        - case when t.free_rake_enabled then coalesce(t.free_rake_used,0) else 0 end) as fee
    from public.tournaments t
    left join tour_confirmed tc on tc.tournament_id = t.id
    where t.club_id = any(v_club_ids) and t.created_at between p_from and p_to
  ),
  -- ACTUAL collected tournament rake, per confirmed registration. (total_pay - buy_in) is the rake
  -- portion across ALL sources; reference_code prefix classifies online/offline/reentry.
  reg_rake as (
    select t.club_id,
           to_char(t.created_at, 'YYYY-MM') as ym,
           tr.reference_code,
           greatest(0, coalesce(tr.total_pay,0) - coalesce(tr.buy_in,0)) as rake_actual
    from public.tournament_registrations tr
    join public.tournaments t on t.id = tr.tournament_id
    where tr.status = 'confirmed'
      and t.club_id = any(v_club_ids)
      and t.created_at between p_from and p_to
  ),
  -- Total/trend/perClub revenue uses ACTUAL rake (real money in), not the estimate.
  rev_all as (
    select club_id, ym, (fixed_fee + percent_fee + archive_fee) as fee from fee_rows
    union all select club_id, ym, fee from payout_rows
    union all select club_id, ym, rake_actual as fee from reg_rake
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
      'rake',           (select coalesce(sum(rake_actual),0) from reg_rake),  -- headline = ACTUAL collected
      'rakeActual',     (select coalesce(sum(rake_actual),0) from reg_rake),
      'rakeExpected',   (select coalesce(sum(fee),0) from rake_rows),
      'rakeVariance',   (select coalesce(sum(rake_actual),0) from reg_rake)
                        - (select coalesce(sum(fee),0) from rake_rows),
      'rakeOnline',     (select coalesce(sum(rake_actual),0) from reg_rake
                         where reference_code is null
                            or (reference_code not like 'CASH-%' and reference_code not like 'REENTRY-%')),
      'rakeOffline',    (select coalesce(sum(rake_actual),0) from reg_rake where reference_code like 'CASH-%'),
      'rakeReentry',    (select coalesce(sum(rake_actual),0) from reg_rake where reference_code like 'REENTRY-%'),
      'total',          (select coalesce(sum(fee),0) from rev_all)
    ),
    'cost', jsonb_build_object(
      'payrollNet',   (select coalesce(sum(net),0)   from period_eff),
      'payrollGross', (select coalesce(sum(gross),0) from period_eff),
      'adjustments',  (select coalesce(sum(adj),0)   from period_eff)
    ),
    'net', (select coalesce(sum(fee),0) from rev_all) - (select coalesce(sum(net),0) from period_eff),
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
          coalesce((select sum(net) from period_eff pe
                    where to_char(make_date(pe.period_year, pe.period_month, 1), 'YYYY-MM') = m.ym), 0) as cost_v
        from (
          select ym from rev_all
          union
          select to_char(make_date(period_year, period_month, 1), 'YYYY-MM') as ym from period_eff
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
          coalesce((select sum(net) from period_eff pe where pe.club_id = ac.id), 0) as cost_v
        from acc_clubs ac
        where ac.id = any(v_club_ids)
      ) pc
      where rev_v <> 0 or cost_v <> 0
    ),
    'clubs', (select coalesce(jsonb_agg(jsonb_build_object('id', id, 'name', name) order by name), '[]'::jsonb) from acc_clubs)
  ) into v_result;

  return v_result;
end;
$$;

revoke all on function public.get_club_finance_summary(timestamptz, timestamptz, uuid) from public, anon;
grant execute on function public.get_club_finance_summary(timestamptz, timestamptz, uuid) to authenticated;
