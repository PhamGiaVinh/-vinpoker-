-- Dealer PT standby accrual policy.
--
-- The legacy PT wage helper caps each attendance record at 24 hours. That was
-- a safe default for unattended check-ins, but it incorrectly stops accrual
-- for an operator-approved dealer who remains checked in and waiting in the
-- dealer pool. This migration keeps the cap unless a club owner/admin enables
-- continuous standby accrual through the audited server RPC below.
--
-- Financial invariants:
--   * default is OFF, so existing clubs retain the 24-hour cap;
--   * saved payout rows are never recomputed or overwritten;
--   * the payout reset anchor remains the latest non-voided covered_to;
--   * the policy applies only to active part-time dealers;
--   * configuration and payment are serialized with the same club advisory lock.

begin;

do $$
begin
  if to_regclass('public.dealer_pt_wage_payments') is null
     or to_regclass('public.dealer_attendance') is null
     or to_regclass('public.payroll_audit_log') is null then
    raise exception 'dealer PT standby accrual requires the PT wage ledger, attendance, and payroll audit tables';
  end if;

  if to_regprocedure('public._pt_wage_balance(uuid)') is null
     or to_regprocedure('public.get_my_pt_wage(uuid)') is null
     or to_regprocedure('public.get_club_pt_wages(uuid)') is null
     or to_regprocedure('public.pay_part_time_balance(uuid,text,text,text,text)') is null then
    raise exception 'dealer PT standby accrual requires the current PT wage RPC contract';
  end if;
end;
$$;

create table if not exists public.dealer_pt_wage_accrual_policies (
  id                       uuid primary key default gen_random_uuid(),
  club_id                  uuid not null unique references public.clubs(id) on delete cascade,
  standby_accrual_enabled  boolean not null default false,
  effective_from           timestamptz,
  updated_at               timestamptz not null default now(),
  updated_by               uuid references auth.users(id),
  reason                   text,
  constraint dealer_pt_wage_accrual_policy_reason_length
    check (reason is null or char_length(reason) <= 500)
);

alter table public.dealer_pt_wage_accrual_policies enable row level security;

revoke all on table public.dealer_pt_wage_accrual_policies from public, anon, authenticated;
grant select on table public.dealer_pt_wage_accrual_policies to service_role;

comment on table public.dealer_pt_wage_accrual_policies is
  'Per-club PT dealer wage policy. Default is capped 24h. Continuous standby accrual must be explicitly enabled by an audited owner/admin action.';
comment on column public.dealer_pt_wage_accrual_policies.effective_from is
  'When continuous standby accrual is enabled, NULL means every unpaid minute since the last payout anchor is eligible.';

alter table public.dealer_pt_wage_payments
  add column if not exists accrual_policy_snapshot jsonb;

comment on column public.dealer_pt_wage_payments.accrual_policy_snapshot is
  'Immutable policy snapshot used for this payout. Legacy rows remain NULL rather than being backfilled or reinterpreted.';

create or replace function public._pt_wage_balance(p_dealer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dealer                  record;
  v_rate                    integer;
  v_anchor                  timestamptz;
  v_now                     timestamptz := now();
  v_minutes                 numeric := 0;
  v_open_start              timestamptz;
  v_standby_accrual_enabled boolean := false;
  v_effective_from          timestamptz;
  v_current_shift_capped    boolean := false;
begin
  select id, full_name, employment_type, hourly_rate_vnd, club_id
    into v_dealer
  from public.dealers
  where id = p_dealer_id and status = 'active';
  if not found then
    return jsonb_build_object('error', 'dealer not found or inactive');
  end if;

  v_rate := greatest(coalesce(v_dealer.hourly_rate_vnd, 0), 50000);

  select coalesce(
    (select max(covered_to)
       from public.dealer_pt_wage_payments
      where dealer_id = p_dealer_id and voided_at is null),
    (select min(check_in_time)
       from public.dealer_attendance
      where dealer_id = p_dealer_id and check_in_time is not null),
    v_now
  ) into v_anchor;

  select p.standby_accrual_enabled, p.effective_from
    into v_standby_accrual_enabled, v_effective_from
  from public.dealer_pt_wage_accrual_policies p
  where p.club_id = v_dealer.club_id;

  v_standby_accrual_enabled := coalesce(v_standby_accrual_enabled, false);
  if not v_standby_accrual_enabled then
    v_effective_from := null;
  end if;

  -- No client amount is accepted. An enabled policy removes only the legacy
  -- 24-hour cap and only after its effective boundary; the payout anchor still
  -- prevents already-paid time from reappearing.
  select coalesce(sum(
           case
             when v_standby_accrual_enabled then
               greatest(0, extract(epoch from (
                 least(coalesce(da.check_out_time, v_now), v_now)
                 - greatest(da.check_in_time, v_anchor, coalesce(v_effective_from, '-infinity'::timestamptz))
               )) / 60.0)
             else
               least(
                 greatest(0, extract(epoch from (
                   least(coalesce(da.check_out_time, v_now), v_now)
                   - greatest(da.check_in_time, v_anchor)
                 )) / 60.0),
                 1440
               )
           end
         ), 0)
    into v_minutes
  from public.dealer_attendance da
  where da.dealer_id = p_dealer_id
    and da.status in ('checked_in', 'checked_out')
    and da.check_in_time is not null
    and da.check_in_time < v_now
    and coalesce(da.check_out_time, v_now) > greatest(v_anchor, coalesce(v_effective_from, '-infinity'::timestamptz));

  select da.check_in_time
    into v_open_start
  from public.dealer_attendance da
  where da.dealer_id = p_dealer_id
    and da.status = 'checked_in'
    and da.check_out_time is null
    and da.check_in_time is not null
  order by da.check_in_time desc
  limit 1;

  v_current_shift_capped := v_open_start is not null
    and not v_standby_accrual_enabled
    and greatest(0, extract(epoch from (v_now - greatest(v_open_start, v_anchor))) / 60.0) >= 1440;

  return jsonb_build_object(
    'dealer_id',                   p_dealer_id,
    'full_name',                   v_dealer.full_name,
    'employment_type',             v_dealer.employment_type,
    'club_id',                     v_dealer.club_id,
    'hourly_rate_vnd',             v_rate,
    'accrued_minutes',             floor(v_minutes)::int,
    'balance_vnd',                 floor(v_minutes / 60.0 * v_rate)::bigint,
    'last_reset_at',               v_anchor,
    'current_shift_open',          (v_open_start is not null),
    'current_shift_start',         v_open_start,
    'accrual_mode',                case when v_standby_accrual_enabled then 'continuous_standby' else 'capped_24h' end,
    'standby_accrual_enabled',     v_standby_accrual_enabled,
    'policy_effective_from',       v_effective_from,
    'per_attendance_cap_minutes',  case when v_standby_accrual_enabled then null else 1440 end,
    'current_shift_cap_reached',   v_current_shift_capped,
    'live_accrual_active',         v_open_start is not null and not v_current_shift_capped,
    'as_of',                       v_now
  );
end;
$$;
revoke all on function public._pt_wage_balance(uuid) from public, anon, authenticated;

create or replace function public.get_my_pt_wage(p_dealer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not exists (
    select 1 from public.dealers d
    where d.id = p_dealer_id and d.user_id = v_uid
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_result := public._pt_wage_balance(p_dealer_id);

  return v_result || jsonb_build_object(
    'recent_payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id,
               'amount_vnd', w.amount_vnd,
               'minutes_paid', w.minutes_paid,
               'paid_at', w.paid_at,
               'covered_from', w.covered_from,
               'covered_to', w.covered_to,
               'payment_method', w.payment_method,
               'payment_reference', w.payment_reference,
               'accrual_policy_snapshot', w.accrual_policy_snapshot
             ) order by w.paid_at desc)
      from (
        select * from public.dealer_pt_wage_payments
        where dealer_id = p_dealer_id and voided_at is null
        order by paid_at desc
        limit 20
      ) w
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_pt_wage(uuid) from public, anon;
grant execute on function public.get_my_pt_wage(uuid) to authenticated;

create or replace function public.get_club_pt_wages(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid                     uuid := auth.uid();
  v_rows                    jsonb := '[]'::jsonb;
  v_standby_accrual_enabled boolean := false;
  v_effective_from          timestamptz;
  r record;
  v_bal jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if not (
    public.has_role(v_uid, 'super_admin'::app_role)
    or public.has_role(v_uid, 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = p_club_id and c.owner_id = v_uid)
    or exists (select 1 from public.club_cashiers cc where cc.club_id = p_club_id and cc.user_id = v_uid)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select p.standby_accrual_enabled, p.effective_from
    into v_standby_accrual_enabled, v_effective_from
  from public.dealer_pt_wage_accrual_policies p
  where p.club_id = p_club_id;

  v_standby_accrual_enabled := coalesce(v_standby_accrual_enabled, false);
  if not v_standby_accrual_enabled then
    v_effective_from := null;
  end if;

  for r in
    select d.id
    from public.dealers d
    where d.club_id = p_club_id
      and d.status = 'active'
      and d.employment_type = 'part_time'
      and d.deleted_at is null
    order by d.full_name
  loop
    v_bal := public._pt_wage_balance(r.id);
    v_bal := v_bal || jsonb_build_object(
      'last_payment', (
        select jsonb_build_object('amount_vnd', w.amount_vnd, 'paid_at', w.paid_at)
        from public.dealer_pt_wage_payments w
        where w.dealer_id = r.id and w.voided_at is null
        order by w.paid_at desc
        limit 1
      )
    );
    v_rows := v_rows || jsonb_build_array(v_bal);
  end loop;

  return jsonb_build_object(
    'club_id', p_club_id,
    'as_of', now(),
    'accrual_mode', case when v_standby_accrual_enabled then 'continuous_standby' else 'capped_24h' end,
    'standby_accrual_enabled', v_standby_accrual_enabled,
    'policy_effective_from', v_effective_from,
    'dealers', v_rows
  );
end;
$$;
revoke all on function public.get_club_pt_wages(uuid) from public, anon;
grant execute on function public.get_club_pt_wages(uuid) to authenticated;

create or replace function public.pay_part_time_balance(
  p_dealer_id         uuid,
  p_payment_method    text,
  p_payment_reference text default null,
  p_idempotency_key   text default null,
  p_note              text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor           uuid := auth.uid();
  v_dealer          record;
  v_key             text;
  v_prior           record;
  v_bal             jsonb;
  v_amount          bigint;
  v_minutes         integer;
  v_rate            integer;
  v_anchor          timestamptz;
  v_now             timestamptz := now();
  v_id              uuid;
  v_policy_snapshot jsonb;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, club_id, employment_type, status
    into v_dealer
  from public.dealers
  where id = p_dealer_id;
  if not found or v_dealer.status <> 'active' then
    raise exception 'Dealer not found or inactive' using errcode = 'P0002';
  end if;
  if v_dealer.employment_type <> 'part_time' then
    raise exception 'Only part-time dealers are supported' using errcode = 'P0001';
  end if;
  if not (
    public.has_role(v_actor, 'super_admin'::app_role)
    or public.has_role(v_actor, 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = v_dealer.club_id and c.owner_id = v_actor)
    or exists (select 1 from public.club_cashiers cc where cc.club_id = v_dealer.club_id and cc.user_id = v_actor)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);

  -- This lock is shared with policy changes so a payout cannot straddle a
  -- historical policy enablement. The existing per-dealer lock still protects
  -- concurrent payouts for the same person.
  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || v_dealer.club_id::text));
  perform pg_advisory_xact_lock(hashtext('pt_wage:' || p_dealer_id::text));

  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select * into v_prior
    from public.dealer_pt_wage_payments
    where dealer_id = p_dealer_id and idempotency_key = v_key
    limit 1;
    if found then
      return jsonb_build_object(
        'payment_id', v_prior.id,
        'idempotent', true,
        'amount_vnd', v_prior.amount_vnd,
        'minutes_paid', v_prior.minutes_paid,
        'covered_from', v_prior.covered_from,
        'covered_to', v_prior.covered_to,
        'paid_at', v_prior.paid_at,
        'accrual_policy_snapshot', v_prior.accrual_policy_snapshot
      );
    end if;
  end if;

  v_bal := public._pt_wage_balance(p_dealer_id);
  v_amount := coalesce((v_bal->>'balance_vnd')::bigint, 0);
  v_minutes := coalesce((v_bal->>'accrued_minutes')::int, 0);
  v_rate := coalesce((v_bal->>'hourly_rate_vnd')::int, 0);
  v_anchor := coalesce((v_bal->>'last_reset_at')::timestamptz, v_now);
  v_policy_snapshot := jsonb_build_object(
    'accrual_mode', v_bal->>'accrual_mode',
    'standby_accrual_enabled', coalesce((v_bal->>'standby_accrual_enabled')::boolean, false),
    'policy_effective_from', v_bal->'policy_effective_from',
    'per_attendance_cap_minutes', v_bal->'per_attendance_cap_minutes'
  );

  if v_amount <= 0 then
    raise exception 'Balance is zero' using errcode = 'P0001';
  end if;

  insert into public.dealer_pt_wage_payments (
    dealer_id, club_id, amount_vnd, minutes_paid, hourly_rate_vnd_snapshot,
    covered_from, covered_to, paid_at, paid_by, created_by,
    payment_method, payment_reference, idempotency_key, note, accrual_policy_snapshot
  ) values (
    p_dealer_id, v_dealer.club_id, v_amount, v_minutes, v_rate,
    v_anchor, v_now, v_now, v_actor, v_actor,
    p_payment_method, p_payment_reference, v_key, p_note, v_policy_snapshot
  )
  returning id into v_id;

  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, new_values, changed_by, reason
  ) values (
    'dealer_pt_wage_payments', v_id, v_dealer.club_id, 'INSERT',
    jsonb_build_object(
      'dealer_id', p_dealer_id,
      'amount_vnd', v_amount,
      'minutes_paid', v_minutes,
      'hourly_rate_vnd_snapshot', v_rate,
      'covered_from', v_anchor,
      'covered_to', v_now,
      'payment_method', p_payment_method,
      'payment_reference', p_payment_reference,
      'accrual_policy_snapshot', v_policy_snapshot
    ),
    v_actor, 'PT wage full payout and reset'
  );

  return jsonb_build_object(
    'payment_id', v_id,
    'idempotent', false,
    'amount_vnd', v_amount,
    'minutes_paid', v_minutes,
    'hourly_rate_vnd_snapshot', v_rate,
    'covered_from', v_anchor,
    'covered_to', v_now,
    'paid_at', v_now,
    'accrual_policy_snapshot', v_policy_snapshot
  );
end;
$$;
revoke all on function public.pay_part_time_balance(uuid, text, text, text, text) from public, anon;
grant execute on function public.pay_part_time_balance(uuid, text, text, text, text) to authenticated;

create or replace function public.set_dealer_pt_wage_accrual_policy(
  p_club_id                 uuid,
  p_standby_accrual_enabled boolean,
  p_effective_from          timestamptz default null,
  p_reason                  text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor    uuid := auth.uid();
  v_existing public.dealer_pt_wage_accrual_policies%rowtype;
  v_policy   public.dealer_pt_wage_accrual_policies%rowtype;
  v_now      timestamptz := now();
  v_reason   text := nullif(btrim(p_reason), '');
  v_action   text;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_standby_accrual_enabled is null then
    raise exception 'standby accrual enabled is required' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'a reason of at most 500 characters is required' using errcode = '22023';
  end if;
  if p_effective_from is not null and p_effective_from > v_now then
    raise exception 'effective from cannot be in the future' using errcode = '22023';
  end if;
  if not (
    public.has_role(v_actor, 'super_admin'::app_role)
    or public.has_role(v_actor, 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = p_club_id and c.owner_id = v_actor)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || p_club_id::text));
  perform 1 from public.clubs where id = p_club_id for update;
  if not found then
    raise exception 'club not found' using errcode = 'P0002';
  end if;

  select * into v_existing
  from public.dealer_pt_wage_accrual_policies
  where club_id = p_club_id
  for update;

  if found
     and v_existing.standby_accrual_enabled = p_standby_accrual_enabled
     and v_existing.effective_from is not distinct from case when p_standby_accrual_enabled then p_effective_from else null end then
    return jsonb_build_object(
      'policy_id', v_existing.id,
      'idempotent', true,
      'club_id', p_club_id,
      'standby_accrual_enabled', v_existing.standby_accrual_enabled,
      'effective_from', v_existing.effective_from,
      'updated_at', v_existing.updated_at
    );
  end if;

  insert into public.dealer_pt_wage_accrual_policies as p (
    club_id, standby_accrual_enabled, effective_from, updated_at, updated_by, reason
  ) values (
    p_club_id,
    p_standby_accrual_enabled,
    case when p_standby_accrual_enabled then p_effective_from else null end,
    v_now,
    v_actor,
    v_reason
  )
  on conflict (club_id) do update
  set standby_accrual_enabled = excluded.standby_accrual_enabled,
      effective_from = excluded.effective_from,
      updated_at = excluded.updated_at,
      updated_by = excluded.updated_by,
      reason = excluded.reason
  returning * into v_policy;

  v_action := case when v_existing.id is null then 'INSERT' else 'UPDATE' end;
  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
  ) values (
    'dealer_pt_wage_accrual_policies',
    v_policy.id,
    p_club_id,
    v_action,
    case when v_existing.id is null then null else jsonb_build_object(
      'standby_accrual_enabled', v_existing.standby_accrual_enabled,
      'effective_from', v_existing.effective_from
    ) end,
    jsonb_build_object(
      'standby_accrual_enabled', v_policy.standby_accrual_enabled,
      'effective_from', v_policy.effective_from
    ),
    v_actor,
    v_reason
  );

  return jsonb_build_object(
    'policy_id', v_policy.id,
    'idempotent', false,
    'club_id', p_club_id,
    'standby_accrual_enabled', v_policy.standby_accrual_enabled,
    'effective_from', v_policy.effective_from,
    'updated_at', v_policy.updated_at
  );
end;
$$;
revoke all on function public.set_dealer_pt_wage_accrual_policy(uuid, boolean, timestamptz, text) from public, anon;
grant execute on function public.set_dealer_pt_wage_accrual_policy(uuid, boolean, timestamptz, text) to authenticated;

commit;
