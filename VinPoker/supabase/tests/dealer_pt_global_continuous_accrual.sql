-- Global forward-only PT wage policy and effective-dated rate-history tests.
-- Run only against a disposable current schema after migrations 00001, 00002,
-- and 00003. This file rolls back every fixture and payout it creates.

\set ON_ERROR_STOP on

begin;

create or replace function pg_temp.assert_true(p_value boolean, p_label text)
returns void
language plpgsql
as $$
begin
  if p_value is distinct from true then
    raise exception 'assert_true failed: %', p_label;
  end if;
end;
$$;

create or replace function pg_temp.assert_eq(p_actual text, p_expected text, p_label text)
returns void
language plpgsql
as $$
begin
  if p_actual is distinct from p_expected then
    raise exception 'assert_eq failed: % (actual=%, expected=%)', p_label, p_actual, p_expected;
  end if;
end;
$$;

create or replace function pg_temp.club_wage_row(p_payload jsonb, p_dealer_id uuid)
returns jsonb
language sql
immutable
as $$
  select wage_row
  from jsonb_array_elements(coalesce(p_payload->'dealers', '[]'::jsonb)) as wage_row
  where wage_row->>'dealer_id' = p_dealer_id::text
  limit 1
$$;

select pg_temp.assert_true(
  not has_function_privilege('anon', 'public.get_dealer_pt_wage_global_accrual_policy()', 'EXECUTE')
  and not has_function_privilege('anon', 'public.set_all_approved_dealer_pt_wage_accrual(boolean,text)', 'EXECUTE'),
  'anon cannot read or mutate the global PT wage policy'
);
select pg_temp.assert_true(
  has_function_privilege('authenticated', 'public.get_dealer_pt_wage_global_accrual_policy()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_all_approved_dealer_pt_wage_accrual(boolean,text)', 'EXECUTE'),
  'authenticated enters the server authorization path'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.dealer_pt_wage_accrual_global_policy', 'SELECT')
  and not has_table_privilege('authenticated', 'public.dealer_pt_wage_rate_history', 'SELECT')
  and not has_table_privilege('authenticated', 'public.dealer_pt_wage_rate_history', 'INSERT'),
  'global policy and rate history are server-only tables'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'pt-global-super@test.invalid', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'pt-global-owner@test.invalid', now(), now()),
  ('fa000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'pt-global-other@test.invalid', now(), now());

insert into public.user_roles (user_id, role)
values ('fa000000-0000-4000-8000-000000000001', 'super_admin');

insert into public.clubs (id, owner_id, name, region, status)
values
  ('fb000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'PT GLOBAL APPROVED A', 'HCM', 'approved'),
  ('fb000000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000003', 'PT GLOBAL APPROVED B', 'HCM', 'approved'),
  ('fb000000-0000-4000-8000-000000000003', 'fa000000-0000-4000-8000-000000000002', 'PT GLOBAL PENDING', 'HCM', 'pending');

insert into public.dealers (
  id, club_id, full_name, status, employment_type, hourly_rate_vnd
)
values
  ('fc000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'PT global open', 'active', 'part_time', 50000),
  ('fc000000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000001', 'PT rate split', 'active', 'part_time', 50000),
  ('fc000000-0000-4000-8000-000000000003', 'fb000000-0000-4000-8000-000000000001', 'PT missing history', 'active', 'part_time', 50000),
  ('fc000000-0000-4000-8000-000000000004', 'fb000000-0000-4000-8000-000000000001', 'FT excluded', 'active', 'full_time', 50000);

insert into public.dealer_attendance (
  id, dealer_id, shift_date, status, current_state, check_in_time, check_out_time
)
values
  ('fd000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', current_date - 2, 'checked_in', 'available', now() - interval '30 hours', null),
  ('fd000000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000002', current_date, 'checked_out', 'available', now() - interval '1 hour', now()),
  ('fd000000-0000-4000-8000-000000000003', 'fc000000-0000-4000-8000-000000000003', current_date, 'checked_out', 'available', now() - interval '1 hour', now()),
  ('fd000000-0000-4000-8000-000000000004', 'fc000000-0000-4000-8000-000000000004', current_date, 'checked_out', 'available', now() - interval '1 hour', now());

select pg_temp.assert_eq(
  (public._pt_wage_balance('fc000000-0000-4000-8000-000000000001')->>'accrued_minutes'),
  '1440',
  'global policy defaults to the legacy 24-hour cap'
);

select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
begin
  perform public.set_all_approved_dealer_pt_wage_accrual(true, 'owner must not enable every club');
  raise exception 'non-super-admin global enable unexpectedly succeeded';
exception
  when insufficient_privilege then
    null;
end;
$$;

select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000001', true);

do $$
declare
  v_enabled jsonb;
  v_replay jsonb;
  v_open jsonb;
begin
  v_enabled := public.set_all_approved_dealer_pt_wage_accrual(
    true,
    'activate global PT continuous accrual from the server boundary'
  );
  v_replay := public.set_all_approved_dealer_pt_wage_accrual(
    true,
    'replay must not move an existing activation boundary'
  );
  v_open := pg_temp.club_wage_row(
    public.get_club_pt_wages('fb000000-0000-4000-8000-000000000001'),
    'fc000000-0000-4000-8000-000000000001'
  );

  perform pg_temp.assert_eq(v_enabled->>'standby_accrual_enabled', 'true', 'global enable returns target state');
  perform pg_temp.assert_eq(v_enabled->>'future_club_enabled', 'true', 'future approved clubs inherit enablement');
  perform pg_temp.assert_eq(v_replay->>'idempotent', 'true', 'global replay does not rewrite policies or audits');
  perform pg_temp.assert_true((v_open->>'accrued_minutes')::int <= 1, 'a 30-hour unchecked-out attendance is not backfilled before activation');
  perform pg_temp.assert_eq(v_open->>'accrual_mode', 'continuous_standby', 'activation removes the cap only after its boundary');
  perform pg_temp.assert_true(
    (select count(*) = 2
       from public.dealer_pt_wage_accrual_policies p
       join public.clubs c on c.id = p.club_id
      where c.status = 'approved'
        and p.standby_accrual_enabled
        and p.effective_from is not null),
    'every currently approved club gets one server-timed enabled policy'
  );
  perform pg_temp.assert_eq(
    (select count(*)::text from public.dealer_pt_wage_payments
      where dealer_id = 'fc000000-0000-4000-8000-000000000001'),
    '0',
    'global activation never writes or overwrites a payout'
  );
end;
$$;

reset role;

insert into public.clubs (id, owner_id, name, region, status)
values ('fb000000-0000-4000-8000-000000000004', 'fa000000-0000-4000-8000-000000000002', 'PT GLOBAL FUTURE', 'HCM', 'approved');
update public.clubs
set status = 'approved'
where id = 'fb000000-0000-4000-8000-000000000003';

insert into public.clubs (id, owner_id, name, region, status)
values ('fb000000-0000-4000-8000-000000000005', 'fa000000-0000-4000-8000-000000000002', 'PT GLOBAL MANUAL OFF', 'HCM', 'pending');
insert into public.dealer_pt_wage_accrual_policies (
  club_id, standby_accrual_enabled, effective_from, reason
) values (
  'fb000000-0000-4000-8000-000000000005', false, null, 'disposable explicit override'
);
update public.clubs
set status = 'approved'
where id = 'fb000000-0000-4000-8000-000000000005';

select pg_temp.assert_true(
  (select standby_accrual_enabled from public.dealer_pt_wage_accrual_policies where club_id = 'fb000000-0000-4000-8000-000000000004')
  and (select standby_accrual_enabled from public.dealer_pt_wage_accrual_policies where club_id = 'fb000000-0000-4000-8000-000000000003')
  and not (select standby_accrual_enabled from public.dealer_pt_wage_accrual_policies where club_id = 'fb000000-0000-4000-8000-000000000005'),
  'future approval creates the global default without overriding an explicit manual false policy'
);

-- Build a deterministic one-hour forward-only window split by a rate change.
delete from public.dealer_pt_wage_rate_history
where dealer_id in ('fc000000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000003');
insert into public.dealer_pt_wage_rate_history (dealer_id, hourly_rate_vnd, effective_from)
values
  ('fc000000-0000-4000-8000-000000000002', 50000, now() - interval '1 hour'),
  ('fc000000-0000-4000-8000-000000000002', 70000, now() - interval '30 minutes'),
  ('fc000000-0000-4000-8000-000000000003', 50000, now() - interval '30 minutes');

update public.dealer_pt_wage_accrual_policies
set standby_accrual_enabled = true,
    effective_from = now() - interval '1 hour',
    updated_at = now(),
    reason = 'disposable rate split fixture'
where club_id = 'fb000000-0000-4000-8000-000000000001';

do $$
declare v_split jsonb;
begin
  v_split := public._pt_wage_balance('fc000000-0000-4000-8000-000000000002');
  perform pg_temp.assert_eq(v_split->>'accrued_minutes', '60', 'rate split retains the whole worked hour');
  perform pg_temp.assert_eq(v_split->>'balance_vnd', '60000', '50K then 70K applies only to its own half-hour');
  perform pg_temp.assert_eq(jsonb_array_length(v_split->'rate_segments')::text, '2', 'server returns both effective rate segments for payout audit');
end;
$$;

do $$
begin
  perform public._pt_wage_balance('fc000000-0000-4000-8000-000000000003');
  raise exception 'missing rate baseline unexpectedly returned a wage balance';
exception
  when no_data_found then
    null;
end;
$$;

update public.dealers
set hourly_rate_vnd = 80000
where id = 'fc000000-0000-4000-8000-000000000002';

select pg_temp.assert_true(
  exists (
    select 1
    from public.dealer_pt_wage_rate_history
    where dealer_id = 'fc000000-0000-4000-8000-000000000002'
      and hourly_rate_vnd = 80000
  )
  and exists (
    select 1
    from public.payroll_audit_log
    where table_name = 'dealer_pt_wage_rate_history'
      and record_id in (
        select id from public.dealer_pt_wage_rate_history
        where dealer_id = 'fc000000-0000-4000-8000-000000000002'
      )
  ),
  'direct dealer-rate edits create a server-timed rate row and audit record'
);

select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare v_payment jsonb;
begin
  v_payment := public.pay_part_time_balance(
    'fc000000-0000-4000-8000-000000000002',
    'cash',
    null,
    'pt-global-rate-split-replay',
    'disposable rate-history payment'
  );
  perform pg_temp.assert_eq(v_payment->>'amount_vnd', '60000', 'payment uses the server-derived mixed-rate amount');
  perform pg_temp.assert_eq(
    jsonb_array_length(v_payment->'accrual_policy_snapshot'->'rate_segments')::text,
    '2',
    'payment preserves the detailed effective-rate basis immutably'
  );
end;
$$;

do $$
declare v_disabled jsonb;
begin
  v_disabled := public.set_all_approved_dealer_pt_wage_accrual(
    false,
    'emergency disable global PT continuous accrual'
  );
  perform pg_temp.assert_eq(v_disabled->>'future_club_enabled', 'false', 'global disable stops future default');
  perform pg_temp.assert_true(
    not exists (
      select 1
      from public.dealer_pt_wage_accrual_policies p
      join public.clubs c on c.id = p.club_id
      where c.status = 'approved' and p.standby_accrual_enabled
    ),
    'global disable returns every approved club to the capped policy'
  );
end;
$$;

reset role;

insert into public.clubs (id, owner_id, name, region, status)
values ('fb000000-0000-4000-8000-000000000006', 'fa000000-0000-4000-8000-000000000002', 'PT GLOBAL OFF FUTURE', 'HCM', 'approved');

select pg_temp.assert_true(
  not exists (
    select 1 from public.dealer_pt_wage_accrual_policies
    where club_id = 'fb000000-0000-4000-8000-000000000006'
  ),
  'an approved club after global disable receives no automatic enabled policy'
);
select pg_temp.assert_true(
  not exists (
    select 1 from public.dealer_pt_wage_payments
    where dealer_id = 'fc000000-0000-4000-8000-000000000004'
  ),
  'full-time dealers remain outside the PT wage path'
);

do $$
begin
  raise notice 'dealer PT global continuous accrual SQL tests passed';
end;
$$;

rollback;
