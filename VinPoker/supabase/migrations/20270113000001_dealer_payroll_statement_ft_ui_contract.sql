-- Dealer payroll statement FT UI + immutable PDF generation contract.
-- CRITICAL / RED: source-only. Production apply, Edge/frontend deployment and
-- rollout changes require separate owner-gated runbook steps.
--
-- ROLLBACK: set dealer_payroll_statement_rollout.master_enabled=false. Use a
-- forward migration for schema rollback; never delete statements, PDFs or audit.

begin;

do $$
begin
  if to_regclass('public.dealer_payroll_statements') is null
     or to_regclass('public.dealer_payroll_statement_lines') is null
     or to_regclass('public.payroll_periods') is null
     or to_regclass('public.dealer_payroll') is null
     or to_regprocedure('public._dealer_payroll_statement_sha256(jsonb)') is null
     or to_regprocedure('public.get_dealer_payroll_statement(uuid)') is null then
    raise exception 'PAYROLL_STATEMENT_FT_UI_DEPENDENCY_UNAVAILABLE' using errcode = 'P0001';
  end if;
end;
$$;

alter table public.dealer_payroll_statements
  add column if not exists statement_version integer not null default 1,
  add column if not exists pdf_status text not null default 'not_generated',
  add column if not exists pdf_generation_request_id uuid,
  add column if not exists pdf_generation_token uuid,
  add column if not exists pdf_generation_started_at timestamptz,
  add column if not exists pdf_failure_code text,
  add column if not exists pdf_failed_at timestamptz;

create or replace function public.reject_dealer_payroll_statement_mutation()
returns trigger
language plpgsql
security definer
set search_path = public, pg_temp
as $$
declare
  v_pdf_transition_ok boolean;
  v_payment_transition_ok boolean;
  v_lineage_transition_ok boolean;
  v_state_transition_ok boolean;
begin
  if tg_op = 'DELETE' then
    raise exception 'PAYROLL_STATEMENT_IMMUTABLE' using errcode = '55000';
  end if;

  if row(
    new.club_id, new.dealer_id, new.statement_kind, new.statement_version,
    new.request_id, new.payroll_period_id, new.source_dealer_payroll_id,
    new.cutoff_at, new.gross_amount_vnd, new.deduction_amount_vnd,
    new.net_amount_vnd, new.source_snapshot, new.dealer_snapshot,
    new.club_snapshot, new.financial_snapshot, new.source_fingerprint,
    new.statement_hash, new.finalized_by, new.finalized_at
  ) is distinct from row(
    old.club_id, old.dealer_id, old.statement_kind, old.statement_version,
    old.request_id, old.payroll_period_id, old.source_dealer_payroll_id,
    old.cutoff_at, old.gross_amount_vnd, old.deduction_amount_vnd,
    old.net_amount_vnd, old.source_snapshot, old.dealer_snapshot,
    old.club_snapshot, old.financial_snapshot, old.source_fingerprint,
    old.statement_hash, old.finalized_by, old.finalized_at
  ) then
    raise exception 'PAYROLL_STATEMENT_IMMUTABLE' using errcode = '55000';
  end if;

  v_pdf_transition_ok := (
    row(
      new.pdf_status, new.pdf_generation_request_id, new.pdf_generation_token,
      new.pdf_generation_started_at, new.pdf_failure_code, new.pdf_failed_at,
      new.pdf_hash, new.pdf_storage_path, new.pdf_render_version, new.pdf_rendered_at
    ) is not distinct from row(
      old.pdf_status, old.pdf_generation_request_id, old.pdf_generation_token,
      old.pdf_generation_started_at, old.pdf_failure_code, old.pdf_failed_at,
      old.pdf_hash, old.pdf_storage_path, old.pdf_render_version, old.pdf_rendered_at
    )
  ) or (
    old.pdf_status in ('not_generated', 'failed', 'generating')
    and new.pdf_status = 'generating'
    and new.pdf_generation_request_id is not null
    and new.pdf_generation_token is not null
    and new.pdf_generation_started_at is not null
    and new.pdf_failure_code is null
    and new.pdf_failed_at is null
    and new.pdf_hash is not distinct from old.pdf_hash
    and new.pdf_storage_path is not distinct from old.pdf_storage_path
    and new.pdf_render_version is not distinct from old.pdf_render_version
    and new.pdf_rendered_at is not distinct from old.pdf_rendered_at
  ) or (
    old.pdf_status = 'generating'
    and new.pdf_status = 'ready'
    and new.pdf_generation_token is null
    and new.pdf_hash is not null
    and new.pdf_storage_path is not null
    and new.pdf_render_version is not null
    and new.pdf_rendered_at is not null
    and new.pdf_failure_code is null
    and new.pdf_failed_at is null
  ) or (
    old.pdf_status = 'generating'
    and new.pdf_status = 'failed'
    and new.pdf_generation_token is null
    and new.pdf_failure_code is not null
    and new.pdf_failed_at is not null
    and new.pdf_hash is not distinct from old.pdf_hash
    and new.pdf_storage_path is not distinct from old.pdf_storage_path
    and new.pdf_render_version is not distinct from old.pdf_render_version
    and new.pdf_rendered_at is not distinct from old.pdf_rendered_at
  ) or (
    old.pdf_status = 'not_generated'
    and new.pdf_status = 'ready'
    and old.pdf_hash is not null
    and old.pdf_storage_path is not null
    and old.pdf_render_version is not null
    and old.pdf_rendered_at is not null
    and row(
      new.pdf_hash, new.pdf_storage_path, new.pdf_render_version, new.pdf_rendered_at
    ) is not distinct from row(
      old.pdf_hash, old.pdf_storage_path, old.pdf_render_version, old.pdf_rendered_at
    )
  );

  v_payment_transition_ok := new.pt_wage_payment_id is not distinct from old.pt_wage_payment_id
    or (
      old.pt_wage_payment_id is null
      and new.pt_wage_payment_id is not null
      and new.state is not distinct from old.state
    );

  v_lineage_transition_ok := (
    row(new.voided_at, new.voided_by, new.void_reason, new.replaces_statement_id, new.replaced_by_statement_id)
    is not distinct from
    row(old.voided_at, old.voided_by, old.void_reason, old.replaces_statement_id, old.replaced_by_statement_id)
  ) or (
    old.state in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent')
    and new.state = 'voided'
    and old.pt_wage_payment_id is null and new.pt_wage_payment_id is null
    and new.voided_at is not null and new.voided_by is not null
    and nullif(btrim(new.void_reason), '') is not null
    and new.replaces_statement_id is not distinct from old.replaces_statement_id
    and new.replaced_by_statement_id is null
  ) or (
    old.state = 'voided' and new.state = 'replaced'
    and new.pt_wage_payment_id is null
    and new.voided_at is not distinct from old.voided_at
    and new.voided_by is not distinct from old.voided_by
    and new.void_reason is not distinct from old.void_reason
    and new.replaced_by_statement_id is not null
    and new.replaces_statement_id is not distinct from old.replaces_statement_id
  );

  v_state_transition_ok := new.state is not distinct from old.state
    or (old.state = 'finalized' and new.state = 'pdf_rendered')
    or (old.state = 'pdf_rendered' and new.state in ('sent', 'delivery_failed'))
    or (old.state = 'delivery_failed' and new.state in ('pdf_rendered', 'sent'))
    or (old.state in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent') and new.state = 'voided')
    or (old.state = 'voided' and new.state = 'replaced');

  if v_pdf_transition_ok and v_payment_transition_ok
     and v_lineage_transition_ok and v_state_transition_ok then
    return new;
  end if;
  raise exception 'PAYROLL_STATEMENT_IMMUTABLE' using errcode = '55000';
end;
$$;
revoke all on function public.reject_dealer_payroll_statement_mutation() from public, anon, authenticated;

do $$
begin
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dealer_payroll_statements'::regclass
      and conname = 'dealer_payroll_statements_version_positive'
  ) then
    alter table public.dealer_payroll_statements
      add constraint dealer_payroll_statements_version_positive
      check (statement_version > 0) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dealer_payroll_statements'::regclass
      and conname = 'dealer_payroll_statements_pdf_status_valid'
  ) then
    alter table public.dealer_payroll_statements
      add constraint dealer_payroll_statements_pdf_status_valid
      check (pdf_status in ('not_generated', 'generating', 'ready', 'failed')) not valid;
  end if;
  if not exists (
    select 1 from pg_constraint
    where conrelid = 'public.dealer_payroll_statements'::regclass
      and conname = 'dealer_payroll_statements_pdf_failure_code_valid'
  ) then
    alter table public.dealer_payroll_statements
      add constraint dealer_payroll_statements_pdf_failure_code_valid
      check (pdf_failure_code is null or pdf_failure_code ~ '^PAYROLL_PDF_[A-Z0-9_]{1,80}$') not valid;
  end if;
end;
$$;

update public.dealer_payroll_statements
set pdf_status = case
  when pdf_hash is not null
   and pdf_storage_path is not null
   and pdf_render_version is not null
   and pdf_rendered_at is not null then 'ready'
  else 'not_generated'
end
where pdf_status is distinct from case
  when pdf_hash is not null
   and pdf_storage_path is not null
   and pdf_render_version is not null
   and pdf_rendered_at is not null then 'ready'
  else 'not_generated'
end;

alter table public.dealer_payroll_statements
  validate constraint dealer_payroll_statements_version_positive;
alter table public.dealer_payroll_statements
  validate constraint dealer_payroll_statements_pdf_status_valid;
alter table public.dealer_payroll_statements
  validate constraint dealer_payroll_statements_pdf_failure_code_valid;

create unique index if not exists dealer_payroll_statements_active_ft_business_uq
  on public.dealer_payroll_statements (
    club_id, dealer_id, payroll_period_id, statement_kind, statement_version
  )
  where statement_kind = 'full_time_period'
    and state not in ('voided', 'replaced');

create table if not exists public.dealer_payroll_statement_rollout (
  id                    boolean primary key default true check (id),
  master_enabled        boolean not null default false,
  all_clubs_enabled     boolean not null default false,
  allowed_club_ids      uuid[] not null default '{}'::uuid[],
  updated_at            timestamptz not null default now(),
  updated_by            uuid references auth.users(id)
);

insert into public.dealer_payroll_statement_rollout (id)
values (true)
on conflict (id) do nothing;

alter table public.dealer_payroll_statement_rollout enable row level security;
alter table public.dealer_payroll_statement_rollout force row level security;
revoke all on table public.dealer_payroll_statement_rollout from public, anon, authenticated;
grant select, update on table public.dealer_payroll_statement_rollout to service_role;

create or replace function public._dealer_payroll_statement_rollout_allowed(p_club_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
declare
  v_allowed boolean := false;
begin
  if p_club_id is null then return false; end if;
  select r.master_enabled and (
    r.all_clubs_enabled or p_club_id = any(r.allowed_club_ids)
  )
  into v_allowed
  from public.dealer_payroll_statement_rollout r
  where r.id = true;
  return coalesce(v_allowed, false);
exception when others then
  return false;
end;
$$;
revoke all on function public._dealer_payroll_statement_rollout_allowed(uuid) from public, anon, authenticated;

create or replace function public._assert_dealer_payroll_statement_finalizer(p_club_id uuid)
returns uuid
language plpgsql
stable
security definer
set search_path = public, pg_temp
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
  ) then
    raise exception 'PAYROLL_STATEMENT_FINALIZE_FORBIDDEN' using errcode = '42501';
  end if;
  return v_actor;
end;
$$;
revoke all on function public._assert_dealer_payroll_statement_finalizer(uuid) from public, anon, authenticated;

create or replace function public._assert_dealer_payroll_statement_rollout(p_club_id uuid)
returns void
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  if not public._dealer_payroll_statement_rollout_allowed(p_club_id) then
    raise exception 'PAYROLL_STATEMENT_ROLLOUT_DISABLED' using errcode = 'P0001';
  end if;
end;
$$;
revoke all on function public._assert_dealer_payroll_statement_rollout(uuid) from public, anon, authenticated;

create or replace function public.get_dealer_payroll_statement_rollout(p_expected_club_id uuid)
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
begin
  perform public._assert_dealer_payroll_statement_actor(p_expected_club_id);
  select r.master_enabled, r.all_clubs_enabled,
         p_expected_club_id = any(r.allowed_club_ids)
  into v_master, v_all, v_allowlisted
  from public.dealer_payroll_statement_rollout r
  where r.id = true;
  return jsonb_build_object(
    'allowed', coalesce(v_master, false) and (coalesce(v_all, false) or coalesce(v_allowlisted, false)),
    'master_enabled', coalesce(v_master, false),
    'all_clubs_enabled', coalesce(v_all, false),
    'allowlisted', coalesce(v_allowlisted, false),
    'reason', case
      when not coalesce(v_master, false) then 'MASTER_OFF'
      when coalesce(v_all, false) or coalesce(v_allowlisted, false) then 'ENABLED'
      else 'CLUB_NOT_ALLOWLISTED'
    end
  );
exception when others then
  if sqlstate = '42501' then raise; end if;
  return jsonb_build_object(
    'allowed', false, 'master_enabled', false, 'all_clubs_enabled', false,
    'allowlisted', false, 'reason', 'ROLLOUT_UNAVAILABLE'
  );
end;
$$;
revoke all on function public.get_dealer_payroll_statement_rollout(uuid) from public, anon;
grant execute on function public.get_dealer_payroll_statement_rollout(uuid) to authenticated, service_role;

create or replace function public._build_full_time_payroll_statement_snapshot(
  p_club_id uuid,
  p_dealer_id uuid,
  p_payroll_period_id uuid,
  p_require_locked boolean default false
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_period public.payroll_periods%rowtype;
  v_payroll public.dealer_payroll%rowtype;
  v_dealer public.dealers%rowtype;
  v_club public.clubs%rowtype;
  v_source jsonb;
  v_dealer_snapshot jsonb;
  v_club_snapshot jsonb;
  v_financial_snapshot jsonb;
  v_lines jsonb;
  v_payload jsonb;
  v_net numeric;
  v_gross bigint;
  v_deductions bigint;
begin
  select * into v_period from public.payroll_periods
  where id = p_payroll_period_id and club_id = p_club_id;
  if not found then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if p_require_locked and v_period.status <> 'locked' then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_LOCKED' using errcode = 'P0001';
  end if;

  select * into v_dealer from public.dealers
  where id = p_dealer_id and club_id = p_club_id;
  if not found then
    raise exception 'PAYROLL_STATEMENT_DEALER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_dealer.employment_type <> 'full_time' then
    raise exception 'PAYROLL_STATEMENT_NOT_FULL_TIME_DEALER' using errcode = 'P0001';
  end if;

  select * into v_payroll from public.dealer_payroll
  where period_id = p_payroll_period_id
    and dealer_id = p_dealer_id
    and club_id = p_club_id;
  if not found or coalesce(v_payroll.status, '') = 'excluded' then
    raise exception 'PAYROLL_STATEMENT_SOURCE_PAYROLL_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_club from public.clubs where id = p_club_id;
  if not found then
    raise exception 'PAYROLL_STATEMENT_CLUB_NOT_FOUND' using errcode = 'P0002';
  end if;

  v_source := jsonb_build_object(
    'source_kind', case when v_period.status = 'locked'
      then 'locked_full_time_payroll' else 'saved_full_time_payroll_preview' end,
    'payroll_period', jsonb_build_object(
      'id', v_period.id,
      'year', v_period.period_year,
      'month', v_period.period_month,
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
    'brand_asset_version', 'v1',
    'brand_asset_hash', 'e9ba119de7f679a0530cb565a677e73acaad4789f5c86cf96c40fbf14f1e86f3'
  );
  v_financial_snapshot := jsonb_build_object(
    'currency', 'VND',
    'gross_amount_vnd', v_gross,
    'deduction_amount_vnd', v_deductions,
    'net_amount_vnd', v_net::bigint,
    'net_amount_source', 'dealer_payroll.net_pay_after_tax_vnd'
  );
  v_lines := jsonb_build_array(
    jsonb_build_object('line_no', 1, 'line_type', 'earning', 'line_code', 'base_salary', 'label', 'Luong co ban', 'quantity', 1, 'unit', 'ky', 'unit_rate_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,base_salary_vnd}', '')::numeric, 0)::bigint, 'amount_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,base_salary_vnd}', '')::numeric, 0)::bigint),
    jsonb_build_object('line_no', 2, 'line_type', 'earning', 'line_code', 'regular_pay', 'label', 'Gio thuong', 'quantity', coalesce(nullif(v_source #>> '{dealer_payroll,regular_hours}', '')::numeric, 0), 'unit', 'gio', 'unit_rate_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,hourly_rate_vnd}', '')::numeric, 0)::bigint, 'amount_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,regular_pay_vnd}', '')::numeric, 0)::bigint),
    jsonb_build_object('line_no', 3, 'line_type', 'earning', 'line_code', 'ot_pay', 'label', 'Tang ca', 'quantity', coalesce(nullif(v_source #>> '{dealer_payroll,ot_hours}', '')::numeric, 0), 'unit', 'gio', 'unit_rate_vnd', null, 'amount_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,ot_pay_vnd}', '')::numeric, 0)::bigint),
    jsonb_build_object('line_no', 4, 'line_type', 'adjustment', 'line_code', 'adjustments', 'label', 'Dieu chinh', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', coalesce(nullif(v_source #>> '{dealer_payroll,total_adjustments_vnd}', '')::numeric, 0)::bigint),
    jsonb_build_object('line_no', 5, 'line_type', 'deduction', 'line_code', 'bhxh', 'label', 'BHXH', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', -coalesce(nullif(v_source #>> '{dealer_payroll,bhxh_deduction_vnd}', '')::numeric, 0)::bigint),
    jsonb_build_object('line_no', 6, 'line_type', 'deduction', 'line_code', 'bhyt', 'label', 'BHYT', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', -coalesce(nullif(v_source #>> '{dealer_payroll,bhyt_deduction_vnd}', '')::numeric, 0)::bigint),
    jsonb_build_object('line_no', 7, 'line_type', 'deduction', 'line_code', 'bhtn', 'label', 'BHTN', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', -coalesce(nullif(v_source #>> '{dealer_payroll,bhtn_deduction_vnd}', '')::numeric, 0)::bigint),
    jsonb_build_object('line_no', 8, 'line_type', 'deduction', 'line_code', 'pit', 'label', 'Thue TNCN', 'quantity', null, 'unit', null, 'unit_rate_vnd', null, 'amount_vnd', -coalesce(nullif(v_source #>> '{dealer_payroll,pit_deduction_vnd}', '')::numeric, 0)::bigint)
  );
  v_payload := jsonb_build_object(
    'source_snapshot', v_source,
    'dealer_snapshot', v_dealer_snapshot,
    'club_snapshot', v_club_snapshot,
    'financial_snapshot', v_financial_snapshot,
    'statement_version', 1
  );

  return jsonb_build_object(
    'id', v_payroll.id,
    'club_id', p_club_id,
    'dealer_id', p_dealer_id,
    'statement_kind', 'full_time_period',
    'statement_version', 1,
    'state', 'previewed',
    'cutoff_at', null,
    'gross_amount_vnd', v_gross,
    'deduction_amount_vnd', v_deductions,
    'net_amount_vnd', v_net::bigint,
    'source_snapshot', v_source,
    'dealer_snapshot', v_dealer_snapshot,
    'club_snapshot', v_club_snapshot,
    'financial_snapshot', v_financial_snapshot,
    'source_fingerprint', public._dealer_payroll_statement_sha256(v_source),
    'statement_hash', public._dealer_payroll_statement_sha256(v_payload),
    'finalized_at', null,
    'pt_wage_payment_id', null,
    'lines', v_lines
  );
end;
$$;
revoke all on function public._build_full_time_payroll_statement_snapshot(uuid,uuid,uuid,boolean) from public, anon, authenticated;

create or replace function public.preview_full_time_payroll_statement(
  p_club_id uuid,
  p_dealer_id uuid,
  p_payroll_period_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_dealer_payroll_statement_actor(p_club_id);
  perform public._assert_dealer_payroll_statement_rollout(p_club_id);
  return public._build_full_time_payroll_statement_snapshot(
    p_club_id, p_dealer_id, p_payroll_period_id, false
  );
end;
$$;
revoke all on function public.preview_full_time_payroll_statement(uuid,uuid,uuid) from public, anon;
grant execute on function public.preview_full_time_payroll_statement(uuid,uuid,uuid) to authenticated, service_role;

create or replace function public.list_full_time_payroll_statements_for_period(
  p_club_id uuid,
  p_payroll_period_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, pg_temp
as $$
begin
  perform public._assert_dealer_payroll_statement_actor(p_club_id);
  perform public._assert_dealer_payroll_statement_rollout(p_club_id);
  if not exists (
    select 1 from public.payroll_periods p
    where p.id = p_payroll_period_id and p.club_id = p_club_id
  ) then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_FOUND' using errcode = 'P0002';
  end if;
  return coalesce((
    select jsonb_agg(jsonb_build_object(
      'statement_id', s.id,
      'dealer_id', s.dealer_id,
      'state', s.state,
      'statement_version', s.statement_version,
      'statement_hash', s.statement_hash,
      'source_fingerprint', s.source_fingerprint,
      'finalized_at', s.finalized_at,
      'pdf_status', s.pdf_status,
      'pdf_failure_code', s.pdf_failure_code,
      'pdf_rendered_at', s.pdf_rendered_at
    ) order by s.dealer_id, s.finalized_at desc)
    from public.dealer_payroll_statements s
    where s.club_id = p_club_id
      and s.payroll_period_id = p_payroll_period_id
      and s.statement_kind = 'full_time_period'
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_full_time_payroll_statements_for_period(uuid,uuid) from public, anon;
grant execute on function public.list_full_time_payroll_statements_for_period(uuid,uuid) to authenticated, service_role;

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
set search_path = public, extensions, pg_temp
as $$
declare
  v_actor uuid;
  v_existing public.dealer_payroll_statements%rowtype;
  v_replaced public.dealer_payroll_statements%rowtype;
  v_snapshot jsonb;
  v_statement_id uuid;
  v_line jsonb;
  v_source_payroll_id uuid;
  v_source_fingerprint text;
  v_statement_hash text;
  v_reason text := nullif(btrim(p_reason), '');
begin
  if p_request_id is null or p_club_id is null or p_dealer_id is null or p_payroll_period_id is null then
    raise exception 'PAYROLL_STATEMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  perform public._assert_dealer_payroll_statement_rollout(p_club_id);
  v_actor := public._assert_dealer_payroll_statement_finalizer(p_club_id);

  perform pg_advisory_xact_lock(hashtextextended(
    'payroll-ft:' || p_club_id::text || ':' || p_dealer_id::text || ':' || p_payroll_period_id::text || ':1', 0
  ));

  select * into v_existing from public.dealer_payroll_statements
  where club_id = p_club_id and request_id = p_request_id
  for update;
  if found then
    if v_existing.statement_kind <> 'full_time_period'
       or v_existing.statement_version <> 1
       or v_existing.dealer_id <> p_dealer_id
       or v_existing.payroll_period_id <> p_payroll_period_id then
      raise exception 'PAYROLL_STATEMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'statement_id', v_existing.id, 'state', v_existing.state,
      'net_amount_vnd', v_existing.net_amount_vnd,
      'statement_hash', v_existing.statement_hash,
      'idempotent', true, 'deduplicated_by', 'request_id'
    );
  end if;

  perform 1 from public.payroll_periods
  where id = p_payroll_period_id and club_id = p_club_id for update;
  perform 1 from public.dealers
  where id = p_dealer_id and club_id = p_club_id for share;
  perform 1 from public.dealer_payroll
  where period_id = p_payroll_period_id and dealer_id = p_dealer_id and club_id = p_club_id for share;
  perform 1 from public.clubs where id = p_club_id for share;

  v_snapshot := public._build_full_time_payroll_statement_snapshot(
    p_club_id, p_dealer_id, p_payroll_period_id, true
  );
  v_source_payroll_id := (v_snapshot #>> '{source_snapshot,dealer_payroll,id}')::uuid;
  v_source_fingerprint := v_snapshot->>'source_fingerprint';
  v_statement_hash := v_snapshot->>'statement_hash';

  select * into v_existing from public.dealer_payroll_statements s
  where s.club_id = p_club_id
    and s.dealer_id = p_dealer_id
    and s.payroll_period_id = p_payroll_period_id
    and s.statement_kind = 'full_time_period'
    and s.statement_version = 1
    and s.state not in ('voided', 'replaced')
  for update;
  if found then
    if v_existing.source_fingerprint <> v_source_fingerprint
       or v_existing.statement_hash <> v_statement_hash then
      raise exception 'PAYROLL_STATEMENT_BUSINESS_CONFLICT' using errcode = '40001';
    end if;
    return jsonb_build_object(
      'statement_id', v_existing.id, 'state', v_existing.state,
      'net_amount_vnd', v_existing.net_amount_vnd,
      'statement_hash', v_existing.statement_hash,
      'idempotent', true, 'deduplicated_by', 'business_key'
    );
  end if;

  if p_replaces_statement_id is not null then
    select * into v_replaced from public.dealer_payroll_statements
    where id = p_replaces_statement_id for update;
    if not found
       or v_replaced.state <> 'voided'
       or v_replaced.club_id <> p_club_id
       or v_replaced.dealer_id <> p_dealer_id
       or v_replaced.statement_kind <> 'full_time_period'
       or v_replaced.source_dealer_payroll_id <> v_source_payroll_id then
      raise exception 'PAYROLL_STATEMENT_REPLACEMENT_INVALID' using errcode = 'P0001';
    end if;
  end if;

  begin
    insert into public.dealer_payroll_statements (
      club_id, dealer_id, statement_kind, statement_version, state, request_id,
      payroll_period_id, source_dealer_payroll_id, replaces_statement_id,
      gross_amount_vnd, deduction_amount_vnd, net_amount_vnd,
      source_snapshot, dealer_snapshot, club_snapshot, financial_snapshot,
      source_fingerprint, statement_hash, finalized_by
    ) values (
      p_club_id, p_dealer_id, 'full_time_period', 1, 'finalized', p_request_id,
      p_payroll_period_id, v_source_payroll_id, p_replaces_statement_id,
      (v_snapshot->>'gross_amount_vnd')::bigint,
      (v_snapshot->>'deduction_amount_vnd')::bigint,
      (v_snapshot->>'net_amount_vnd')::bigint,
      v_snapshot->'source_snapshot', v_snapshot->'dealer_snapshot',
      v_snapshot->'club_snapshot', v_snapshot->'financial_snapshot',
      v_source_fingerprint, v_statement_hash, v_actor
    ) returning id into v_statement_id;
  exception when unique_violation then
    select * into v_existing from public.dealer_payroll_statements s
    where s.club_id = p_club_id
      and s.dealer_id = p_dealer_id
      and s.payroll_period_id = p_payroll_period_id
      and s.statement_kind = 'full_time_period'
      and s.statement_version = 1
      and s.state not in ('voided', 'replaced')
    for update;
    if found
       and v_existing.source_fingerprint = v_source_fingerprint
       and v_existing.statement_hash = v_statement_hash then
      return jsonb_build_object(
        'statement_id', v_existing.id, 'state', v_existing.state,
        'net_amount_vnd', v_existing.net_amount_vnd,
        'statement_hash', v_existing.statement_hash,
        'idempotent', true, 'deduplicated_by', 'business_key'
      );
    end if;
    raise exception 'PAYROLL_STATEMENT_BUSINESS_CONFLICT' using errcode = '40001';
  end;

  for v_line in select value from jsonb_array_elements(v_snapshot->'lines') loop
    insert into public.dealer_payroll_statement_lines (
      statement_id, line_no, line_type, line_code, label,
      quantity, unit, unit_rate_vnd, amount_vnd, source_snapshot
    ) values (
      v_statement_id, (v_line->>'line_no')::integer,
      v_line->>'line_type', v_line->>'line_code', v_line->>'label',
      nullif(v_line->>'quantity', '')::numeric, nullif(v_line->>'unit', ''),
      nullif(v_line->>'unit_rate_vnd', '')::bigint,
      (v_line->>'amount_vnd')::bigint, v_line
    );
  end loop;

  if p_replaces_statement_id is not null then
    update public.dealer_payroll_statements
    set state = 'replaced', replaced_by_statement_id = v_statement_id
    where id = p_replaces_statement_id;
  end if;

  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, new_values, changed_by, reason
  ) values (
    'dealer_payroll_statements', v_statement_id, p_club_id, 'INSERT',
    jsonb_build_object(
      'statement_kind', 'full_time_period', 'statement_version', 1,
      'state', 'finalized', 'net_amount_vnd', (v_snapshot->>'net_amount_vnd')::bigint,
      'statement_hash', v_statement_hash
    ),
    v_actor, coalesce(v_reason, 'FT payroll statement finalized from locked payroll period')
  );

  return jsonb_build_object(
    'statement_id', v_statement_id, 'state', 'finalized',
    'net_amount_vnd', (v_snapshot->>'net_amount_vnd')::bigint,
    'statement_hash', v_statement_hash,
    'idempotent', false, 'deduplicated_by', null
  );
end;
$$;
revoke all on function public.finalize_full_time_payroll_statement(uuid,uuid,uuid,uuid,text,uuid) from public, anon;
grant execute on function public.finalize_full_time_payroll_statement(uuid,uuid,uuid,uuid,text,uuid) to authenticated;

create or replace function public.claim_dealer_payroll_statement_pdf(
  p_statement_id uuid,
  p_request_id uuid
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_statement public.dealer_payroll_statements%rowtype;
  v_token uuid;
  v_path text;
begin
  if p_statement_id is null or p_request_id is null then
    raise exception 'PAYROLL_PDF_INVALID_CLAIM_REQUEST' using errcode = 'P0001';
  end if;
  select * into v_statement from public.dealer_payroll_statements
  where id = p_statement_id for update;
  if not found then
    raise exception 'PAYROLL_STATEMENT_NOT_FOUND' using errcode = 'P0002';
  end if;
  perform public._assert_dealer_payroll_statement_rollout(v_statement.club_id);
  if v_statement.state in ('voided', 'replaced') then
    raise exception 'PAYROLL_PDF_STATEMENT_NOT_RENDERABLE' using errcode = 'P0001';
  end if;
  if v_statement.pdf_status = 'ready' then
    if v_statement.pdf_hash is null or v_statement.pdf_storage_path is null
       or v_statement.pdf_render_version is null or v_statement.pdf_rendered_at is null then
      raise exception 'PAYROLL_PDF_READY_METADATA_INVALID' using errcode = 'P0001';
    end if;
    return jsonb_build_object(
      'outcome', 'ready', 'statement_id', v_statement.id,
      'club_id', v_statement.club_id, 'statement_hash', v_statement.statement_hash,
      'pdf_hash', v_statement.pdf_hash, 'storage_path', v_statement.pdf_storage_path,
      'render_version', v_statement.pdf_render_version
    );
  end if;
  if v_statement.pdf_status = 'generating'
     and v_statement.pdf_generation_started_at > now() - interval '2 minutes' then
    return jsonb_build_object('outcome', 'generating', 'statement_id', v_statement.id);
  end if;
  if v_statement.state not in ('finalized', 'pdf_rendered', 'delivery_failed', 'sent') then
    raise exception 'PAYROLL_STATEMENT_NOT_FINALIZED' using errcode = 'P0001';
  end if;
  v_token := gen_random_uuid();
  v_path := 'statements/' || v_statement.club_id::text || '/' || v_statement.id::text || '/statement.pdf';
  update public.dealer_payroll_statements
  set pdf_status = 'generating',
      pdf_generation_request_id = p_request_id,
      pdf_generation_token = v_token,
      pdf_generation_started_at = now(),
      pdf_failure_code = null,
      pdf_failed_at = null
  where id = v_statement.id;
  return jsonb_build_object(
    'outcome', 'claimed', 'statement_id', v_statement.id,
    'club_id', v_statement.club_id, 'statement_hash', v_statement.statement_hash,
    'generation_token', v_token, 'storage_path', v_path
  );
end;
$$;

create or replace function public.complete_dealer_payroll_statement_pdf(
  p_statement_id uuid,
  p_generation_token uuid,
  p_pdf_hash text,
  p_render_version text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_statement public.dealer_payroll_statements%rowtype;
  v_path text;
begin
  if p_statement_id is null or p_generation_token is null
     or p_pdf_hash is null or p_pdf_hash !~ '^[0-9a-f]{64}$'
     or p_render_version is null or p_render_version !~ '^[a-z0-9._-]{1,64}$' then
    raise exception 'PAYROLL_PDF_INVALID_COMPLETE_REQUEST' using errcode = 'P0001';
  end if;
  select * into v_statement from public.dealer_payroll_statements
  where id = p_statement_id for update;
  if not found then raise exception 'PAYROLL_STATEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  perform public._assert_dealer_payroll_statement_rollout(v_statement.club_id);
  if v_statement.pdf_status = 'ready' then
    if v_statement.pdf_hash <> p_pdf_hash or v_statement.pdf_render_version <> p_render_version then
      raise exception 'PAYROLL_PDF_OBJECT_CONFLICT' using errcode = '40001';
    end if;
    return jsonb_build_object('outcome', 'ready', 'idempotent', true, 'pdf_hash', v_statement.pdf_hash);
  end if;
  if v_statement.pdf_status <> 'generating'
     or v_statement.pdf_generation_token <> p_generation_token then
    raise exception 'PAYROLL_PDF_GENERATION_CLAIM_LOST' using errcode = '40001';
  end if;
  v_path := 'statements/' || v_statement.club_id::text || '/' || v_statement.id::text || '/statement.pdf';
  update public.dealer_payroll_statements
  set state = case when state in ('finalized', 'delivery_failed') then 'pdf_rendered' else state end,
      pdf_status = 'ready', pdf_hash = p_pdf_hash,
      pdf_storage_path = v_path, pdf_render_version = p_render_version,
      pdf_rendered_at = now(), pdf_generation_token = null,
      pdf_failure_code = null, pdf_failed_at = null
  where id = v_statement.id;
  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, new_values, changed_by, reason
  ) values (
    'dealer_payroll_statements', v_statement.id, v_statement.club_id, 'UPDATE',
    jsonb_build_object('state', 'pdf_rendered', 'pdf_status', 'ready', 'pdf_hash', p_pdf_hash, 'render_version', p_render_version),
    null, 'Server-rendered immutable payroll PDF completed by claim token'
  );
  return jsonb_build_object(
    'outcome', 'ready', 'idempotent', false, 'statement_id', v_statement.id,
    'pdf_hash', p_pdf_hash, 'storage_path', v_path, 'render_version', p_render_version
  );
end;
$$;

create or replace function public.fail_dealer_payroll_statement_pdf(
  p_statement_id uuid,
  p_generation_token uuid,
  p_error_code text
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_statement public.dealer_payroll_statements%rowtype;
begin
  if p_statement_id is null or p_generation_token is null
     or p_error_code is null or p_error_code !~ '^PAYROLL_PDF_[A-Z0-9_]{1,80}$' then
    raise exception 'PAYROLL_PDF_INVALID_FAILURE_REQUEST' using errcode = 'P0001';
  end if;
  select * into v_statement from public.dealer_payroll_statements
  where id = p_statement_id for update;
  if not found then raise exception 'PAYROLL_STATEMENT_NOT_FOUND' using errcode = 'P0002'; end if;
  if v_statement.pdf_status = 'ready' then
    raise exception 'PAYROLL_PDF_READY_IS_IMMUTABLE' using errcode = '55000';
  end if;
  if v_statement.pdf_status <> 'generating'
     or v_statement.pdf_generation_token <> p_generation_token then
    raise exception 'PAYROLL_PDF_GENERATION_CLAIM_LOST' using errcode = '40001';
  end if;
  update public.dealer_payroll_statements
  set pdf_status = 'failed', pdf_failure_code = p_error_code,
      pdf_failed_at = now(), pdf_generation_token = null
  where id = v_statement.id;
  return jsonb_build_object('outcome', 'failed', 'error_code', p_error_code);
end;
$$;

revoke all on function public.claim_dealer_payroll_statement_pdf(uuid,uuid) from public, anon, authenticated;
revoke all on function public.complete_dealer_payroll_statement_pdf(uuid,uuid,text,text) from public, anon, authenticated;
revoke all on function public.fail_dealer_payroll_statement_pdf(uuid,uuid,text) from public, anon, authenticated;
grant execute on function public.claim_dealer_payroll_statement_pdf(uuid,uuid) to service_role;
grant execute on function public.complete_dealer_payroll_statement_pdf(uuid,uuid,text,text) to service_role;
grant execute on function public.fail_dealer_payroll_statement_pdf(uuid,uuid,text) to service_role;

comment on table public.dealer_payroll_statement_rollout is
  'Runtime kill switch for immutable FT payroll statement preview/finalize/PDF. Defaults OFF with an empty allowlist.';
comment on column public.dealer_payroll_statements.pdf_status is
  'Independent first-write PDF state machine: not_generated, generating, ready, failed.';

do $$
begin
  if to_regclass('public.dealer_payroll_statement_rollout') is null
     or to_regprocedure('public.get_dealer_payroll_statement_rollout(uuid)') is null
     or to_regprocedure('public.preview_full_time_payroll_statement(uuid,uuid,uuid)') is null
     or to_regprocedure('public.list_full_time_payroll_statements_for_period(uuid,uuid)') is null
     or to_regprocedure('public.claim_dealer_payroll_statement_pdf(uuid,uuid)') is null
     or to_regprocedure('public.complete_dealer_payroll_statement_pdf(uuid,uuid,text,text)') is null
     or to_regprocedure('public.fail_dealer_payroll_statement_pdf(uuid,uuid,text)') is null then
    raise exception 'PAYROLL_STATEMENT_FT_UI_CONTRACT_INCOMPLETE' using errcode = 'P0001';
  end if;
end;
$$;

commit;
