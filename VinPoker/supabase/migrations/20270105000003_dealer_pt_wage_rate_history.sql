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
  pt_eligible       boolean not null default true,
  effective_from    timestamptz not null,
  changed_by        uuid references auth.users(id),
  created_at        timestamptz not null default now(),
  constraint dealer_pt_wage_rate_history_unique_effective unique (dealer_id, effective_from)
);

-- The first version of this Draft migration did not carry the employment
-- boundary. Keep the column additive/replay-safe so a reapply on a disposable
-- current schema has the same contract as a first apply.
alter table public.dealer_pt_wage_rate_history
  add column if not exists pt_eligible boolean;
update public.dealer_pt_wage_rate_history
set pt_eligible = true
where pt_eligible is null;
alter table public.dealer_pt_wage_rate_history
  alter column pt_eligible set default true,
  alter column pt_eligible set not null;

create index if not exists idx_dealer_pt_wage_rate_history_dealer_effective
  on public.dealer_pt_wage_rate_history (dealer_id, effective_from);

alter table public.dealer_pt_wage_rate_history enable row level security;
revoke all on table public.dealer_pt_wage_rate_history from public, anon, authenticated;
grant select on table public.dealer_pt_wage_rate_history to service_role;

comment on table public.dealer_pt_wage_rate_history is
  'Server-only effective-dated PT rate and employment history. Every PT balance mode uses it; paid ledger rows remain immutable.';
comment on column public.dealer_pt_wage_payments.hourly_rate_vnd_snapshot is
  'Display rate at payment time. The immutable accrual_policy_snapshot.rate_segments array is the detailed effective-dated rate basis for every PT accrual mode.';

-- Seed one baseline for every existing PT dealer before any operator can turn
-- on the global policy. The same 50,000 VND/h floor is used by the legacy
-- helper, so a NULL/zero old field cannot create an uncovered rate interval.
insert into public.dealer_pt_wage_rate_history (
  dealer_id, hourly_rate_vnd, pt_eligible, effective_from, changed_by
)
select
  d.id,
  greatest(coalesce(d.hourly_rate_vnd, 0), 50000),
  true,
  now(),
  null
from public.dealers d
where d.employment_type = 'part_time'
  and not exists (
    select 1
    from public.dealer_pt_wage_rate_history h
    where h.dealer_id = d.id
      and h.pt_eligible
  );

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
  v_pt_eligible boolean := false;
begin
  if tg_op = 'INSERT' then
    v_should_record := new.employment_type = 'part_time';
    v_pt_eligible := new.employment_type = 'part_time';
  elsif old.employment_type is distinct from new.employment_type then
    -- Full-time boundaries must be explicit. Without the false row a later
    -- PT conversion could incorrectly pay the interval that was full-time.
    v_should_record := true;
    v_pt_eligible := new.employment_type = 'part_time';
  elsif new.employment_type = 'part_time'
        and new.hourly_rate_vnd is distinct from old.hourly_rate_vnd then
    v_should_record := true;
    v_pt_eligible := true;
  end if;

  if not v_should_record then
    return new;
  end if;

  v_rate := greatest(coalesce(new.hourly_rate_vnd, 0), 50000);

  insert into public.dealer_pt_wage_rate_history as h (
    dealer_id, hourly_rate_vnd, pt_eligible, effective_from, changed_by
  ) values (
    new.id, v_rate, v_pt_eligible, v_effective_from, auth.uid()
  )
  on conflict (dealer_id, effective_from) do update
  set hourly_rate_vnd = excluded.hourly_rate_vnd,
      pt_eligible = excluded.pt_eligible,
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
      'pt_eligible', v_pt_eligible,
      'effective_from', v_effective_from,
      'employment_type', new.employment_type,
      'source', case
        when tg_op = 'UPDATE' and old.employment_type is distinct from new.employment_type
          then 'dealer_employment_type_change'
        else 'dealer_rate_change'
      end
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
  v_accrued_seconds         numeric := 0;
  v_amount_vnd              numeric := 0;
  v_first_pt_rate_history   timestamptz;
  v_latest_pt_eligible      boolean;
  v_open_start              timestamptz;
  v_open_attendance_id      uuid;
  v_open_eligible_seconds   numeric := 0;
  v_standby_accrual_enabled boolean := false;
  v_effective_from          timestamptz;
  v_current_shift_capped    boolean := false;
  v_attendance              record;
  v_rate_row                record;
  v_window_start            timestamptz;
  v_window_end              timestamptz;
  v_segment_start           timestamptz;
  v_segment_end             timestamptz;
  v_segment_seconds         numeric;
  v_segment_amount_vnd      numeric;
  v_attendance_seconds      numeric;
  v_cap_seconds             numeric := 1440 * 60;
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

  select min(h.effective_from) filter (where h.pt_eligible),
         (array_agg(h.pt_eligible order by h.effective_from desc, h.id desc))[1]
    into v_first_pt_rate_history, v_latest_pt_eligible
  from public.dealer_pt_wage_rate_history h
  where h.dealer_id = p_dealer_id;

  -- A current PT dealer cannot accrue against a missing or contradicted
  -- history. Never substitute today's rate for an unknown historical period.
  if v_dealer.employment_type = 'part_time'
     and (v_first_pt_rate_history is null or v_latest_pt_eligible is distinct from true) then
    raise exception 'PT_WAGE_RATE_HISTORY_UNAVAILABLE' using errcode = 'P0002';
  end if;

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

  select da.id, da.check_in_time
    into v_open_attendance_id, v_open_start
  from public.dealer_attendance da
  where da.dealer_id = p_dealer_id
    and da.status = 'checked_in'
    and da.check_out_time is null
    and da.check_in_time is not null
  order by da.check_in_time desc
  limit 1;

  -- One effective-dated engine serves both modes. Continuous mode begins at
  -- the stored policy boundary; capped mode has no policy boundary but still
  -- uses the same rate and employment-history segments. The 24-hour cap is
  -- consumed only by PT-eligible seconds within each attendance record.
  if v_first_pt_rate_history is not null then
    for v_attendance in
      select da.id,
             da.check_in_time,
             least(coalesce(da.check_out_time, v_now), v_now) as window_end
      from public.dealer_attendance da
      where da.dealer_id = p_dealer_id
        and da.status in ('checked_in', 'checked_out')
        and da.check_in_time is not null
        and da.check_in_time < v_now
      order by da.check_in_time, da.id
    loop
      v_window_start := greatest(
        v_attendance.check_in_time,
        v_anchor,
        v_first_pt_rate_history,
        case when v_standby_accrual_enabled then v_effective_from else '-infinity'::timestamptz end
      );
      v_window_end := v_attendance.window_end;
      v_attendance_seconds := 0;
      if v_window_end <= v_window_start then
        continue;
      end if;

      for v_rate_row in
        select
          h.effective_from,
          h.hourly_rate_vnd,
          h.pt_eligible,
          lead(h.effective_from, 1, v_window_end)
            over (order by h.effective_from, h.id) as next_effective_from
        from public.dealer_pt_wage_rate_history h
        where h.dealer_id = p_dealer_id
          and h.effective_from < v_window_end
        order by h.effective_from, h.id
      loop
        v_segment_start := greatest(v_window_start, v_rate_row.effective_from);
        v_segment_end := least(v_window_end, v_rate_row.next_effective_from);
        if v_segment_end <= v_segment_start or not v_rate_row.pt_eligible then
          continue;
        end if;

        v_segment_seconds := extract(epoch from (v_segment_end - v_segment_start));
        if not v_standby_accrual_enabled then
          v_segment_seconds := least(
            v_segment_seconds,
            greatest(0, v_cap_seconds - v_attendance_seconds)
          );
          v_segment_end := v_segment_start + (v_segment_seconds * interval '1 second');
        end if;
        if v_segment_seconds <= 0 then
          continue;
        end if;

        v_segment_amount_vnd := v_segment_seconds * v_rate_row.hourly_rate_vnd / 3600;
        v_attendance_seconds := v_attendance_seconds + v_segment_seconds;
        v_accrued_seconds := v_accrued_seconds + v_segment_seconds;
        v_amount_vnd := v_amount_vnd + v_segment_amount_vnd;
        if v_attendance.id = v_open_attendance_id then
          v_open_eligible_seconds := v_open_eligible_seconds + v_segment_seconds;
        end if;

        -- Seconds and the exact per-segment contribution make the immutable
        -- payout snapshot independently reconstructable; display minutes are
        -- derived only after all segments have been totaled.
        v_rate_segments := v_rate_segments || jsonb_build_array(jsonb_build_object(
          'attendance_id', v_attendance.id,
          'segment_start', v_segment_start,
          'segment_end', v_segment_end,
          'hourly_rate_vnd', v_rate_row.hourly_rate_vnd,
          'elapsed_seconds', v_segment_seconds,
          'amount_vnd', v_segment_amount_vnd
        ));
      end loop;
    end loop;
  end if;

  v_current_shift_capped := v_open_start is not null
    and not v_standby_accrual_enabled
    and v_open_eligible_seconds >= v_cap_seconds;

  return jsonb_build_object(
    'dealer_id',                   p_dealer_id,
    'full_name',                   v_dealer.full_name,
    'employment_type',             v_dealer.employment_type,
    'club_id',                     v_dealer.club_id,
    'hourly_rate_vnd',             v_rate,
    'accrued_minutes',             floor(v_accrued_seconds / 60)::int,
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
    'first_pt_rate_history',       v_first_pt_rate_history,
    'rate_history_applied',        true,
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

-- Global enablement is unavailable until this complete contract exists. The
-- stable message is intentionally the only business error exposed to callers;
-- the transaction aborts before policy/global/audit writes when any predicate
-- below is false. Disable skips this guard so it remains an emergency
-- containment path even if later data corruption is discovered.
create or replace function public.assert_dealer_pt_wage_global_activation_ready(
  p_activation_boundary timestamptz
)
returns void
language plpgsql
stable
security definer
set search_path = public
as $$
begin
  if p_activation_boundary is null
     or to_regclass('public.dealer_pt_wage_rate_history') is null
     or to_regclass('public.dealer_pt_wage_payments') is null
     or to_regclass('public.dealer_pt_wage_accrual_global_policy') is null
     or to_regprocedure('public._pt_wage_balance(uuid)') is null
     or to_regprocedure('public.pay_part_time_balance(uuid,text,text,text,text)') is null
     or to_regprocedure('public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamp with time zone,text)') is null
     or to_regprocedure('public.set_all_approved_dealer_pt_wage_accrual(boolean,text)') is null
     or not exists (
       select 1
       from pg_attribute a
       where a.attrelid = 'public.dealer_pt_wage_payments'::regclass
         and a.attname = 'accrual_policy_snapshot'
         and not a.attisdropped
     )
     or not exists (
       select 1
       from pg_trigger t
       where t.tgrelid = 'public.dealers'::regclass
         and t.tgname = 'trg_capture_dealer_pt_wage_rate_history'
         and not t.tgisinternal
         and t.tgenabled <> 'D'
     )
     or exists (
       select 1
       from public.dealers d
       where d.employment_type = 'part_time'
         and d.deleted_at is null
         and (
           not exists (
             select 1
             from public.dealer_pt_wage_rate_history h
             where h.dealer_id = d.id
               and h.pt_eligible
               and h.effective_from <= p_activation_boundary
           )
           or coalesce((
             select h.pt_eligible
             from public.dealer_pt_wage_rate_history h
             where h.dealer_id = d.id
               and h.effective_from <= p_activation_boundary
             order by h.effective_from desc, h.id desc
             limit 1
           ), false) is not true
         )
     ) then
    raise exception 'PT_WAGE_ACTIVATION_NOT_READY' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public.assert_dealer_pt_wage_global_activation_ready(timestamptz) from public, anon, authenticated;

-- Replace the gated-but-ungranted 00002 writer only after rate-history and
-- payment snapshot readiness are present. A global enable always checks every
-- current PT dealer before taking any policy/global/audit mutation.
create or replace function public.set_all_approved_dealer_pt_wage_accrual(
  p_standby_accrual_enabled boolean,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_reason text := nullif(btrim(p_reason), '');
  v_global public.dealer_pt_wage_accrual_global_policy%rowtype;
  v_existing_policy public.dealer_pt_wage_accrual_policies%rowtype;
  v_club record;
  v_result jsonb;
  v_total integer := 0;
  v_changed integer := 0;
  v_already_at_target integer := 0;
  v_global_changed boolean := false;
  v_effective_from timestamptz := now();
begin
  if v_actor is null or not public.has_role(v_actor, 'super_admin'::app_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if p_standby_accrual_enabled is null then
    raise exception 'standby accrual enabled is required' using errcode = '22023';
  end if;
  if v_reason is null or char_length(v_reason) > 500 then
    raise exception 'a reason of at most 500 characters is required' using errcode = '22023';
  end if;

  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_global_policy'));

  select * into v_global
  from public.dealer_pt_wage_accrual_global_policy
  where singleton = true
  for update;
  if not found then
    raise exception 'global PT wage accrual policy is unavailable' using errcode = 'P0002';
  end if;

  if p_standby_accrual_enabled then
    perform public.assert_dealer_pt_wage_global_activation_ready(v_effective_from);
  end if;

  -- Deterministic UUID order matches the club-level lock order. The global
  -- lock also serializes approval-trigger defaults with this all-club action.
  for v_club in
    select c.id
    from public.clubs c
    where c.status = 'approved'
    order by c.id
  loop
    perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || v_club.id::text));
    perform 1
    from public.clubs c
    where c.id = v_club.id
      and c.status = 'approved'
    for update;
    if not found then
      continue;
    end if;

    select * into v_existing_policy
    from public.dealer_pt_wage_accrual_policies
    where club_id = v_club.id
    for update;

    if found
       and (
         (p_standby_accrual_enabled
          and v_global.future_club_enabled
          and v_existing_policy.standby_accrual_enabled
          and v_existing_policy.effective_from is not null)
         or
         (not p_standby_accrual_enabled
          and not v_existing_policy.standby_accrual_enabled)
       ) then
      v_total := v_total + 1;
      v_already_at_target := v_already_at_target + 1;
      continue;
    end if;

    v_result := public.set_dealer_pt_wage_accrual_policy(
      v_club.id,
      p_standby_accrual_enabled,
      case when p_standby_accrual_enabled then v_effective_from else null end,
      v_reason
    );
    v_total := v_total + 1;
    if coalesce((v_result->>'idempotent')::boolean, false) then
      v_already_at_target := v_already_at_target + 1;
    else
      v_changed := v_changed + 1;
    end if;
  end loop;

  if v_global.future_club_enabled is distinct from p_standby_accrual_enabled then
    update public.dealer_pt_wage_accrual_global_policy
    set future_club_enabled = p_standby_accrual_enabled,
        updated_at = now(),
        updated_by = v_actor,
        reason = v_reason
    where id = v_global.id
    returning * into v_global;

    v_global_changed := true;
    insert into public.payroll_audit_log (
      table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
    ) values (
      'dealer_pt_wage_accrual_global_policy',
      v_global.id,
      null,
      'UPDATE',
      jsonb_build_object('future_club_enabled', not p_standby_accrual_enabled),
      jsonb_build_object('future_club_enabled', p_standby_accrual_enabled),
      v_actor,
      v_reason
    );
  end if;

  return jsonb_build_object(
    'idempotent', v_changed = 0 and not v_global_changed,
    'standby_accrual_enabled', p_standby_accrual_enabled,
    'effective_from', case when p_standby_accrual_enabled then v_effective_from else null end,
    'future_club_enabled', p_standby_accrual_enabled,
    'clubs_processed', v_total,
    'clubs_changed', v_changed,
    'clubs_already_at_target', v_already_at_target
  );
end;
$$;
revoke all on function public.set_all_approved_dealer_pt_wage_accrual(boolean,text) from public, anon;

-- This is intentionally immediately before the first authenticated mutation
-- grant. A partial/corrupt baseline or a missing replacement contract aborts
-- the whole 00003 transaction instead of exposing an activation gap.
do $$
begin
  if to_regprocedure('public._pt_wage_balance(uuid)') is null
     or to_regprocedure('public.pay_part_time_balance(uuid,text,text,text,text)') is null
     or to_regprocedure('public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamp with time zone,text)') is null
     or to_regprocedure('public.set_all_approved_dealer_pt_wage_accrual(boolean,text)') is null
     or not exists (
       select 1 from pg_attribute a
       where a.attrelid = 'public.dealer_pt_wage_payments'::regclass
         and a.attname = 'accrual_policy_snapshot'
         and not a.attisdropped
     )
     or not exists (
       select 1 from pg_trigger t
       where t.tgrelid = 'public.dealers'::regclass
         and t.tgname = 'trg_capture_dealer_pt_wage_rate_history'
         and not t.tgisinternal
         and t.tgenabled <> 'D'
     )
     or exists (
       select 1
       from public.dealers d
       where d.employment_type = 'part_time'
         and d.deleted_at is null
         and (
           not exists (
             select 1
             from public.dealer_pt_wage_rate_history h
            where h.dealer_id = d.id
              and h.pt_eligible
              and h.effective_from <= now()
           )
           or coalesce((
             select h.pt_eligible
             from public.dealer_pt_wage_rate_history h
            where h.dealer_id = d.id
              and h.effective_from <= now()
             order by h.effective_from desc, h.id desc
             limit 1
           ), false) is not true
         )
     ) then
    raise exception 'PT_WAGE_ACTIVATION_NOT_READY' using errcode = 'P0001';
  end if;
end;
$$;
grant execute on function public.set_all_approved_dealer_pt_wage_accrual(boolean,text) to authenticated;

commit;
