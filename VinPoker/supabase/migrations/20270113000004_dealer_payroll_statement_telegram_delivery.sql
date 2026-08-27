-- Immutable payroll statement Telegram delivery.
--
-- CRITICAL / RED. SOURCE-ONLY until the owner-controlled rollout runbook has
-- current-schema evidence, an approved production window, and TEST-club UAT.
-- This migration creates no statement, payout, storage object, Telegram
-- message, rollout activation, or background job.
--
-- Delivery is deliberately separate from Swing notifications. The client can
-- create only an operation intent; it never supplies a Telegram destination,
-- salary amount, PDF bytes, dealer name, or storage path. Edge workers resolve
-- the immutable statement and linked Telegram account server-side.
--
-- ROLLBACK: a forward owner-reviewed migration may disable the delivery master
-- switch and revoke entrypoint grants. Never delete immutable statements,
-- PDFs, audit rows, or delivery evidence as a rollback shortcut.

begin;

do $$
begin
  if to_regclass('public.dealer_payroll_statements') is null
     or to_regclass('public.dealer_payroll_delivery_attempts') is null
     or to_regclass('public.dealer_payroll_statement_rollout') is null
     or to_regclass('public.payroll_periods') is null
     or to_regclass('public.dealers') is null
     or to_regclass('public.payroll_audit_log') is null then
    raise exception 'PAYROLL_DELIVERY_DEPENDENCY_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if to_regprocedure('public._dealer_payroll_statement_rollout_allowed(uuid)') is null
     or to_regprocedure('public._assert_dealer_payroll_statement_actor(uuid)') is null
     or to_regprocedure('public._assert_dealer_payroll_statement_finalizer(uuid)') is null then
    raise exception 'PAYROLL_DELIVERY_FUNCTION_DEPENDENCY_UNAVAILABLE' using errcode = 'P0001';
  end if;
end;
$$;

create table if not exists public.dealer_payroll_statement_delivery_rollout (
  id                  boolean primary key default true check (id = true),
  master_enabled      boolean not null default false,
  all_clubs_enabled   boolean not null default false,
  allowed_club_ids    uuid[] not null default '{}'::uuid[],
  updated_at          timestamptz not null default now(),
  updated_by          uuid references auth.users(id)
);

insert into public.dealer_payroll_statement_delivery_rollout (id)
values (true)
on conflict (id) do nothing;

create table if not exists public.dealer_payroll_delivery_operations (
  id                  uuid primary key default gen_random_uuid(),
  club_id             uuid not null references public.clubs(id),
  payroll_period_id   uuid not null references public.payroll_periods(id),
  request_id          uuid not null,
  requested_by        uuid not null references auth.users(id),
  state               text not null default 'ready'
    check (state in ('ready', 'dispatching', 'completed', 'partial', 'blocked')),
  created_at          timestamptz not null default now(),
  started_at          timestamptz,
  completed_at        timestamptz,
  updated_at          timestamptz not null default now(),
  unique (club_id, request_id)
);

create index if not exists dealer_payroll_delivery_operations_club_period_idx
  on public.dealer_payroll_delivery_operations (club_id, payroll_period_id, created_at desc);
create unique index if not exists dealer_payroll_delivery_operations_active_club_period_uq
  on public.dealer_payroll_delivery_operations (club_id, payroll_period_id)
  where state in ('ready', 'dispatching');

create table if not exists public.dealer_payroll_delivery_targets (
  id                  uuid primary key default gen_random_uuid(),
  operation_id        uuid not null references public.dealer_payroll_delivery_operations(id),
  club_id             uuid not null references public.clubs(id),
  statement_id        uuid not null references public.dealer_payroll_statements(id),
  dealer_id           uuid not null references public.dealers(id),
  channel             text not null default 'telegram' check (channel = 'telegram'),
  delivery_state      text not null default 'pending'
    check (delivery_state in ('pending', 'sending', 'sent', 'failed', 'unknown', 'skipped')),
  idempotency_key     uuid not null,
  dispatch_token      uuid,
  dispatch_started_at timestamptz,
  attempt_count       integer not null default 0 check (attempt_count >= 0),
  provider_code       text,
  retry_after_at      timestamptz,
  sent_at             timestamptz,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (operation_id, statement_id),
  unique (statement_id, channel, idempotency_key)
);

create unique index if not exists dealer_payroll_delivery_targets_active_statement_channel_uq
  on public.dealer_payroll_delivery_targets (statement_id, channel)
  where delivery_state in ('pending', 'sending', 'sent', 'unknown');
create index if not exists dealer_payroll_delivery_targets_operation_state_idx
  on public.dealer_payroll_delivery_targets (operation_id, delivery_state, created_at);

alter table public.dealer_payroll_delivery_attempts
  add column if not exists operation_id uuid references public.dealer_payroll_delivery_operations(id),
  add column if not exists target_id uuid references public.dealer_payroll_delivery_targets(id);
alter table public.dealer_payroll_delivery_attempts
  drop constraint if exists dealer_payroll_delivery_attempts_status_check;
alter table public.dealer_payroll_delivery_attempts
  add constraint dealer_payroll_delivery_attempts_status_check
  check (status in ('pending', 'sent', 'failed', 'unknown')) not valid;
alter table public.dealer_payroll_delivery_attempts
  validate constraint dealer_payroll_delivery_attempts_status_check;
create unique index if not exists dealer_payroll_delivery_attempts_target_uq
  on public.dealer_payroll_delivery_attempts (target_id)
  where target_id is not null;

alter table public.dealer_payroll_statement_delivery_rollout enable row level security;
alter table public.dealer_payroll_delivery_operations enable row level security;
alter table public.dealer_payroll_delivery_targets enable row level security;
alter table public.dealer_payroll_statement_delivery_rollout force row level security;
alter table public.dealer_payroll_delivery_operations force row level security;
alter table public.dealer_payroll_delivery_targets force row level security;

revoke all on table public.dealer_payroll_statement_delivery_rollout from public, anon, authenticated;
revoke all on table public.dealer_payroll_delivery_operations from public, anon, authenticated;
revoke all on table public.dealer_payroll_delivery_targets from public, anon, authenticated;
grant select, update on table public.dealer_payroll_statement_delivery_rollout to service_role;
grant select, insert, update on table public.dealer_payroll_delivery_operations,
  public.dealer_payroll_delivery_targets to service_role;

create or replace function public._dealer_payroll_statement_delivery_allowed(p_club_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean := false;
begin
  if p_club_id is null or not public._dealer_payroll_statement_rollout_allowed(p_club_id) then
    return false;
  end if;

  select r.master_enabled and (
    r.all_clubs_enabled or p_club_id = any(r.allowed_club_ids)
  )
  into v_allowed
  from public.dealer_payroll_statement_delivery_rollout r
  where r.id = true;

  return coalesce(v_allowed, false);
exception when others then
  return false;
end;
$$;
revoke all on function public._dealer_payroll_statement_delivery_allowed(uuid) from public, anon, authenticated;

create or replace function public._assert_dealer_payroll_statement_delivery_rollout(p_club_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public._dealer_payroll_statement_delivery_allowed(p_club_id) then
    raise exception 'PAYROLL_DELIVERY_ROLLOUT_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public._assert_dealer_payroll_statement_delivery_rollout(uuid) from public, anon, authenticated;

create or replace function public.get_dealer_payroll_statement_delivery_rollout(p_expected_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_master boolean := false;
  v_all boolean := false;
  v_allowlisted boolean := false;
  v_statement_allowed boolean := false;
begin
  perform public._assert_dealer_payroll_statement_actor(p_expected_club_id);
  v_statement_allowed := public._dealer_payroll_statement_rollout_allowed(p_expected_club_id);
  select r.master_enabled, r.all_clubs_enabled,
         p_expected_club_id = any(r.allowed_club_ids)
  into v_master, v_all, v_allowlisted
  from public.dealer_payroll_statement_delivery_rollout r
  where r.id = true;

  return jsonb_build_object(
    'allowed', v_statement_allowed and coalesce(v_master, false)
      and (coalesce(v_all, false) or coalesce(v_allowlisted, false)),
    'master_enabled', coalesce(v_master, false),
    'statement_rollout_allowed', v_statement_allowed,
    'all_clubs_enabled', coalesce(v_all, false),
    'allowlisted', coalesce(v_allowlisted, false),
    'reason', case
      when not v_statement_allowed then 'STATEMENT_ROLLOUT_DISABLED'
      when not coalesce(v_master, false) then 'MASTER_OFF'
      when coalesce(v_all, false) or coalesce(v_allowlisted, false) then 'ENABLED'
      else 'CLUB_NOT_ALLOWLISTED'
    end
  );
exception when others then
  if sqlstate = '42501' then raise; end if;
  return jsonb_build_object(
    'allowed', false, 'master_enabled', false, 'statement_rollout_allowed', false,
    'all_clubs_enabled', false, 'allowlisted', false, 'reason', 'ROLLOUT_UNAVAILABLE'
  );
end;
$$;
revoke all on function public.get_dealer_payroll_statement_delivery_rollout(uuid) from public, anon;
grant execute on function public.get_dealer_payroll_statement_delivery_rollout(uuid) to authenticated, service_role;

create or replace function public._refresh_dealer_payroll_delivery_operation(p_operation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.dealer_payroll_delivery_operations%rowtype;
  v_pending integer := 0;
  v_sending integer := 0;
  v_sent integer := 0;
  v_failed integer := 0;
  v_unknown integer := 0;
  v_skipped integer := 0;
  v_unlinked integer := 0;
  v_pdf_not_ready integer := 0;
  v_state text;
begin
  select * into v_operation
  from public.dealer_payroll_delivery_operations
  where id = p_operation_id
  for update;
  if not found then
    raise exception 'PAYROLL_DELIVERY_OPERATION_NOT_FOUND' using errcode = 'P0002';
  end if;

  -- A worker can terminate after it claims a target but before it receives a
  -- Telegram receipt. This must never become a new automatic send. Mark the
  -- stale claim unknown, preserve its receipt evidence, and require manual
  -- reconciliation before any future correction path.
  with stale_targets as (
    update public.dealer_payroll_delivery_targets
    set delivery_state = 'unknown',
        provider_code = 'TELEGRAM_DISPATCH_UNCONFIRMED',
        updated_at = now()
    where operation_id = p_operation_id
      and delivery_state = 'sending'
      and dispatch_started_at < now() - interval '5 minutes'
    returning *
  )
  insert into public.dealer_payroll_delivery_attempts (
    statement_id, channel, attempt_no, idempotency_key, pdf_hash,
    status, provider_code, attempted_at, completed_at, operation_id, target_id
  )
  select
    t.statement_id, t.channel, t.attempt_count, t.idempotency_key, s.pdf_hash,
    'unknown', t.provider_code, coalesce(t.dispatch_started_at, now()), now(),
    t.operation_id, t.id
  from stale_targets t
  join public.dealer_payroll_statements s on s.id = t.statement_id
  on conflict (target_id) where target_id is not null do nothing;

  select
    count(*) filter (where t.delivery_state = 'pending'),
    count(*) filter (where t.delivery_state = 'sending'),
    count(*) filter (where t.delivery_state = 'sent'),
    count(*) filter (where t.delivery_state = 'failed'),
    count(*) filter (where t.delivery_state = 'unknown'),
    count(*) filter (where t.delivery_state = 'skipped')
  into v_pending, v_sending, v_sent, v_failed, v_unknown, v_skipped
  from public.dealer_payroll_delivery_targets t
  where t.operation_id = p_operation_id;

  select
    count(*) filter (where t.provider_code = 'PAYROLL_DELIVERY_TELEGRAM_UNLINKED'),
    count(*) filter (where t.provider_code = 'PAYROLL_DELIVERY_PDF_NOT_READY')
  into v_unlinked, v_pdf_not_ready
  from public.dealer_payroll_delivery_targets t
  where t.operation_id = p_operation_id;

  v_state := case
    when v_unknown > 0 or v_failed > 0 then 'partial'
    when v_sending > 0 then 'dispatching'
    when v_pending > 0 then 'ready'
    else 'completed'
  end;

  update public.dealer_payroll_delivery_operations o
  set state = v_state,
      started_at = case when v_state = 'dispatching' then coalesce(o.started_at, now()) else o.started_at end,
      completed_at = case when v_state in ('completed', 'partial') then now() else null end,
      updated_at = now()
  where o.id = p_operation_id;

  return jsonb_build_object(
    'operation_id', p_operation_id,
    'state', v_state,
    'pending_count', v_pending,
    'sending_count', v_sending,
    'sent_count', v_sent,
    'failed_count', v_failed,
    'unknown_count', v_unknown,
    'skipped_count', v_skipped,
    'telegram_unlinked_count', v_unlinked,
    'pdf_not_ready_count', v_pdf_not_ready,
    'total_count', v_pending + v_sending + v_sent + v_failed + v_unknown + v_skipped
  );
end;
$$;
revoke all on function public._refresh_dealer_payroll_delivery_operation(uuid) from public, anon, authenticated;

create or replace function public.create_dealer_payroll_statement_delivery_operation(
  p_request_id uuid,
  p_club_id uuid,
  p_payroll_period_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_existing public.dealer_payroll_delivery_operations%rowtype;
  v_active public.dealer_payroll_delivery_operations%rowtype;
  v_operation_id uuid;
  v_target record;
  v_state text;
  v_code text;
begin
  if p_request_id is null or p_club_id is null or p_payroll_period_id is null then
    raise exception 'PAYROLL_DELIVERY_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  perform public._assert_dealer_payroll_statement_delivery_rollout(p_club_id);
  v_actor := public._assert_dealer_payroll_statement_finalizer(p_club_id);
  perform pg_advisory_xact_lock(hashtextextended(
    'payroll-delivery:' || p_club_id::text || ':' || p_payroll_period_id::text, 0
  ));

  select * into v_existing
  from public.dealer_payroll_delivery_operations
  where club_id = p_club_id and request_id = p_request_id
  for update;
  if found then
    if v_existing.payroll_period_id <> p_payroll_period_id then
      raise exception 'PAYROLL_DELIVERY_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return public._refresh_dealer_payroll_delivery_operation(v_existing.id)
      || jsonb_build_object('idempotent', true);
  end if;

  select * into v_active
  from public.dealer_payroll_delivery_operations
  where club_id = p_club_id
    and payroll_period_id = p_payroll_period_id
    and state in ('ready', 'dispatching')
  order by created_at, id
  limit 1
  for update;
  if found then
    return public._refresh_dealer_payroll_delivery_operation(v_active.id)
      || jsonb_build_object('idempotent', true, 'resumed', true);
  end if;

  if not exists (
    select 1 from public.payroll_periods p
    where p.id = p_payroll_period_id and p.club_id = p_club_id
  ) then
    raise exception 'PAYROLL_DELIVERY_PERIOD_NOT_FOUND' using errcode = 'P0002';
  end if;

  insert into public.dealer_payroll_delivery_operations (
    club_id, payroll_period_id, request_id, requested_by
  ) values (
    p_club_id, p_payroll_period_id, p_request_id, v_actor
  ) returning id into v_operation_id;

  for v_target in
    select
      s.id as statement_id,
      s.dealer_id,
      s.state as statement_state,
      s.pdf_status,
      coalesce(nullif(to_jsonb(d) ->> 'telegram_user_id', ''), '') as telegram_user_id,
      exists (
        select 1 from public.dealer_payroll_delivery_targets prior
        where prior.statement_id = s.id
          and prior.channel = 'telegram'
          and prior.delivery_state in ('pending', 'sending', 'sent', 'unknown')
      ) as already_active
    from public.dealer_payroll_statements s
    join public.dealers d on d.id = s.dealer_id and d.club_id = s.club_id
    where s.club_id = p_club_id
      and s.payroll_period_id = p_payroll_period_id
      and s.statement_kind = 'full_time_period'
      and s.state in ('pdf_rendered', 'delivery_failed')
      and s.state not in ('voided', 'replaced')
    order by s.dealer_id, s.id
    for update of s
  loop
    v_state := case
      when v_target.pdf_status <> 'ready' then 'skipped'
      when v_target.telegram_user_id = '' then 'skipped'
      when v_target.already_active then 'skipped'
      else 'pending'
    end;
    v_code := case
      when v_target.pdf_status <> 'ready' then 'PAYROLL_DELIVERY_PDF_NOT_READY'
      when v_target.telegram_user_id = '' then 'PAYROLL_DELIVERY_TELEGRAM_UNLINKED'
      when v_target.already_active then 'PAYROLL_DELIVERY_ALREADY_ACTIVE'
      else null
    end;

    insert into public.dealer_payroll_delivery_targets (
      operation_id, club_id, statement_id, dealer_id, delivery_state,
      idempotency_key, provider_code
    ) values (
      v_operation_id, p_club_id, v_target.statement_id, v_target.dealer_id,
      v_state, gen_random_uuid(), v_code
    );
  end loop;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_payroll_delivery_operations', v_operation_id, p_club_id, 'INSERT',
    jsonb_build_object('payroll_period_id', p_payroll_period_id), v_actor,
    'Immutable payroll statement Telegram delivery operation created'
  );

  return public._refresh_dealer_payroll_delivery_operation(v_operation_id)
    || jsonb_build_object('idempotent', false);
end;
$$;
revoke all on function public.create_dealer_payroll_statement_delivery_operation(uuid,uuid,uuid) from public, anon;
grant execute on function public.create_dealer_payroll_statement_delivery_operation(uuid,uuid,uuid) to authenticated, service_role;

create or replace function public.get_dealer_payroll_statement_delivery_operation(p_operation_id uuid)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.dealer_payroll_delivery_operations%rowtype;
begin
  select * into v_operation
  from public.dealer_payroll_delivery_operations
  where id = p_operation_id;
  if not found then
    raise exception 'PAYROLL_DELIVERY_OPERATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public._assert_dealer_payroll_statement_actor(v_operation.club_id);
  return public._refresh_dealer_payroll_delivery_operation(p_operation_id);
end;
$$;
revoke all on function public.get_dealer_payroll_statement_delivery_operation(uuid) from public, anon;
grant execute on function public.get_dealer_payroll_statement_delivery_operation(uuid) to authenticated, service_role;

create or replace function public.claim_dealer_payroll_statement_delivery_target(
  p_operation_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_operation public.dealer_payroll_delivery_operations%rowtype;
  v_target public.dealer_payroll_delivery_targets%rowtype;
  v_statement public.dealer_payroll_statements%rowtype;
  v_token uuid := gen_random_uuid();
begin
  select * into v_operation
  from public.dealer_payroll_delivery_operations
  where id = p_operation_id
  for update;
  if not found then
    raise exception 'PAYROLL_DELIVERY_OPERATION_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public._assert_dealer_payroll_statement_delivery_rollout(v_operation.club_id);

  select * into v_target
  from public.dealer_payroll_delivery_targets
  where operation_id = p_operation_id and delivery_state = 'pending'
  order by created_at, id
  for update skip locked
  limit 1;
  if not found then
    return jsonb_build_object('claimed', false, 'summary', public._refresh_dealer_payroll_delivery_operation(p_operation_id));
  end if;

  select * into v_statement
  from public.dealer_payroll_statements
  where id = v_target.statement_id and club_id = v_operation.club_id
  for update;
  if not found
     or v_statement.state not in ('pdf_rendered', 'delivery_failed')
     or v_statement.pdf_status <> 'ready'
     or v_statement.pdf_storage_path is null
     or v_statement.pdf_hash is null then
    update public.dealer_payroll_delivery_targets
    set delivery_state = 'skipped', provider_code = 'PAYROLL_DELIVERY_PDF_NOT_READY', updated_at = now()
    where id = v_target.id;
    return jsonb_build_object('claimed', false, 'summary', public._refresh_dealer_payroll_delivery_operation(p_operation_id));
  end if;

  update public.dealer_payroll_delivery_targets
  set delivery_state = 'sending',
      dispatch_token = v_token,
      dispatch_started_at = now(),
      attempt_count = attempt_count + 1,
      updated_at = now()
  where id = v_target.id;

  return jsonb_build_object(
    'claimed', true,
    'target_id', v_target.id,
    'dispatch_token', v_token,
    'statement_id', v_statement.id,
    'dealer_id', v_statement.dealer_id,
    'club_id', v_operation.club_id,
    'storage_path', v_statement.pdf_storage_path,
    'pdf_hash', v_statement.pdf_hash,
    'renderer_version', v_statement.pdf_render_version
  );
end;
$$;
revoke all on function public.claim_dealer_payroll_statement_delivery_target(uuid) from public, anon, authenticated;
grant execute on function public.claim_dealer_payroll_statement_delivery_target(uuid) to service_role;

create or replace function public.complete_dealer_payroll_statement_delivery_target(
  p_target_id uuid,
  p_dispatch_token uuid,
  p_pdf_hash text,
  p_provider_code text default 'TELEGRAM_SENT'
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.dealer_payroll_delivery_targets%rowtype;
  v_operation public.dealer_payroll_delivery_operations%rowtype;
begin
  if p_target_id is null or p_dispatch_token is null
     or p_pdf_hash !~ '^[0-9a-f]{64}$'
     or p_provider_code !~ '^TELEGRAM_[A-Z0-9_]{2,80}$' then
    raise exception 'PAYROLL_DELIVERY_INVALID_RECEIPT' using errcode = 'P0001';
  end if;
  select * into v_target
  from public.dealer_payroll_delivery_targets
  where id = p_target_id
  for update;
  if not found or v_target.delivery_state <> 'sending' or v_target.dispatch_token <> p_dispatch_token then
    raise exception 'PAYROLL_DELIVERY_CLAIM_CONFLICT' using errcode = 'P0001';
  end if;
  if v_target.channel <> 'telegram' then
    raise exception 'PAYROLL_DELIVERY_CHANNEL_UNSUPPORTED' using errcode = 'P0001';
  end if;

  update public.dealer_payroll_delivery_targets
  set delivery_state = 'sent', provider_code = p_provider_code, sent_at = now(), updated_at = now()
  where id = p_target_id;
  update public.dealer_payroll_statements
  set state = 'sent'
  where id = v_target.statement_id and state in ('pdf_rendered', 'delivery_failed');

  select * into v_operation from public.dealer_payroll_delivery_operations where id = v_target.operation_id;
  insert into public.dealer_payroll_delivery_attempts (
    statement_id, channel, attempt_no, idempotency_key, pdf_hash,
    status, provider_code, attempted_at, completed_at, operation_id, target_id
  ) values (
    v_target.statement_id, 'telegram', v_target.attempt_count, v_target.idempotency_key, p_pdf_hash,
    'sent', p_provider_code, now(), now(), v_target.operation_id, v_target.id
  );
  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_payroll_statements', v_target.statement_id, v_operation.club_id, 'UPDATE',
    jsonb_build_object('delivery_channel', 'telegram', 'provider_code', p_provider_code), v_operation.requested_by,
    'Immutable payroll statement Telegram delivery completed'
  );
  return public._refresh_dealer_payroll_delivery_operation(v_target.operation_id);
end;
$$;
revoke all on function public.complete_dealer_payroll_statement_delivery_target(uuid,uuid,text,text) from public, anon, authenticated;
grant execute on function public.complete_dealer_payroll_statement_delivery_target(uuid,uuid,text,text) to service_role;

create or replace function public.fail_dealer_payroll_statement_delivery_target(
  p_target_id uuid,
  p_dispatch_token uuid,
  p_provider_code text,
  p_outcome text default 'failed',
  p_retry_after_seconds integer default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_target public.dealer_payroll_delivery_targets%rowtype;
begin
  if p_target_id is null or p_dispatch_token is null
     or p_outcome not in ('failed', 'unknown')
     or p_provider_code !~ '^TELEGRAM_[A-Z0-9_]{2,80}$'
     or (p_retry_after_seconds is not null and (p_retry_after_seconds < 1 or p_retry_after_seconds > 86400)) then
    raise exception 'PAYROLL_DELIVERY_INVALID_FAILURE' using errcode = 'P0001';
  end if;
  select * into v_target
  from public.dealer_payroll_delivery_targets
  where id = p_target_id
  for update;
  if not found or v_target.delivery_state <> 'sending' or v_target.dispatch_token <> p_dispatch_token then
    raise exception 'PAYROLL_DELIVERY_CLAIM_CONFLICT' using errcode = 'P0001';
  end if;
  update public.dealer_payroll_delivery_targets
  set delivery_state = p_outcome,
      provider_code = p_provider_code,
      retry_after_at = case when p_retry_after_seconds is null then null else now() + make_interval(secs => p_retry_after_seconds) end,
      updated_at = now()
  where id = p_target_id;
  insert into public.dealer_payroll_delivery_attempts (
    statement_id, channel, attempt_no, idempotency_key, pdf_hash,
    status, provider_code, attempted_at, completed_at, operation_id, target_id
  )
  select
    v_target.statement_id, v_target.channel, v_target.attempt_count, v_target.idempotency_key,
    s.pdf_hash, p_outcome, p_provider_code, coalesce(v_target.dispatch_started_at, now()), now(),
    v_target.operation_id, v_target.id
  from public.dealer_payroll_statements s
  where s.id = v_target.statement_id
  on conflict (target_id) where target_id is not null do nothing;
  return public._refresh_dealer_payroll_delivery_operation(v_target.operation_id);
end;
$$;
revoke all on function public.fail_dealer_payroll_statement_delivery_target(uuid,uuid,text,text,integer) from public, anon, authenticated;
grant execute on function public.fail_dealer_payroll_statement_delivery_target(uuid,uuid,text,text,integer) to service_role;

commit;
