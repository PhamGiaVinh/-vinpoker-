-- Dealer payroll statements v1: immutable payroll evidence and PT settlement holds.
--
-- CRITICAL / RED. SOURCE-ONLY until the owner-controlled apply runbook has a
-- current-schema PG16/17 proof and TEST-club UAT. This migration intentionally
-- creates no statement, payout, delivery, storage object, policy activation, or
-- background job. It only adds server-authoritative contracts.
--
-- Money model:
--   * FT statements snapshot a dealer_payroll row only while its period is locked.
--     They never call a calculator or alter a payroll-period payment record.
--   * PT statements lock the dealer and policy, snapshot the effective-dated
--     balance through a server cutoff, and reserve that exact interval.
--   * A PT statement is paid only through pay_finalized_part_time_statement(),
--     which writes the frozen snapshot without re-running _pt_wage_balance().
--   * Finalized records are append-only. A correction voids an unpaid statement
--     and a later statement links back as its replacement; a paid row is never
--     rewritten or deleted.
--
-- PDF, private storage, frontend controls, Telegram delivery, and policy/flag
-- activation are deliberately out of scope for this migration.
--
-- ROLLBACK: use a new owner-reviewed forward migration to revoke the public
-- mutation RPCs and leave immutable history intact. Never delete statements,
-- reservations, or paid ledger rows as a rollback shortcut.

begin;

do $$
begin
  if to_regclass('public.clubs') is null
     or to_regclass('public.dealers') is null
     or to_regclass('public.dealer_payroll') is null
     or to_regclass('public.payroll_periods') is null
     or to_regclass('public.payment_records') is null
     or to_regclass('public.payroll_audit_log') is null
     or to_regclass('public.club_cashiers') is null
     or to_regclass('public.dealer_attendance') is null
     or to_regclass('public.dealer_pt_wage_payments') is null
     or to_regclass('public.dealer_pt_wage_rate_history') is null
     or to_regclass('public.dealer_pt_wage_accrual_policies') is null then
    raise exception 'PAYROLL_STATEMENT_DEPENDENCY_UNAVAILABLE' using errcode = 'P0001';
  end if;

  if to_regprocedure('public._pt_wage_balance(uuid)') is null
     or to_regprocedure('public.pay_part_time_balance(uuid,text,text,text,text)') is null
     or to_regprocedure('public.has_role(uuid,public.app_role)') is null
     or to_regprocedure('extensions.digest(bytea,text)') is null then
    raise exception 'PAYROLL_STATEMENT_FUNCTION_DEPENDENCY_UNAVAILABLE' using errcode = 'P0001';
  end if;
end;
$$;

create table if not exists public.dealer_payroll_statements (
  id                         uuid primary key default gen_random_uuid(),
  club_id                    uuid not null references public.clubs(id),
  dealer_id                  uuid not null references public.dealers(id),
  statement_kind             text not null
    check (statement_kind in ('full_time_period', 'part_time_settlement')),
  state                      text not null default 'finalized'
    check (state in ('draft', 'previewed', 'finalized', 'pdf_rendered', 'sent', 'delivery_failed', 'voided', 'replaced')),
  request_id                 uuid not null,
  payroll_period_id          uuid references public.payroll_periods(id),
  source_dealer_payroll_id   uuid references public.dealer_payroll(id),
  payment_record_id          uuid references public.payment_records(id),
  pt_wage_payment_id         uuid references public.dealer_pt_wage_payments(id),
  replaces_statement_id      uuid references public.dealer_payroll_statements(id),
  replaced_by_statement_id   uuid references public.dealer_payroll_statements(id),
  cutoff_at                  timestamptz,
  gross_amount_vnd           bigint not null default 0,
  deduction_amount_vnd       bigint not null default 0,
  net_amount_vnd             bigint not null,
  source_snapshot            jsonb not null,
  dealer_snapshot            jsonb not null,
  club_snapshot              jsonb not null,
  financial_snapshot         jsonb not null,
  source_fingerprint         text not null check (source_fingerprint ~ '^[0-9a-f]{64}$'),
  statement_hash             text not null check (statement_hash ~ '^[0-9a-f]{64}$'),
  finalized_by               uuid not null references auth.users(id),
  finalized_at               timestamptz not null default now(),
  voided_by                  uuid references auth.users(id),
  voided_at                  timestamptz,
  void_reason                text,
  constraint dealer_payroll_statements_source_shape check (
    (statement_kind = 'full_time_period'
      and payroll_period_id is not null
      and source_dealer_payroll_id is not null
      and cutoff_at is null)
    or
    (statement_kind = 'part_time_settlement'
      and payroll_period_id is null
      and source_dealer_payroll_id is null
      and cutoff_at is not null)
  ),
  constraint dealer_payroll_statements_void_shape check (
    (state not in ('voided', 'replaced') and voided_at is null and voided_by is null and void_reason is null)
    or
    (state in ('voided', 'replaced') and voided_at is not null and voided_by is not null and nullif(btrim(void_reason), '') is not null)
  )
);

create unique index if not exists dealer_payroll_statements_club_request_uq
  on public.dealer_payroll_statements (club_id, request_id);
create unique index if not exists dealer_payroll_statements_active_ft_source_uq
  on public.dealer_payroll_statements (source_dealer_payroll_id)
  where source_dealer_payroll_id is not null and state not in ('voided', 'replaced');
create index if not exists dealer_payroll_statements_club_dealer_finalized_idx
  on public.dealer_payroll_statements (club_id, dealer_id, finalized_at desc);

create table if not exists public.dealer_payroll_statement_lines (
  id                 uuid primary key default gen_random_uuid(),
  statement_id       uuid not null references public.dealer_payroll_statements(id),
  line_no            integer not null check (line_no > 0),
  line_type          text not null check (line_type in ('earning', 'deduction', 'adjustment', 'rate_segment')),
  line_code          text not null check (char_length(line_code) between 1 and 80),
  label              text not null check (char_length(label) between 1 and 200),
  quantity           numeric,
  unit               text,
  unit_rate_vnd      bigint,
  amount_vnd         bigint not null,
  source_snapshot    jsonb not null default '{}'::jsonb,
  created_at         timestamptz not null default now(),
  unique (statement_id, line_no)
);

create table if not exists public.dealer_payroll_delivery_attempts (
  id                 uuid primary key default gen_random_uuid(),
  statement_id       uuid not null references public.dealer_payroll_statements(id),
  channel            text not null check (channel in ('telegram')),
  attempt_no         integer not null check (attempt_no > 0),
  idempotency_key    uuid not null,
  pdf_hash           text check (pdf_hash is null or pdf_hash ~ '^[0-9a-f]{64}$'),
  status             text not null check (status in ('pending', 'sent', 'failed')),
  provider_code      text,
  attempted_at       timestamptz not null default now(),
  completed_at       timestamptz,
  created_at         timestamptz not null default now(),
  unique (statement_id, channel, idempotency_key),
  unique (statement_id, channel, attempt_no)
);

create table if not exists public.dealer_pt_wage_settlements (
  id                         uuid primary key default gen_random_uuid(),
  statement_id               uuid not null unique references public.dealer_payroll_statements(id),
  dealer_id                  uuid not null references public.dealers(id),
  club_id                    uuid not null references public.clubs(id),
  status                     text not null check (status in ('finalized', 'paid', 'voided')),
  covered_from               timestamptz not null,
  covered_to                 timestamptz not null,
  minutes_reserved           integer not null check (minutes_reserved >= 0),
  amount_vnd                 bigint not null check (amount_vnd > 0),
  hourly_rate_vnd_snapshot   integer not null check (hourly_rate_vnd_snapshot >= 0),
  accrual_policy_snapshot    jsonb not null,
  payment_id                 uuid unique references public.dealer_pt_wage_payments(id),
  finalized_by               uuid not null references auth.users(id),
  finalized_at               timestamptz not null default now(),
  voided_by                  uuid references auth.users(id),
  voided_at                  timestamptz,
  void_reason                text,
  constraint dealer_pt_wage_settlements_interval check (covered_to >= covered_from),
  constraint dealer_pt_wage_settlements_void_shape check (
    (status <> 'voided' and voided_at is null and voided_by is null and void_reason is null)
    or
    (status = 'voided' and voided_at is not null and voided_by is not null and nullif(btrim(void_reason), '') is not null)
  )
);

create unique index if not exists dealer_pt_wage_settlements_one_unpaid_per_dealer_uq
  on public.dealer_pt_wage_settlements (dealer_id)
  where status = 'finalized';
create index if not exists dealer_pt_wage_settlements_dealer_anchor_idx
  on public.dealer_pt_wage_settlements (dealer_id, covered_to desc)
  where status = 'finalized';

alter table public.dealer_pt_wage_payments
  add column if not exists statement_id uuid references public.dealer_payroll_statements(id);
create unique index if not exists dealer_pt_wage_payments_statement_uq
  on public.dealer_pt_wage_payments (statement_id)
  where statement_id is not null;

alter table public.dealer_payroll_statements enable row level security;
alter table public.dealer_payroll_statement_lines enable row level security;
alter table public.dealer_payroll_delivery_attempts enable row level security;
alter table public.dealer_pt_wage_settlements enable row level security;
alter table public.dealer_payroll_statements force row level security;
alter table public.dealer_payroll_statement_lines force row level security;
alter table public.dealer_payroll_delivery_attempts force row level security;
alter table public.dealer_pt_wage_settlements force row level security;

revoke all on table public.dealer_payroll_statements from public, anon, authenticated;
revoke all on table public.dealer_payroll_statement_lines from public, anon, authenticated;
revoke all on table public.dealer_payroll_delivery_attempts from public, anon, authenticated;
revoke all on table public.dealer_pt_wage_settlements from public, anon, authenticated;
grant select on table public.dealer_payroll_statements,
  public.dealer_payroll_statement_lines,
  public.dealer_payroll_delivery_attempts,
  public.dealer_pt_wage_settlements to service_role;

create or replace function public._dealer_payroll_statement_sha256(p_payload jsonb)
returns text
language sql
immutable
set search_path = public, extensions
as $$
  select encode(extensions.digest(convert_to(coalesce(p_payload, '{}'::jsonb)::text, 'utf8'), 'sha256'), 'hex')
$$;
revoke all on function public._dealer_payroll_statement_sha256(jsonb) from public, anon, authenticated;

create or replace function public._assert_dealer_payroll_statement_actor(p_club_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'PAYROLL_STATEMENT_AUTH_REQUIRED' using errcode = '42501';
  end if;

  if not (
    public.has_role(v_actor, 'super_admin'::public.app_role)
    or exists (
      select 1 from public.clubs c
      where c.id = p_club_id and c.owner_id = v_actor
    )
    or exists (
      select 1 from public.club_cashiers cc
      where cc.club_id = p_club_id and cc.user_id = v_actor
    )
  ) then
    raise exception 'PAYROLL_STATEMENT_FORBIDDEN' using errcode = '42501';
  end if;

  return v_actor;
end;
$$;
revoke all on function public._assert_dealer_payroll_statement_actor(uuid) from public, anon, authenticated;

create or replace function public.reject_dealer_payroll_statement_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PAYROLL_STATEMENT_IMMUTABLE' using errcode = '55000';
  end if;

  if row(
    new.club_id, new.dealer_id, new.statement_kind, new.request_id,
    new.payroll_period_id, new.source_dealer_payroll_id, new.cutoff_at,
    new.gross_amount_vnd, new.deduction_amount_vnd, new.net_amount_vnd,
    new.source_snapshot, new.dealer_snapshot, new.club_snapshot,
    new.financial_snapshot, new.source_fingerprint, new.statement_hash,
    new.finalized_by, new.finalized_at
  ) is distinct from row(
    old.club_id, old.dealer_id, old.statement_kind, old.request_id,
    old.payroll_period_id, old.source_dealer_payroll_id, old.cutoff_at,
    old.gross_amount_vnd, old.deduction_amount_vnd, old.net_amount_vnd,
    old.source_snapshot, old.dealer_snapshot, old.club_snapshot,
    old.financial_snapshot, old.source_fingerprint, old.statement_hash,
    old.finalized_by, old.finalized_at
  ) then
    raise exception 'PAYROLL_STATEMENT_IMMUTABLE' using errcode = '55000';
  end if;

  if old.state in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent')
     and new.state is not distinct from old.state
     and old.pt_wage_payment_id is null
     and new.pt_wage_payment_id is not null
     and new.voided_at is null
     and new.voided_by is null
     and new.void_reason is null
     and new.replaces_statement_id is not distinct from old.replaces_statement_id
     and new.replaced_by_statement_id is not distinct from old.replaced_by_statement_id then
    return new;
  end if;

  if (
       (old.state = 'finalized' and new.state = 'pdf_rendered')
       or (old.state = 'pdf_rendered' and new.state in ('sent', 'delivery_failed'))
       or (old.state = 'delivery_failed' and new.state in ('pdf_rendered', 'sent'))
     )
     and new.pt_wage_payment_id is not distinct from old.pt_wage_payment_id
     and new.voided_at is null
     and new.voided_by is null
     and new.void_reason is null
     and new.replaces_statement_id is not distinct from old.replaces_statement_id
     and new.replaced_by_statement_id is not distinct from old.replaced_by_statement_id then
    return new;
  end if;

  if old.state in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent')
     and new.state = 'voided'
     and old.pt_wage_payment_id is null
     and new.pt_wage_payment_id is null
     and new.voided_at is not null
     and new.voided_by is not null
     and nullif(btrim(new.void_reason), '') is not null
     and new.replaces_statement_id is not distinct from old.replaces_statement_id
     and new.replaced_by_statement_id is null then
    return new;
  end if;

  if old.state = 'voided'
     and new.state = 'replaced'
     and new.pt_wage_payment_id is null
     and new.voided_at is not distinct from old.voided_at
     and new.voided_by is not distinct from old.voided_by
     and new.void_reason is not distinct from old.void_reason
     and new.replaced_by_statement_id is not null
     and new.replaces_statement_id is not distinct from old.replaces_statement_id then
    return new;
  end if;

  raise exception 'PAYROLL_STATEMENT_IMMUTABLE' using errcode = '55000';
end;
$$;
revoke all on function public.reject_dealer_payroll_statement_mutation() from public, anon, authenticated;

drop trigger if exists trg_dealer_payroll_statements_immutable on public.dealer_payroll_statements;
create trigger trg_dealer_payroll_statements_immutable
before update or delete on public.dealer_payroll_statements
for each row execute function public.reject_dealer_payroll_statement_mutation();

create or replace function public.reject_dealer_payroll_statement_line_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  raise exception 'PAYROLL_STATEMENT_LINE_IMMUTABLE' using errcode = '55000';
end;
$$;
revoke all on function public.reject_dealer_payroll_statement_line_mutation() from public, anon, authenticated;

drop trigger if exists trg_dealer_payroll_statement_lines_immutable on public.dealer_payroll_statement_lines;
create trigger trg_dealer_payroll_statement_lines_immutable
before update or delete on public.dealer_payroll_statement_lines
for each row execute function public.reject_dealer_payroll_statement_line_mutation();

create or replace function public.reject_dealer_pt_wage_payment_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PT_WAGE_PAYMENT_IMMUTABLE' using errcode = '55000';
  end if;

  if old.voided_at is null
     and new.voided_at is not null
     and new.voided_by is not null
     and row(
       new.id, new.dealer_id, new.club_id, new.amount_vnd, new.minutes_paid,
       new.hourly_rate_vnd_snapshot, new.covered_from, new.covered_to, new.paid_at,
       new.paid_by, new.created_by, new.created_at, new.payment_method,
       new.payment_reference, new.idempotency_key, new.note,
       new.accrual_policy_snapshot, new.statement_id
     ) is not distinct from row(
       old.id, old.dealer_id, old.club_id, old.amount_vnd, old.minutes_paid,
       old.hourly_rate_vnd_snapshot, old.covered_from, old.covered_to, old.paid_at,
       old.paid_by, old.created_by, old.created_at, old.payment_method,
       old.payment_reference, old.idempotency_key, old.note,
       old.accrual_policy_snapshot, old.statement_id
     ) then
    return new;
  end if;

  raise exception 'PT_WAGE_PAYMENT_IMMUTABLE' using errcode = '55000';
end;
$$;
revoke all on function public.reject_dealer_pt_wage_payment_mutation() from public, anon, authenticated;

drop trigger if exists trg_dealer_pt_wage_payments_immutable on public.dealer_pt_wage_payments;
create trigger trg_dealer_pt_wage_payments_immutable
before update or delete on public.dealer_pt_wage_payments
for each row execute function public.reject_dealer_pt_wage_payment_mutation();

create or replace function public.finalize_full_time_payroll_statement(
  p_request_id uuid,
  p_club_id uuid,
  p_dealer_id uuid,
  p_payroll_period_id uuid,
  p_reason text default null,
  p_replaces_statement_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_period public.payroll_periods%rowtype;
  v_payroll public.dealer_payroll%rowtype;
  v_dealer public.dealers%rowtype;
  v_club public.clubs%rowtype;
  v_existing public.dealer_payroll_statements%rowtype;
  v_replaced public.dealer_payroll_statements%rowtype;
  v_source jsonb;
  v_dealer_snapshot jsonb;
  v_club_snapshot jsonb;
  v_financial_snapshot jsonb;
  v_payload jsonb;
  v_statement_id uuid;
  v_net numeric;
  v_gross bigint;
  v_deductions bigint;
  v_line jsonb;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_request_id is null or p_club_id is null or p_dealer_id is null or p_payroll_period_id is null then
    raise exception 'PAYROLL_STATEMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;

  v_actor := public._assert_dealer_payroll_statement_actor(p_club_id);

  select * into v_existing
  from public.dealer_payroll_statements
  where club_id = p_club_id and request_id = p_request_id
  for update;
  if found then
    if v_existing.statement_kind <> 'full_time_period'
       or v_existing.dealer_id <> p_dealer_id
       or v_existing.payroll_period_id <> p_payroll_period_id then
      raise exception 'PAYROLL_STATEMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'statement_id', v_existing.id,
      'state', v_existing.state,
      'net_amount_vnd', v_existing.net_amount_vnd,
      'statement_hash', v_existing.statement_hash,
      'idempotent', true
    );
  end if;

  select * into v_period
  from public.payroll_periods
  where id = p_payroll_period_id and club_id = p_club_id
  for update;
  if not found then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_period.status <> 'locked' then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_LOCKED' using errcode = 'P0001';
  end if;

  select * into v_dealer
  from public.dealers
  where id = p_dealer_id and club_id = p_club_id
  for share;
  if not found then
    raise exception 'PAYROLL_STATEMENT_DEALER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_dealer.employment_type <> 'full_time' then
    raise exception 'PAYROLL_STATEMENT_NOT_FULL_TIME_DEALER' using errcode = 'P0001';
  end if;

  select * into v_payroll
  from public.dealer_payroll
  where period_id = p_payroll_period_id and dealer_id = p_dealer_id and club_id = p_club_id
  for share;
  if not found or coalesce(v_payroll.status, '') = 'excluded' then
    raise exception 'PAYROLL_STATEMENT_SOURCE_PAYROLL_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_club from public.clubs where id = p_club_id for share;
  if not found then
    raise exception 'PAYROLL_STATEMENT_CLUB_NOT_FOUND' using errcode = 'P0002';
  end if;

  if exists (
    select 1
    from public.dealer_payroll_statements s
    where s.source_dealer_payroll_id = v_payroll.id
      and s.state not in ('voided', 'replaced')
  ) then
    raise exception 'PAYROLL_STATEMENT_SOURCE_ALREADY_FINALIZED' using errcode = 'P0001';
  end if;

  v_source := jsonb_build_object(
    'source_kind', 'locked_full_time_payroll',
    'payroll_period', jsonb_build_object(
      'id', v_period.id,
      'period_year', v_period.period_year,
      'period_month', v_period.period_month,
      'period_start', v_period.period_start,
      'period_end', v_period.period_end,
      'status', v_period.status,
      'locked_at', v_period.locked_at
    ),
    'dealer_payroll', to_jsonb(v_payroll)
  );
  v_net := nullif(v_source #>> '{dealer_payroll,net_pay_after_tax_vnd}', '')::numeric;
  if v_net is null or v_net < 0 or trunc(v_net) <> v_net then
    raise exception 'PAYROLL_STATEMENT_NET_SNAPSHOT_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_gross := coalesce(nullif(v_source #>> '{dealer_payroll,gross_pay_vnd}', '')::numeric, 0)::bigint;
  v_deductions := (
    coalesce(nullif(v_source #>> '{dealer_payroll,bhxh_deduction_vnd}', '')::numeric, 0)
    + coalesce(nullif(v_source #>> '{dealer_payroll,bhyt_deduction_vnd}', '')::numeric, 0)
    + coalesce(nullif(v_source #>> '{dealer_payroll,bhtn_deduction_vnd}', '')::numeric, 0)
    + coalesce(nullif(v_source #>> '{dealer_payroll,pit_deduction_vnd}', '')::numeric, 0)
  )::bigint;

  v_dealer_snapshot := jsonb_build_object(
    'dealer_id', v_dealer.id,
    'full_name', v_dealer.full_name,
    'employment_type', v_dealer.employment_type,
    'department', 'Dealer'
  );
  v_club_snapshot := jsonb_build_object(
    'club_id', v_club.id,
    'club_name', v_club.name,
    'brand_key', 'vinpoker',
    'brand_asset_version', 'v1'
  );
  v_financial_snapshot := jsonb_build_object(
    'currency', 'VND',
    'gross_amount_vnd', v_gross,
    'deduction_amount_vnd', v_deductions,
    'net_amount_vnd', v_net::bigint,
    'net_amount_source', 'dealer_payroll.net_pay_after_tax_vnd'
  );
  v_payload := jsonb_build_object(
    'source_snapshot', v_source,
    'dealer_snapshot', v_dealer_snapshot,
    'club_snapshot', v_club_snapshot,
    'financial_snapshot', v_financial_snapshot
  );

  if p_replaces_statement_id is not null then
    select * into v_replaced
    from public.dealer_payroll_statements
    where id = p_replaces_statement_id
    for update;
    if not found
       or v_replaced.state <> 'voided'
       or v_replaced.club_id <> p_club_id
       or v_replaced.dealer_id <> p_dealer_id
       or v_replaced.statement_kind <> 'full_time_period'
       or v_replaced.source_dealer_payroll_id <> v_payroll.id then
      raise exception 'PAYROLL_STATEMENT_REPLACEMENT_INVALID' using errcode = 'P0001';
    end if;
  end if;

  insert into public.dealer_payroll_statements (
    club_id, dealer_id, statement_kind, state, request_id,
    payroll_period_id, source_dealer_payroll_id, replaces_statement_id,
    gross_amount_vnd, deduction_amount_vnd, net_amount_vnd,
    source_snapshot, dealer_snapshot, club_snapshot, financial_snapshot,
    source_fingerprint, statement_hash, finalized_by
  ) values (
    p_club_id, p_dealer_id, 'full_time_period', 'finalized', p_request_id,
    p_payroll_period_id, v_payroll.id, p_replaces_statement_id,
    v_gross, v_deductions, v_net::bigint,
    v_source, v_dealer_snapshot, v_club_snapshot, v_financial_snapshot,
    public._dealer_payroll_statement_sha256(v_source),
    public._dealer_payroll_statement_sha256(v_payload), v_actor
  ) returning id into v_statement_id;

  for v_line in
    select value
    from jsonb_array_elements(jsonb_build_array(
      jsonb_build_object('line_type', 'earning', 'line_code', 'base_salary', 'label', 'Luong co ban', 'quantity', 1, 'unit', 'ky', 'unit_rate_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,base_salary_vnd}', '')::numeric, 0)::bigint, 'amount_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,base_salary_vnd}', '')::numeric, 0)::bigint),
      jsonb_build_object('line_type', 'earning', 'line_code', 'regular_pay', 'label', 'Gio thuong', 'quantity', coalesce(nullif(v_source #>> '{dealer_payroll,regular_hours}', '')::numeric, 0), 'unit', 'gio', 'unit_rate_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,hourly_rate_vnd}', '')::numeric, 0)::bigint, 'amount_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,regular_pay_vnd}', '')::numeric, 0)::bigint),
      jsonb_build_object('line_type', 'earning', 'line_code', 'ot_pay', 'label', 'Tang ca', 'quantity', coalesce(nullif(v_source #>> '{dealer_payroll,ot_hours}', '')::numeric, 0), 'unit', 'gio', 'unit_rate_vnd', null, 'amount_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,ot_pay_vnd}', '')::numeric, 0)::bigint),
      jsonb_build_object('line_type', 'adjustment', 'line_code', 'adjustments', 'label', 'Dieu chinh', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,total_adjustments_vnd}', '')::numeric, 0)::bigint),
      jsonb_build_object('line_type', 'deduction', 'line_code', 'bhxh', 'label', 'BHXH', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', -coalesce(nullif(v_source #>> '{dealer_payroll,bhxh_deduction_vnd}', '')::numeric, 0)::bigint),
      jsonb_build_object('line_type', 'deduction', 'line_code', 'bhyt', 'label', 'BHYT', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', -coalesce(nullif(v_source #>> '{dealer_payroll,bhyt_deduction_vnd}', '')::numeric, 0)::bigint),
      jsonb_build_object('line_type', 'deduction', 'line_code', 'bhtn', 'label', 'BHTN', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', -coalesce(nullif(v_source #>> '{dealer_payroll,bhtn_deduction_vnd}', '')::numeric, 0)::bigint),
      jsonb_build_object('line_type', 'deduction', 'line_code', 'pit', 'label', 'Thue TNCN', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', -coalesce(nullif(v_source #>> '{dealer_payroll,pit_deduction_vnd}', '')::numeric, 0)::bigint)
    ))
  loop
    insert into public.dealer_payroll_statement_lines (
      statement_id, line_no, line_type, line_code, label, quantity, unit, unit_rate_vnd, amount_vnd, source_snapshot
    ) values (
      v_statement_id,
      (select count(*) + 1 from public.dealer_payroll_statement_lines where statement_id = v_statement_id),
      v_line->>'line_type', v_line->>'line_code', v_line->>'label',
      nullif(v_line->>'quantity', '')::numeric, nullif(v_line->>'unit', ''),
      nullif(v_line->>'unit_rate_vnd', '')::bigint, (v_line->>'amount_vnd')::bigint, v_line
    );
  end loop;

  if p_replaces_statement_id is not null then
    update public.dealer_payroll_statements
    set state = 'replaced', replaced_by_statement_id = v_statement_id
    where id = p_replaces_statement_id;
  end if;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_payroll_statements', v_statement_id, p_club_id, 'INSERT',
    jsonb_build_object('statement_kind', 'full_time_period', 'state', 'finalized', 'net_amount_vnd', v_net::bigint, 'statement_hash', public._dealer_payroll_statement_sha256(v_payload)),
    v_actor, coalesce(v_reason, 'FT payroll statement finalized from locked payroll period')
  );

  return jsonb_build_object(
    'statement_id', v_statement_id,
    'state', 'finalized',
    'net_amount_vnd', v_net::bigint,
    'statement_hash', public._dealer_payroll_statement_sha256(v_payload),
    'idempotent', false
  );
end;
$$;
revoke all on function public.finalize_full_time_payroll_statement(uuid,uuid,uuid,uuid,text,uuid) from public, anon;

create or replace function public.finalize_part_time_payroll_statement(
  p_request_id uuid,
  p_club_id uuid,
  p_dealer_id uuid,
  p_reason text default null,
  p_replaces_statement_id uuid default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, extensions
as $$
declare
  v_actor uuid;
  v_dealer public.dealers%rowtype;
  v_club public.clubs%rowtype;
  v_existing public.dealer_payroll_statements%rowtype;
  v_replaced public.dealer_payroll_statements%rowtype;
  v_balance jsonb;
  v_rate_segments jsonb;
  v_source jsonb;
  v_dealer_snapshot jsonb;
  v_club_snapshot jsonb;
  v_financial_snapshot jsonb;
  v_payload jsonb;
  v_statement_id uuid;
  v_settlement_id uuid;
  v_amount bigint;
  v_minutes integer;
  v_rate integer;
  v_anchor timestamptz;
  v_cutoff timestamptz;
  v_reason text := nullif(btrim(p_reason), '');
  v_segment jsonb;
  v_line_no integer := 0;
begin
  if p_request_id is null or p_club_id is null or p_dealer_id is null then
    raise exception 'PAYROLL_STATEMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;

  v_actor := public._assert_dealer_payroll_statement_actor(p_club_id);

  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || p_club_id::text));
  perform pg_advisory_xact_lock(hashtext('pt_wage:' || p_dealer_id::text));

  select * into v_existing
  from public.dealer_payroll_statements
  where club_id = p_club_id and request_id = p_request_id
  for update;
  if found then
    if v_existing.statement_kind <> 'part_time_settlement'
       or v_existing.dealer_id <> p_dealer_id then
      raise exception 'PAYROLL_STATEMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'statement_id', v_existing.id,
      'state', v_existing.state,
      'net_amount_vnd', v_existing.net_amount_vnd,
      'statement_hash', v_existing.statement_hash,
      'idempotent', true
    );
  end if;

  select * into v_dealer
  from public.dealers
  where id = p_dealer_id and club_id = p_club_id and status = 'active'
  for update;
  if not found then
    raise exception 'PAYROLL_STATEMENT_DEALER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_dealer.employment_type <> 'part_time' then
    raise exception 'PAYROLL_STATEMENT_NOT_PART_TIME_DEALER' using errcode = 'P0001';
  end if;

  perform 1
  from public.dealer_pt_wage_settlements s
  where s.dealer_id = p_dealer_id and s.status = 'finalized'
  for update;
  if found then
    raise exception 'PT_FINALIZED_STATEMENT_PENDING_PAYMENT' using errcode = 'P0001';
  end if;

  select * into v_club from public.clubs where id = p_club_id for share;
  if not found then
    raise exception 'PAYROLL_STATEMENT_CLUB_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_balance := public._pt_wage_balance(p_dealer_id);
  if v_balance ? 'error' then
    raise exception 'PT_WAGE_BALANCE_UNAVAILABLE' using errcode = 'P0001';
  end if;
  v_amount := coalesce(nullif(v_balance->>'balance_vnd', '')::bigint, 0);
  v_minutes := coalesce(nullif(v_balance->>'accrued_minutes', '')::integer, 0);
  v_rate := coalesce(nullif(v_balance->>'hourly_rate_vnd', '')::integer, 0);
  v_anchor := nullif(v_balance->>'last_reset_at', '')::timestamptz;
  v_cutoff := nullif(v_balance->>'as_of', '')::timestamptz;
  v_rate_segments := coalesce(v_balance->'rate_segments', '[]'::jsonb);
  if v_amount <= 0 or v_anchor is null or v_cutoff is null or v_cutoff < v_anchor
     or jsonb_typeof(v_rate_segments) <> 'array'
     or jsonb_array_length(v_rate_segments) = 0 then
    raise exception 'PT_WAGE_FINALIZATION_SNAPSHOT_UNAVAILABLE' using errcode = 'P0001';
  end if;

  v_source := jsonb_build_object(
    'source_kind', 'part_time_effective_dated_balance',
    'cutoff_at', v_cutoff,
    'covered_from', v_anchor,
    'covered_to', v_cutoff,
    'balance', v_balance,
    'rate_segments', v_rate_segments
  );
  v_dealer_snapshot := jsonb_build_object(
    'dealer_id', v_dealer.id,
    'full_name', v_dealer.full_name,
    'employment_type', v_dealer.employment_type,
    'department', 'Dealer'
  );
  v_club_snapshot := jsonb_build_object(
    'club_id', v_club.id,
    'club_name', v_club.name,
    'brand_key', 'vinpoker',
    'brand_asset_version', 'v1'
  );
  v_financial_snapshot := jsonb_build_object(
    'currency', 'VND',
    'gross_amount_vnd', v_amount,
    'deduction_amount_vnd', 0,
    'net_amount_vnd', v_amount,
    'net_amount_source', 'server_finalized_pt_rate_segments',
    'minutes_reserved', v_minutes,
    'hourly_rate_vnd_snapshot', v_rate,
    'accrual_policy_snapshot', jsonb_build_object(
      'accrual_mode', v_balance->>'accrual_mode',
      'standby_accrual_enabled', v_balance->'standby_accrual_enabled',
      'policy_effective_from', v_balance->'policy_effective_from',
      'per_attendance_cap_minutes', v_balance->'per_attendance_cap_minutes',
      'rate_history_applied', v_balance->'rate_history_applied',
      'rate_segments', v_rate_segments
    )
  );
  v_payload := jsonb_build_object(
    'source_snapshot', v_source,
    'dealer_snapshot', v_dealer_snapshot,
    'club_snapshot', v_club_snapshot,
    'financial_snapshot', v_financial_snapshot
  );

  if p_replaces_statement_id is not null then
    select * into v_replaced
    from public.dealer_payroll_statements
    where id = p_replaces_statement_id
    for update;
    if not found
       or v_replaced.state <> 'voided'
       or v_replaced.club_id <> p_club_id
       or v_replaced.dealer_id <> p_dealer_id
       or v_replaced.statement_kind <> 'part_time_settlement' then
      raise exception 'PAYROLL_STATEMENT_REPLACEMENT_INVALID' using errcode = 'P0001';
    end if;
  end if;

  insert into public.dealer_payroll_statements (
    club_id, dealer_id, statement_kind, state, request_id, cutoff_at,
    replaces_statement_id, gross_amount_vnd, deduction_amount_vnd, net_amount_vnd,
    source_snapshot, dealer_snapshot, club_snapshot, financial_snapshot,
    source_fingerprint, statement_hash, finalized_by
  ) values (
    p_club_id, p_dealer_id, 'part_time_settlement', 'finalized', p_request_id, v_cutoff,
    p_replaces_statement_id, v_amount, 0, v_amount,
    v_source, v_dealer_snapshot, v_club_snapshot, v_financial_snapshot,
    public._dealer_payroll_statement_sha256(v_source),
    public._dealer_payroll_statement_sha256(v_payload), v_actor
  ) returning id into v_statement_id;

  insert into public.dealer_pt_wage_settlements (
    statement_id, dealer_id, club_id, status, covered_from, covered_to,
    minutes_reserved, amount_vnd, hourly_rate_vnd_snapshot,
    accrual_policy_snapshot, finalized_by
  ) values (
    v_statement_id, p_dealer_id, p_club_id, 'finalized', v_anchor, v_cutoff,
    v_minutes, v_amount, v_rate,
    v_financial_snapshot->'accrual_policy_snapshot', v_actor
  ) returning id into v_settlement_id;

  for v_segment in select value from jsonb_array_elements(v_rate_segments)
  loop
    v_line_no := v_line_no + 1;
    insert into public.dealer_payroll_statement_lines (
      statement_id, line_no, line_type, line_code, label, quantity, unit, unit_rate_vnd, amount_vnd, source_snapshot
    ) values (
      v_statement_id, v_line_no, 'rate_segment', 'pt_rate_segment', 'Luong theo don gia hieu luc',
      coalesce(nullif(v_segment->>'elapsed_seconds', '')::numeric, 0) / 3600,
      'gio', nullif(v_segment->>'hourly_rate_vnd', '')::bigint,
      floor(coalesce(nullif(v_segment->>'amount_vnd', '')::numeric, 0))::bigint,
      v_segment
    );
  end loop;

  if p_replaces_statement_id is not null then
    update public.dealer_payroll_statements
    set state = 'replaced', replaced_by_statement_id = v_statement_id
    where id = p_replaces_statement_id;
  end if;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_payroll_statements', v_statement_id, p_club_id, 'INSERT',
    jsonb_build_object('statement_kind', 'part_time_settlement', 'state', 'finalized', 'net_amount_vnd', v_amount, 'cutoff_at', v_cutoff, 'statement_hash', public._dealer_payroll_statement_sha256(v_payload)),
    v_actor, coalesce(v_reason, 'PT payroll statement finalized with reserved cutoff')
  );
  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_pt_wage_settlements', v_settlement_id, p_club_id, 'INSERT',
    jsonb_build_object('statement_id', v_statement_id, 'covered_from', v_anchor, 'covered_to', v_cutoff, 'amount_vnd', v_amount),
    v_actor, coalesce(v_reason, 'PT wage interval reserved by finalized statement')
  );

  return jsonb_build_object(
    'statement_id', v_statement_id,
    'settlement_id', v_settlement_id,
    'state', 'finalized',
    'net_amount_vnd', v_amount,
    'cutoff_at', v_cutoff,
    'statement_hash', public._dealer_payroll_statement_sha256(v_payload),
    'idempotent', false
  );
end;
$$;
revoke all on function public.finalize_part_time_payroll_statement(uuid,uuid,uuid,text,uuid) from public, anon;

create or replace function public.void_dealer_payroll_statement(
  p_statement_id uuid,
  p_reason text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_statement public.dealer_payroll_statements%rowtype;
  v_settlement public.dealer_pt_wage_settlements%rowtype;
  v_actor uuid;
  v_reason text := nullif(btrim(p_reason), '');
  v_period_status text;
begin
  if p_statement_id is null or v_reason is null then
    raise exception 'PAYROLL_STATEMENT_VOID_REASON_REQUIRED' using errcode = 'P0001';
  end if;

  select * into v_statement
  from public.dealer_payroll_statements
  where id = p_statement_id
  for update;
  if not found then
    raise exception 'PAYROLL_STATEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_actor := public._assert_dealer_payroll_statement_actor(v_statement.club_id);

  if v_statement.state not in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent')
     or v_statement.pt_wage_payment_id is not null then
    raise exception 'PAYROLL_STATEMENT_ALREADY_PAID_OR_NOT_VOIDABLE' using errcode = 'P0001';
  end if;

  if v_statement.statement_kind = 'full_time_period' then
    select status into v_period_status
    from public.payroll_periods
    where id = v_statement.payroll_period_id
    for update;
    if v_period_status <> 'locked' then
      raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_LOCKED' using errcode = 'P0001';
    end if;
  else
    perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || v_statement.club_id::text));
    perform pg_advisory_xact_lock(hashtext('pt_wage:' || v_statement.dealer_id::text));
    select * into v_settlement
    from public.dealer_pt_wage_settlements
    where statement_id = p_statement_id
    for update;
    if not found or v_settlement.status <> 'finalized' or v_settlement.payment_id is not null then
      raise exception 'PT_FINALIZED_STATEMENT_ALREADY_PAID' using errcode = 'P0001';
    end if;
    update public.dealer_pt_wage_settlements
    set status = 'voided', voided_at = now(), voided_by = v_actor, void_reason = v_reason
    where id = v_settlement.id;
  end if;

  update public.dealer_payroll_statements
  set state = 'voided', voided_at = now(), voided_by = v_actor, void_reason = v_reason
  where id = p_statement_id;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, old_values, new_values, changed_by, reason)
  values (
    'dealer_payroll_statements', p_statement_id, v_statement.club_id, 'UPDATE',
    jsonb_build_object('state', v_statement.state),
    jsonb_build_object('state', 'voided'), v_actor, v_reason
  );

  return jsonb_build_object('statement_id', p_statement_id, 'state', 'voided');
end;
$$;
revoke all on function public.void_dealer_payroll_statement(uuid,text) from public, anon;

-- The balance remains a derived server value. A finalized settlement advances
-- its anchor without pretending that cash has been paid, so later minutes are
-- kept out of the frozen statement while it awaits payment.
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
  v_reserved_through        timestamptz;
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

  if v_dealer.employment_type = 'part_time'
     and (v_first_pt_rate_history is null or v_latest_pt_eligible is distinct from true) then
    raise exception 'PT_WAGE_RATE_HISTORY_UNAVAILABLE' using errcode = 'P0002';
  end if;

  select max(s.covered_to)
    into v_reserved_through
  from public.dealer_pt_wage_settlements s
  where s.dealer_id = p_dealer_id and s.status = 'finalized';

  select coalesce(
    (
      select max(anchor_time)
      from (
        select p.covered_to as anchor_time
        from public.dealer_pt_wage_payments p
        where p.dealer_id = p_dealer_id and p.voided_at is null
        union all
        select s.covered_to as anchor_time
        from public.dealer_pt_wage_settlements s
        where s.dealer_id = p_dealer_id and s.status = 'finalized'
      ) anchors
    ),
    (
      select min(check_in_time)
      from public.dealer_attendance
      where dealer_id = p_dealer_id and check_in_time is not null
    ),
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
        select h.effective_from,
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
    'reserved_through',            v_reserved_through,
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

create or replace function public.reject_dealer_pt_wage_settlement_mutation()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if tg_op = 'DELETE' then
    raise exception 'PT_WAGE_SETTLEMENT_IMMUTABLE' using errcode = '55000';
  end if;

  if row(
    new.id, new.statement_id, new.dealer_id, new.club_id, new.covered_from,
    new.covered_to, new.minutes_reserved, new.amount_vnd,
    new.hourly_rate_vnd_snapshot, new.accrual_policy_snapshot,
    new.finalized_by, new.finalized_at
  ) is distinct from row(
    old.id, old.statement_id, old.dealer_id, old.club_id, old.covered_from,
    old.covered_to, old.minutes_reserved, old.amount_vnd,
    old.hourly_rate_vnd_snapshot, old.accrual_policy_snapshot,
    old.finalized_by, old.finalized_at
  ) then
    raise exception 'PT_WAGE_SETTLEMENT_IMMUTABLE' using errcode = '55000';
  end if;

  if old.status = 'finalized'
     and new.status = 'paid'
     and old.payment_id is null
     and new.payment_id is not null
     and new.voided_at is null
     and new.voided_by is null
     and new.void_reason is null then
    return new;
  end if;

  if old.status = 'finalized'
     and new.status = 'voided'
     and old.payment_id is null
     and new.payment_id is null
     and new.voided_at is not null
     and new.voided_by is not null
     and nullif(btrim(new.void_reason), '') is not null then
    return new;
  end if;

  raise exception 'PT_WAGE_SETTLEMENT_IMMUTABLE' using errcode = '55000';
end;
$$;
revoke all on function public.reject_dealer_pt_wage_settlement_mutation() from public, anon, authenticated;

drop trigger if exists trg_dealer_pt_wage_settlements_immutable on public.dealer_pt_wage_settlements;
create trigger trg_dealer_pt_wage_settlements_immutable
before update or delete on public.dealer_pt_wage_settlements
for each row execute function public.reject_dealer_pt_wage_settlement_mutation();

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

  if exists (
    select 1 from public.dealer_pt_wage_settlements s
    where s.dealer_id = p_dealer_id and s.status = 'finalized'
  ) then
    raise exception 'PT_FINALIZED_STATEMENT_PENDING_PAYMENT' using errcode = 'P0001';
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
  ) returning id into v_id;

  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, new_values, changed_by, reason
  ) values (
    'dealer_pt_wage_payments', v_id, v_dealer.club_id, 'INSERT',
    jsonb_build_object(
      'dealer_id', p_dealer_id, 'amount_vnd', v_amount,
      'minutes_paid', v_minutes, 'hourly_rate_vnd_snapshot', v_rate,
      'covered_from', v_anchor, 'covered_to', v_now,
      'payment_method', p_payment_method, 'payment_reference', p_payment_reference,
      'accrual_policy_snapshot', v_policy_snapshot
    ), v_actor, 'PT wage full payout and reset'
  );

  return jsonb_build_object(
    'payment_id', v_id, 'idempotent', false, 'amount_vnd', v_amount,
    'minutes_paid', v_minutes, 'covered_from', v_anchor, 'covered_to', v_now,
    'paid_at', v_now, 'accrual_policy_snapshot', v_policy_snapshot
  );
end;
$$;
revoke all on function public.pay_part_time_balance(uuid,text,text,text,text) from public, anon;
grant execute on function public.pay_part_time_balance(uuid,text,text,text,text) to authenticated;

create or replace function public.pay_finalized_part_time_payroll_statement(
  p_statement_id uuid,
  p_payment_method text,
  p_payment_reference text default null,
  p_idempotency_key text default null,
  p_note text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_statement public.dealer_payroll_statements%rowtype;
  v_settlement public.dealer_pt_wage_settlements%rowtype;
  v_payment public.dealer_pt_wage_payments%rowtype;
  v_actor uuid;
  v_key text;
  v_payment_id uuid;
  v_now timestamptz := now();
begin
  if p_statement_id is null then
    raise exception 'PAYROLL_STATEMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;

  select * into v_statement
  from public.dealer_payroll_statements
  where id = p_statement_id
  for update;
  if not found or v_statement.statement_kind <> 'part_time_settlement' then
    raise exception 'PT_FINALIZED_STATEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  v_actor := public._assert_dealer_payroll_statement_actor(v_statement.club_id);
  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || v_statement.club_id::text));
  perform pg_advisory_xact_lock(hashtext('pt_wage:' || v_statement.dealer_id::text));

  select * into v_settlement
  from public.dealer_pt_wage_settlements
  where statement_id = p_statement_id
  for update;
  if not found then
    raise exception 'PT_FINALIZED_SETTLEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if v_settlement.status = 'paid' or v_statement.pt_wage_payment_id is not null then
    select * into v_payment
    from public.dealer_pt_wage_payments
    where id = coalesce(v_settlement.payment_id, v_statement.pt_wage_payment_id)
    limit 1;
    if not found then
      raise exception 'PT_FINALIZED_STATEMENT_PAYMENT_LINK_BROKEN' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'statement_id', p_statement_id, 'payment_id', v_payment.id,
      'amount_vnd', v_payment.amount_vnd, 'idempotent', true
    );
  end if;
  if v_statement.state not in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent')
     or v_settlement.status <> 'finalized' then
    raise exception 'PT_FINALIZED_STATEMENT_NOT_PAYABLE' using errcode = 'P0001';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select * into v_payment
    from public.dealer_pt_wage_payments
    where dealer_id = v_statement.dealer_id and idempotency_key = v_key
    limit 1;
    if found then
      if v_payment.statement_id <> p_statement_id then
        raise exception 'PT_FINALIZED_STATEMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
      end if;
      return jsonb_build_object(
        'statement_id', p_statement_id, 'payment_id', v_payment.id,
        'amount_vnd', v_payment.amount_vnd, 'idempotent', true
      );
    end if;
  end if;

  insert into public.dealer_pt_wage_payments (
    dealer_id, club_id, amount_vnd, minutes_paid, hourly_rate_vnd_snapshot,
    covered_from, covered_to, paid_at, paid_by, created_by, payment_method,
    payment_reference, idempotency_key, note, accrual_policy_snapshot, statement_id
  ) values (
    v_settlement.dealer_id, v_settlement.club_id, v_settlement.amount_vnd,
    v_settlement.minutes_reserved, v_settlement.hourly_rate_vnd_snapshot,
    v_settlement.covered_from, v_settlement.covered_to, v_now, v_actor, v_actor,
    p_payment_method, p_payment_reference, v_key, p_note,
    v_settlement.accrual_policy_snapshot, p_statement_id
  ) returning id into v_payment_id;

  update public.dealer_pt_wage_settlements
  set status = 'paid', payment_id = v_payment_id
  where id = v_settlement.id;
  update public.dealer_payroll_statements
  set pt_wage_payment_id = v_payment_id
  where id = p_statement_id;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_pt_wage_payments', v_payment_id, v_settlement.club_id, 'INSERT',
    jsonb_build_object('statement_id', p_statement_id, 'amount_vnd', v_settlement.amount_vnd, 'covered_from', v_settlement.covered_from, 'covered_to', v_settlement.covered_to),
    v_actor, 'PT wage payment from finalized immutable statement snapshot'
  );

  return jsonb_build_object(
    'statement_id', p_statement_id, 'payment_id', v_payment_id,
    'amount_vnd', v_settlement.amount_vnd, 'idempotent', false
  );
end;
$$;
revoke all on function public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text) from public, anon;

create or replace function public.get_dealer_payroll_statement(p_statement_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_statement public.dealer_payroll_statements%rowtype;
  v_actor uuid := auth.uid();
begin
  if v_actor is null then
    raise exception 'PAYROLL_STATEMENT_AUTH_REQUIRED' using errcode = '42501';
  end if;

  select * into v_statement
  from public.dealer_payroll_statements
  where id = p_statement_id;
  if not found then
    raise exception 'PAYROLL_STATEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;

  if not (
    public.has_role(v_actor, 'super_admin'::public.app_role)
    or exists (
      select 1 from public.clubs c
      where c.id = v_statement.club_id and c.owner_id = v_actor
    )
    or exists (
      select 1 from public.club_cashiers cc
      where cc.club_id = v_statement.club_id and cc.user_id = v_actor
    )
    or exists (
      select 1 from public.dealers d
      where d.id = v_statement.dealer_id and d.user_id = v_actor
    )
  ) then
    raise exception 'PAYROLL_STATEMENT_FORBIDDEN' using errcode = '42501';
  end if;

  return jsonb_build_object(
    'id', v_statement.id,
    'club_id', v_statement.club_id,
    'dealer_id', v_statement.dealer_id,
    'statement_kind', v_statement.statement_kind,
    'state', v_statement.state,
    'cutoff_at', v_statement.cutoff_at,
    'gross_amount_vnd', v_statement.gross_amount_vnd,
    'deduction_amount_vnd', v_statement.deduction_amount_vnd,
    'net_amount_vnd', v_statement.net_amount_vnd,
    'source_snapshot', v_statement.source_snapshot,
    'dealer_snapshot', v_statement.dealer_snapshot,
    'club_snapshot', v_statement.club_snapshot,
    'financial_snapshot', v_statement.financial_snapshot,
    'source_fingerprint', v_statement.source_fingerprint,
    'statement_hash', v_statement.statement_hash,
    'finalized_at', v_statement.finalized_at,
    'pt_wage_payment_id', v_statement.pt_wage_payment_id,
    'lines', coalesce((
      select jsonb_agg(jsonb_build_object(
        'line_no', l.line_no, 'line_type', l.line_type, 'line_code', l.line_code,
        'label', l.label, 'quantity', l.quantity, 'unit', l.unit,
        'unit_rate_vnd', l.unit_rate_vnd, 'amount_vnd', l.amount_vnd,
        'source_snapshot', l.source_snapshot
      ) order by l.line_no)
      from public.dealer_payroll_statement_lines l
      where l.statement_id = v_statement.id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_dealer_payroll_statement(uuid) from public, anon;

grant execute on function public.finalize_full_time_payroll_statement(uuid,uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.finalize_part_time_payroll_statement(uuid,uuid,uuid,text,uuid) to authenticated;
grant execute on function public.void_dealer_payroll_statement(uuid,text) to authenticated;
grant execute on function public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text) to authenticated;
grant execute on function public.get_dealer_payroll_statement(uuid) to authenticated;
grant execute on function public.get_dealer_payroll_statement(uuid) to service_role;

comment on table public.dealer_payroll_statements is
  'Immutable dealer payroll statement snapshots. Brand identity uses a server snapshot (club name + VinPoker asset version); PDF rendering and delivery are added in later owner-gated work.';
comment on table public.dealer_pt_wage_settlements is
  'A finalized PT statement reserves exactly one server-cutoff interval until it is paid or voided. Reserved time is excluded from the live balance but is not cash-paid.';
comment on function public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text) is
  'Pays only the immutable PT statement snapshot. It never recalculates live wages.';

do $$
begin
  if to_regclass('public.dealer_payroll_statements') is null
     or to_regclass('public.dealer_payroll_statement_lines') is null
     or to_regclass('public.dealer_payroll_delivery_attempts') is null
     or to_regclass('public.dealer_pt_wage_settlements') is null
     or to_regprocedure('public.finalize_full_time_payroll_statement(uuid,uuid,uuid,uuid,text,uuid)') is null
     or to_regprocedure('public.finalize_part_time_payroll_statement(uuid,uuid,uuid,text,uuid)') is null
     or to_regprocedure('public.void_dealer_payroll_statement(uuid,text)') is null
     or to_regprocedure('public.pay_finalized_part_time_payroll_statement(uuid,text,text,text,text)') is null
     or to_regprocedure('public.get_dealer_payroll_statement(uuid)') is null then
    raise exception 'PAYROLL_STATEMENT_CONTRACT_INCOMPLETE' using errcode = 'P0001';
  end if;
end;
$$;

commit;
