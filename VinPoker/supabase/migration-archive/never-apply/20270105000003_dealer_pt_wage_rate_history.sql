-- PT wage forward-only activation and effective-dated hourly-rate history.
--
-- This migration supersedes the historical NULL-boundary behavior introduced
-- by 20270105000001. It never updates dealer_pt_wage_payments. Every future
-- continuous-accrual activation starts at the server transaction time, and a
-- later dealer hourly-rate change applies only after its server-recorded time.
--
-- Apply only after:
--   20270105000001_dealer_pt_standby_accrual_policy.sql
--   20270105000002_dealer_pt_wage_global_continuous_accrual.sql
--
-- Rollback: use a new owner-reviewed forward migration to disable the global
-- policy. Do not delete rate history or rewrite already-paid payout receipts.

begin;

do $$
begin
  if to_regclass('public.dealers') is null
     or to_regclass('public.dealer_attendance') is null
     or to_regclass('public.dealer_pt_wage_payments') is null
     or to_regclass('public.dealer_pt_wage_accrual_policies') is null
     or to_regclass('public.payroll_audit_log') is null then
    raise exception 'PT wage rate history requires dealer, attendance, wage policy, payment, and audit objects';
  end if;

  if to_regprocedure('public._pt_wage_balance(uuid)') is null
     or to_regprocedure('public.pay_part_time_balance(uuid,text,text,text,text)') is null
     or to_regprocedure('public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamp with time zone,text)') is null
     or to_regprocedure('public.set_all_approved_dealer_pt_wage_accrual(boolean,text)') is null then
    raise exception 'PT wage rate history requires the current PT wage RPC contract';
  end if;
end;
$$;

create table if not exists public.dealer_pt_wage_rate_history (
  id                uuid primary key default gen_random_uuid(),
  dealer_id         uuid not null references public.dealers(id) on delete cascade,
  hourly_rate_vnd   integer not null check (hourly_rate_vnd >= 50000),
  effective_from    timestamptz not null,
  changed_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint dealer_pt_wage_rate_history_unique_effective unique (dealer_id, effective_from)
);

create index if not exists idx_dealer_pt_wage_rate_history_dealer_effective
  on public.dealer_pt_wage_rate_history (dealer_id, effective_from);

alter table public.dealer_pt_wage_rate_history enable row level security;
revoke all on table public.dealer_pt_wage_rate_history from public, anon, authenticated;
grant select on table public.dealer_pt_wage_rate_history to service_role;

comment on table public.dealer_pt_wage_rate_history is
  'Server-only effective-dated PT hourly-rate history. It supports only forward continuous-accrual calculations; paid ledger rows remain immutable.';
comment on column public.dealer_pt_wage_payments.hourly_rate_vnd_snapshot is
  'Display rate at payment time. For effective-dated continuous accrual, the immutable accrual_policy_snapshot.rate_segments array is the detailed rate basis.';

-- Seed one baseline for every existing PT dealer before any operator can turn
-- on the global policy. The same 50,000 VND/h floor is used by the legacy
-- helper, so a NULL/zero old field cannot create an uncovered rate interval.
insert into public.dealer_pt_wage_rate_history (
  dealer_id, hourly_rate_vnd, effective_from, changed_by
)
select
  d.id,
  greatest(coalesce(d.hourly_rate_vnd, 0), 50000),
  now(),
  null
from public.dealers d
where d.employment_type = 'part_time'
on conflict (dealer_id, effective_from) do nothing;

create or replace function public.capture_dealer_pt_wage_rate_history()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rate integer;
  v_effective_from timestamptz := now();
  v_history_id uuid;
  v_should_record boolean := false;
begin
  if tg_op = 'INSERT' then
    v_should_record := new.employment_type = 'part_time';
  elsif new.employment_type = 'part_time' then
    v_should_record := old.employment_type is distinct from 'part_time'
      or new.hourly_rate_vnd is distinct from old.hourly_rate_vnd;
  end if;

  if not v_should_record then
    return new;
  end if;

  v_rate := greatest(coalesce(new.hourly_rate_vnd, 0), 50000);

  insert into public.dealer_pt_wage_rate_history as h (
    dealer_id, hourly_rate_vnd, effective_from, changed_by
  ) values (
    new.id, v_rate, v_effective_from, auth.uid()
  )
  on conflict (dealer_id, effective_from) do update
  set hourly_rate_vnd = excluded.hourly_rate_vnd,
      changed_by = excluded.changed_by
  returning h.id into v_history_id;

  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
  ) values (
    'dealer_pt_wage_rate_history',
    v_history_id,
    new.club_id,
    case when tg_op = 'INSERT' then 'INSERT' else 'UPDATE' end,
    case when tg_op = 'INSERT' then null else jsonb_build_object(
      'hourly_rate_vnd', greatest(coalesce(old.hourly_rate_vnd, 0), 50000),
      'employment_type', old.employment_type
    ) end,
    jsonb_build_object(
      'dealer_id', new.id,
      'hourly_rate_vnd', v_rate,
      'effective_from', v_effective_from,
      'employment_type', new.employment_type,
      'source', 'dealer_rate_change'
    ),
    auth.uid(),
    'PT wage rate history captured at the server transaction time'
  );

  return new;
end;
$$;

revoke all on function public.capture_dealer_pt_wage_rate_history() from public, anon, authenticated;

drop trigger if exists trg_capture_dealer_pt_wage_rate_history on public.dealers;
create trigger trg_capture_dealer_pt_wage_rate_history
after insert or update of hourly_rate_vnd, employment_type on public.dealers
for each row
execute function public.capture_dealer_pt_wage_rate_history();

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
  v_amount_vnd              numeric := 0;
  v_open_start              timestamptz;
  v_standby_accrual_enabled boolean := false;
  v_effective_from          timestamptz;
  v_current_shift_capped    boolean := false;
  v_attendance              record;
  v_rate_row                record;
  v_window_start            timestamptz;
  v_window_end              timestamptz;
  v_segment_start           timestamptz;
  v_segment_end             timestamptz;
  v_segment_minutes         numeric;
  v_rate_segments           jsonb := '[]'::jsonb;
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
  elsif v_effective_from is null then
    -- A legacy enabled/NULL row cannot reopen historical unpaid time after
    -- this forward-only migration. The global activation RPC rebases it to a
    -- persistent server timestamp before any minutes become payable.
    v_effective_from := v_now;
  end if;

  if v_standby_accrual_enabled then
    for v_attendance in
      select da.id, da.check_in_time, least(coalesce(da.check_out_time, v_now), v_now) as window_end
      from public.dealer_attendance da
      where da.dealer_id = p_dealer_id
        and da.status in ('checked_in', 'checked_out')
        and da.check_in_time is not null
        and da.check_in_time < v_now
        and coalesce(da.check_out_time, v_now) > greatest(v_anchor, v_effective_from)
      order by da.check_in_time, da.id
    loop
      v_window_start := greatest(v_attendance.check_in_time, v_anchor, v_effective_from);
      v_window_end := v_attendance.window_end;
      if v_window_end <= v_window_start then
        continue;
      end if;

      -- History is interval-based: a rate is valid from its effective_from
      -- until the next row. Missing a baseline is an explicit failure, never
      -- an implicit zero amount or a retroactive use of today's rate.
      if not exists (
        select 1
        from public.dealer_pt_wage_rate_history h
        where h.dealer_id = p_dealer_id
          and h.effective_from <= v_window_start
      ) then
        raise exception 'PT wage rate history is unavailable for this accrual window' using errcode = 'P0002';
      end if;

      for v_rate_row in
        select
          h.effective_from,
          h.hourly_rate_vnd,
          lead(h.effective_from, 1, v_window_end) over (order by h.effective_from) as next_effective_from
        from public.dealer_pt_wage_rate_history h
        where h.dealer_id = p_dealer_id
          and h.effective_from < v_window_end
        order by h.effective_from
      loop
        v_segment_start := greatest(v_window_start, v_rate_row.effective_from);
        v_segment_end := least(v_window_end, v_rate_row.next_effective_from);
        if v_segment_end <= v_segment_start then
          continue;
        end if;

        v_segment_minutes := greatest(0, extract(epoch from (v_segment_end - v_segment_start)) / 60.0);
        v_minutes := v_minutes + v_segment_minutes;
        v_amount_vnd := v_amount_vnd + (v_segment_minutes / 60.0 * v_rate_row.hourly_rate_vnd);
        v_rate_segments := v_rate_segments || jsonb_build_array(jsonb_build_object(
          'effective_from', v_rate_row.effective_from,
          'hourly_rate_vnd', v_rate_row.hourly_rate_vnd,
          'minutes', floor(v_segment_minutes)::int
        ));
      end loop;
    end loop;
  else
    select coalesce(sum(
             least(
               greatest(0, extract(epoch from (
                 least(coalesce(da.check_out_time, v_now), v_now)
                 - greatest(da.check_in_time, v_anchor)
               )) / 60.0),
               1440
             )
           ), 0)
      into v_minutes
    from public.dealer_attendance da
    where da.dealer_id = p_dealer_id
      and da.status in ('checked_in', 'checked_out')
      and da.check_in_time is not null
      and da.check_in_time < v_now
      and coalesce(da.check_out_time, v_now) > v_anchor;
    v_amount_vnd := v_minutes / 60.0 * v_rate;
  end if;

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
    'balance_vnd',                 floor(v_amount_vnd)::bigint,
    'last_reset_at',               v_anchor,
    'current_shift_open',          (v_open_start is not null),
    'current_shift_start',         v_open_start,
    'accrual_mode',                case when v_standby_accrual_enabled then 'continuous_standby' else 'capped_24h' end,
    'standby_accrual_enabled',     v_standby_accrual_enabled,
    'policy_effective_from',       v_effective_from,
    'per_attendance_cap_minutes',  case when v_standby_accrual_enabled then null else 1440 end,
    'current_shift_cap_reached',   v_current_shift_capped,
    'live_accrual_active',         v_open_start is not null and not v_current_shift_capped,
    'rate_history_applied',        v_standby_accrual_enabled,
    'rate_segments',               v_rate_segments,
    'as_of',                       v_now
  );
end;
$$;
revoke all on function public._pt_wage_balance(uuid) from public, anon, authenticated;

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
    'per_attendance_cap_minutes', v_bal->'per_attendance_cap_minutes',
    'rate_history_applied', coalesce((v_bal->>'rate_history_applied')::boolean, false),
    'rate_segments', coalesce(v_bal->'rate_segments', '[]'::jsonb)
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
  v_actor          uuid := auth.uid();
  v_existing       public.dealer_pt_wage_accrual_policies%rowtype;
  v_policy         public.dealer_pt_wage_accrual_policies%rowtype;
  v_now            timestamptz := now();
  v_effective_from timestamptz;
  v_reason         text := nullif(btrim(p_reason), '');
  v_action         text;
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
  if p_effective_from is not null and p_effective_from is distinct from v_now then
    raise exception 'effective from is assigned by the server' using errcode = '22023';
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

  -- A normal client request never supplies a timestamp. Repeating an already
  -- enabled forward policy therefore cannot slide its boundary. The global
  -- RPC passes the exact transaction timestamp only when it intentionally
  -- rebases a current club during the audited all-club activation.
  if found
     and p_standby_accrual_enabled
     and p_effective_from is null
     and v_existing.standby_accrual_enabled
     and v_existing.effective_from is not null then
    return jsonb_build_object(
      'policy_id', v_existing.id,
      'idempotent', true,
      'club_id', p_club_id,
      'standby_accrual_enabled', v_existing.standby_accrual_enabled,
      'effective_from', v_existing.effective_from,
      'updated_at', v_existing.updated_at
    );
  end if;

  v_effective_from := case
    when p_standby_accrual_enabled then coalesce(p_effective_from, v_now)
    else null
  end;

  if found
     and v_existing.standby_accrual_enabled = p_standby_accrual_enabled
     and v_existing.effective_from is not distinct from v_effective_from then
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
    v_effective_from,
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
