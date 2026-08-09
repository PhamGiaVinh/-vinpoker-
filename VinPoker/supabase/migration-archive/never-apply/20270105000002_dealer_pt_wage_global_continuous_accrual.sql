-- Global PT dealer continuous-accrual control.
--
-- 20270105000001 introduced the audited per-club policy. This forward-only
-- migration adds one server-authoritative action that can apply that existing
-- contract to every approved club from one server-captured activation instant.
-- It also stores the default used when a club later becomes approved. The
-- migration itself is deliberately dark: only the authenticated super-admin
-- RPC below can enable either scope.
--
-- Financial invariants:
--   * saved payout rows remain immutable and are never updated here;
--   * only the existing derived unpaid-balance read changes after enablement;
--   * all-club enablement starts at a server-captured effective boundary;
--   * one super-admin transaction updates current approved clubs and the
--     future-club default together, with per-club and global audit records;
--   * setting the same state again is idempotent and writes no duplicate audit.

begin;

do $$
begin
  if to_regclass('public.clubs') is null
     or to_regclass('public.dealer_pt_wage_accrual_policies') is null
     or to_regclass('public.payroll_audit_log') is null then
    raise exception 'global PT wage accrual requires clubs, per-club policy, and payroll audit tables';
  end if;

  if to_regprocedure('public.set_dealer_pt_wage_accrual_policy(uuid,boolean,timestamp with time zone,text)') is null then
    raise exception 'global PT wage accrual requires the per-club policy RPC';
  end if;
end;
$$;

create table if not exists public.dealer_pt_wage_accrual_global_policy (
  id                        uuid primary key default gen_random_uuid(),
  singleton                 boolean not null unique default true check (singleton),
  future_club_enabled       boolean not null default false,
  updated_at                timestamptz not null default now(),
  updated_by                uuid references auth.users(id),
  reason                    text,
  constraint dealer_pt_wage_accrual_global_policy_reason_length
    check (reason is null or char_length(reason) <= 500)
);

alter table public.dealer_pt_wage_accrual_global_policy enable row level security;
revoke all on table public.dealer_pt_wage_accrual_global_policy from public, anon, authenticated;
grant select on table public.dealer_pt_wage_accrual_global_policy to service_role;

insert into public.dealer_pt_wage_accrual_global_policy (
  singleton, future_club_enabled, reason
) values (
  true,
  false,
  'Migration default: future clubs remain capped until a super-admin enables the global PT accrual policy.'
)
on conflict (singleton) do nothing;

comment on table public.dealer_pt_wage_accrual_global_policy is
  'Singleton server-only control for the PT wage policy assigned automatically when a club becomes approved. Default is off until an audited super-admin action.';

create or replace function public.initialize_dealer_pt_wage_accrual_for_approved_club()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_future_club_enabled boolean := false;
  v_policy_id uuid;
begin
  if new.status <> 'approved' then
    return new;
  end if;

  if tg_op = 'UPDATE' and old.status = 'approved' then
    return new;
  end if;

  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_global_policy'));

  select future_club_enabled
    into v_future_club_enabled
  from public.dealer_pt_wage_accrual_global_policy
  where singleton = true
  for share;

  if coalesce(v_future_club_enabled, false) is not true then
    return new;
  end if;

  insert into public.dealer_pt_wage_accrual_policies (
    club_id, standby_accrual_enabled, effective_from, updated_at, updated_by, reason
  ) values (
    new.id,
    true,
    now(),
    now(),
    null,
    'System default: global PT continuous accrual was enabled when this club became approved.'
  )
  on conflict (club_id) do nothing
  returning id into v_policy_id;

  if v_policy_id is not null then
    insert into public.payroll_audit_log (
      table_name, record_id, club_id, action, old_values, new_values, changed_by, reason
    ) values (
      'dealer_pt_wage_accrual_policies',
      v_policy_id,
      new.id,
      'INSERT',
      null,
      jsonb_build_object(
        'standby_accrual_enabled', true,
        'effective_from', now(),
        'source', 'global_future_club_default'
      ),
      null,
      'System default: global PT continuous accrual was enabled when this club became approved.'
    );
  end if;

  return new;
end;
$$;

revoke all on function public.initialize_dealer_pt_wage_accrual_for_approved_club() from public, anon, authenticated;

drop trigger if exists trg_initialize_dealer_pt_wage_accrual_for_approved_club on public.clubs;
create trigger trg_initialize_dealer_pt_wage_accrual_for_approved_club
after insert or update of status on public.clubs
for each row
execute function public.initialize_dealer_pt_wage_accrual_for_approved_club();

create or replace function public.get_dealer_pt_wage_global_accrual_policy()
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_policy public.dealer_pt_wage_accrual_global_policy%rowtype;
begin
  if v_actor is null or not public.has_role(v_actor, 'super_admin'::app_role) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select * into v_policy
  from public.dealer_pt_wage_accrual_global_policy
  where singleton = true;

  if not found then
    raise exception 'global PT wage accrual policy is unavailable' using errcode = 'P0002';
  end if;

  return jsonb_build_object(
    'future_club_enabled', v_policy.future_club_enabled,
    'updated_at', v_policy.updated_at
  );
end;
$$;

revoke all on function public.get_dealer_pt_wage_global_accrual_policy() from public, anon;
grant execute on function public.get_dealer_pt_wage_global_accrual_policy() to authenticated;

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

  -- This same lock is taken by the club-approval trigger. It makes the
  -- current-club batch and the future-club default one atomic policy choice.
  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_global_policy'));

  select * into v_global
  from public.dealer_pt_wage_accrual_global_policy
  where singleton = true
  for update;
  if not found then
    raise exception 'global PT wage accrual policy is unavailable' using errcode = 'P0002';
  end if;

  -- UUID order is deterministic. Each club uses the pre-existing policy lock
  -- order (advisory lock, then row lock), so a concurrent per-club change
  -- cannot deadlock the all-club operation.
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

    -- A repeated all-club request must not move the activation boundary or
    -- write another audit row. The first global enable deliberately rebases
    -- even a legacy enabled/NULL policy at this transaction's server time.
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
grant execute on function public.set_all_approved_dealer_pt_wage_accrual(boolean,text) to authenticated;

commit;
