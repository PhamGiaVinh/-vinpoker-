-- Global PT wage lifecycle after 20270106000001 v2.
-- Run only against a disposable current schema. All fixtures and payout rows
-- are rolled back; separate dblink tests cover cross-transaction interleaving.

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
  and not has_function_privilege('anon', 'public.set_all_approved_dealer_pt_wage_accrual(boolean,text)', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.get_dealer_pt_wage_global_accrual_policy()', 'EXECUTE')
  and has_function_privilege('authenticated', 'public.set_all_approved_dealer_pt_wage_accrual(boolean,text)', 'EXECUTE'),
  'only authenticated callers reach the server-authorized global policy contract after 00003'
);
select pg_temp.assert_true(
  not has_table_privilege('authenticated', 'public.dealer_pt_wage_accrual_global_policy', 'SELECT')
  and not has_table_privilege('authenticated', 'public.dealer_pt_wage_rate_history', 'SELECT')
  and not has_table_privilege('authenticated', 'public.dealer_pt_wage_rate_history', 'INSERT'),
  'global policy and rate history stay server-only'
);

insert into auth.users (id, aud, role, email, created_at, updated_at)
values
  ('fa000000-0000-4000-8000-000000000001', 'authenticated', 'authenticated', 'pt-global-super@test.invalid', now(), now()),
  ('fa000000-0000-4000-8000-000000000002', 'authenticated', 'authenticated', 'pt-global-owner@test.invalid', now(), now()),
  ('fa000000-0000-4000-8000-000000000003', 'authenticated', 'authenticated', 'pt-global-capped-owner@test.invalid', now(), now());

insert into public.user_roles (user_id, role)
values ('fa000000-0000-4000-8000-000000000001', 'super_admin');

insert into public.clubs (id, owner_id, name, region, status)
values
  ('fb000000-0000-4000-8000-000000000001', 'fa000000-0000-4000-8000-000000000002', 'PT CONTINUOUS', 'HCM', 'approved'),
  ('fb000000-0000-4000-8000-000000000002', 'fa000000-0000-4000-8000-000000000003', 'PT CAPPED', 'HCM', 'approved');

insert into public.dealers (id, club_id, full_name, status, employment_type, hourly_rate_vnd)
values
  ('fc000000-0000-4000-8000-000000000001', 'fb000000-0000-4000-8000-000000000001', 'PT open legacy', 'active', 'part_time', 50000),
  ('fc000000-0000-4000-8000-000000000002', 'fb000000-0000-4000-8000-000000000001', 'PT continuous split', 'active', 'part_time', 50000),
  ('fc000000-0000-4000-8000-000000000003', 'fb000000-0000-4000-8000-000000000002', 'PT capped split', 'active', 'part_time', 50000),
  ('fc000000-0000-4000-8000-000000000004', 'fb000000-0000-4000-8000-000000000001', 'PT disable split', 'active', 'part_time', 50000),
  ('fc000000-0000-4000-8000-000000000005', 'fb000000-0000-4000-8000-000000000001', 'FT then PT', 'active', 'part_time', 50000),
  ('fc000000-0000-4000-8000-000000000006', 'fb000000-0000-4000-8000-000000000001', 'FT excluded', 'active', 'full_time', 50000);

insert into public.dealer_attendance (
  id, dealer_id, shift_date, status, current_state, check_in_time, check_out_time
)
values
  ('fd000000-0000-4000-8000-000000000001', 'fc000000-0000-4000-8000-000000000001', current_date - 2, 'checked_in', 'available', now() - interval '30 hours', null),
  ('fd000000-0000-4000-8000-000000000002', 'fc000000-0000-4000-8000-000000000002', current_date, 'checked_out', 'available', now() - interval '1 hour', now()),
  ('fd000000-0000-4000-8000-000000000003', 'fc000000-0000-4000-8000-000000000003', current_date, 'checked_out', 'available', now() - interval '1 hour', now()),
  ('fd000000-0000-4000-8000-000000000004', 'fc000000-0000-4000-8000-000000000004', current_date, 'checked_out', 'available', now() - interval '1 hour', now()),
  ('fd000000-0000-4000-8000-000000000005', 'fc000000-0000-4000-8000-000000000005', current_date, 'checked_out', 'available', now() - interval '90 minutes', now()),
  ('fd000000-0000-4000-8000-000000000006', 'fc000000-0000-4000-8000-000000000006', current_date, 'checked_out', 'available', now() - interval '1 hour', now());

-- Replace trigger-created now() baselines with deterministic history fixtures.
delete from public.dealer_pt_wage_rate_history
where dealer_id in (
  'fc000000-0000-4000-8000-000000000002',
  'fc000000-0000-4000-8000-000000000003',
  'fc000000-0000-4000-8000-000000000004',
  'fc000000-0000-4000-8000-000000000005'
);
insert into public.dealer_pt_wage_rate_history (
  dealer_id, hourly_rate_vnd, pt_eligible, effective_from
)
values
  ('fc000000-0000-4000-8000-000000000002', 50000, true,  now() - interval '1 hour'),
  ('fc000000-0000-4000-8000-000000000002', 70000, true,  now() - interval '30 minutes'),
  ('fc000000-0000-4000-8000-000000000003', 50000, true,  now() - interval '1 hour'),
  ('fc000000-0000-4000-8000-000000000003', 70000, true,  now() - interval '30 minutes'),
  ('fc000000-0000-4000-8000-000000000004', 50000, true,  now() - interval '1 hour'),
  ('fc000000-0000-4000-8000-000000000004', 70000, true,  now() - interval '30 minutes'),
  -- Attendance began full-time. Its first PT row is the eligibility boundary;
  -- false records exclude the FT interval and a later re-PT starts anew.
  ('fc000000-0000-4000-8000-000000000005', 50000, true,  now() - interval '60 minutes'),
  ('fc000000-0000-4000-8000-000000000005', 50000, false, now() - interval '45 minutes'),
  ('fc000000-0000-4000-8000-000000000005', 70000, true,  now() - interval '30 minutes');

select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000002', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
begin
  perform public.set_all_approved_dealer_pt_wage_accrual(true, 'non-super-admin must be rejected');
  raise exception 'non-super-admin global enable unexpectedly succeeded';
exception
  when insufficient_privilege then null;
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
    'activate forward-only global PT continuous accrual'
  );
  v_replay := public.set_all_approved_dealer_pt_wage_accrual(
    true,
    'replay must not move the activation boundary'
  );
  v_open := pg_temp.club_wage_row(
    public.get_club_pt_wages('fb000000-0000-4000-8000-000000000001'),
    'fc000000-0000-4000-8000-000000000001'
  );

  perform pg_temp.assert_eq(v_enabled->>'standby_accrual_enabled', 'true', 'global enable returns target state');
  perform pg_temp.assert_eq(v_replay->>'idempotent', 'true', 'global replay preserves the activation boundary');
  perform pg_temp.assert_true((v_open->>'accrued_minutes')::int <= 1, 'global enable never backfills a 30-hour unchecked-out attendance');
  perform pg_temp.assert_eq(v_open->>'accrual_mode', 'continuous_standby', 'global enable selects continuous mode only after its boundary');
end;
$$;

-- Set deterministic policy windows inside this disposable transaction only.
reset role;
update public.dealer_pt_wage_accrual_policies
set standby_accrual_enabled = true,
    effective_from = now() - interval '1 hour',
    updated_at = now(),
    reason = 'disposable continuous segment fixture'
where club_id = 'fb000000-0000-4000-8000-000000000001';
update public.dealer_pt_wage_accrual_policies
set standby_accrual_enabled = false,
    effective_from = null,
    updated_at = now(),
    reason = 'disposable capped segment fixture'
where club_id = 'fb000000-0000-4000-8000-000000000002';

do $$
declare
  v_continuous jsonb;
  v_capped jsonb;
  v_ft_transition jsonb;
begin
  v_continuous := public._pt_wage_balance('fc000000-0000-4000-8000-000000000002');
  v_capped := public._pt_wage_balance('fc000000-0000-4000-000000000003');
  v_ft_transition := public._pt_wage_balance('fc000000-0000-4000-8000-000000000005');

  perform pg_temp.assert_eq(v_continuous->>'balance_vnd', '60000', 'continuous 30m at 50K plus 30m at 70K is 60K');
  perform pg_temp.assert_eq(v_capped->>'balance_vnd', '60000', 'capped mode uses the same rate segments before the per-attendance cap');
  perform pg_temp.assert_eq(v_continuous->>'accrued_minutes', '60', 'continuous split keeps 60 minutes');
  perform pg_temp.assert_eq(v_capped->>'accrued_minutes', '60', 'capped split keeps 60 minutes below the cap');
  perform pg_temp.assert_eq(jsonb_array_length(v_continuous->'rate_segments')::text, '2', 'continuous snapshot exposes both rate segments');
  perform pg_temp.assert_eq(jsonb_array_length(v_capped->'rate_segments')::text, '2', 'capped snapshot exposes both rate segments');
  perform pg_temp.assert_eq(v_ft_transition->>'balance_vnd', '47500', 'FT interval is excluded; only PT and re-PT segments accrue');
  perform pg_temp.assert_eq(jsonb_array_length(v_ft_transition->'rate_segments')::text, '2', 'FT to PT to FT to PT produces two payable forward segments');
  perform pg_temp.assert_true(
    not exists (
      select 1
      from jsonb_array_elements(v_ft_transition->'rate_segments') s
      where (s->>'segment_start')::timestamptz < now() - interval '60 minutes'
    ),
    'the first PT rate row is the forward eligibility boundary'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000001', true);
select set_config('request.jwt.claim.role', 'authenticated', true);
set local role authenticated;

do $$
declare
  v_payment jsonb;
  v_snapshot jsonb;
  v_snapshot_before text;
  v_payment_row_before text;
  v_amount_from_segments numeric;
begin
  v_payment := public.pay_part_time_balance(
    'fc000000-0000-4000-8000-000000000002',
    'cash', null, 'pt-global-rate-segment-payment', 'disposable mixed-rate payment'
  );
  v_snapshot := v_payment->'accrual_policy_snapshot';
  v_snapshot_before := v_snapshot::text;
  select row_to_json(w)::text
    into v_payment_row_before
  from public.dealer_pt_wage_payments w
  where w.dealer_id = 'fc000000-0000-4000-8000-000000000002'
    and w.idempotency_key = 'pt-global-rate-segment-payment';
  select floor(sum((segment->>'amount_vnd')::numeric))
    into v_amount_from_segments
  from jsonb_array_elements(v_snapshot->'rate_segments') segment;

  perform pg_temp.assert_eq(v_payment->>'amount_vnd', '60000', 'payment uses the server-derived mixed-rate amount');
  perform pg_temp.assert_eq(v_amount_from_segments::text, '60000', 'precise segment contributions reconstruct the payment amount');
  perform pg_temp.assert_true(
    not exists (
      select 1
      from jsonb_array_elements(v_snapshot->'rate_segments') segment
      where segment ? 'segment_start' is false
         or segment ? 'segment_end' is false
         or segment ? 'hourly_rate_vnd' is false
         or segment ? 'elapsed_seconds' is false
         or segment ? 'amount_vnd' is false
    ),
    'payout snapshot includes exact boundaries, rate, seconds and contribution'
  );

  reset role;
  update public.dealers
  set hourly_rate_vnd = 80000
  where id = 'fc000000-0000-4000-8000-000000000002';

  perform pg_temp.assert_eq(
    (select accrual_policy_snapshot::text
       from public.dealer_pt_wage_payments
      where dealer_id = 'fc000000-0000-4000-8000-000000000002'
        and idempotency_key = 'pt-global-rate-segment-payment'),
    v_snapshot_before,
    'a later rate change cannot mutate an existing payment snapshot'
  );
  perform pg_temp.assert_eq(
    (select row_to_json(w)::text
       from public.dealer_pt_wage_payments w
      where w.dealer_id = 'fc000000-0000-4000-8000-000000000002'
        and w.idempotency_key = 'pt-global-rate-segment-payment'),
    v_payment_row_before,
    'a later rate change preserves every byte of the existing payment row'
  );
  perform pg_temp.assert_true(
    exists (
      select 1
      from public.dealer_pt_wage_rate_history
      where dealer_id = 'fc000000-0000-4000-8000-000000000002'
        and hourly_rate_vnd = 80000
        and pt_eligible
    ),
    'a rate edit creates a forward PT-eligible history segment'
  );
  perform pg_temp.assert_true(
    exists (
      select 1 from public.payroll_audit_log
      where table_name = 'dealer_pt_wage_rate_history'
    ),
    'rate history writes are audited'
  );
end;
$$;

select set_config('request.jwt.claim.sub', 'fa000000-0000-4000-8000-000000000001', true);
set local role authenticated;

do $$
declare
  v_before_disable jsonb;
  v_disabled jsonb;
  v_after_disable jsonb;
begin
  v_before_disable := public._pt_wage_balance('fc000000-0000-4000-8000-000000000004');
  v_disabled := public.set_all_approved_dealer_pt_wage_accrual(false, 'emergency containment must remain available');
  v_after_disable := public._pt_wage_balance('fc000000-0000-4000-8000-000000000004');
  perform pg_temp.assert_eq(v_before_disable->>'balance_vnd', '60000', 'pre-disable unpaid split balance is 60K');
  perform pg_temp.assert_eq(v_after_disable->>'balance_vnd', '60000', 'disable does not reprice unpaid mixed-rate history');
  perform pg_temp.assert_eq(v_disabled->>'future_club_enabled', 'false', 'disable turns off future-club inheritance');
end;
$$;

reset role;

select pg_temp.assert_true(
  not exists (
    select 1 from public.dealer_pt_wage_payments
    where dealer_id = 'fc000000-0000-4000-8000-000000000006'
  ),
  'full-time dealer never enters the PT wage payment path'
);
select pg_temp.assert_eq(
  (public._pt_wage_balance('fc000000-0000-4000-8000-000000000006')->>'balance_vnd'),
  '0',
  'a current full-time dealer does not accrue a new PT wage'
);

do $$
begin
  raise notice 'dealer PT global continuous accrual SQL tests passed';
end;
$$;

rollback;
