-- PT immutable payroll statements grouped into a locked payroll period for PDF
-- preparation and Telegram delivery. The payroll period is a delivery batch
-- label only; PT money remains the effective-dated server balance frozen by
-- the same server snapshot helper used by preview and finalization.
--
-- ROLLBACK: disable dealer_payroll_statement_rollout and
-- dealer_payroll_statement_delivery_rollout. Do not delete statements, links,
-- PDFs, delivery attempts, or audit evidence.

begin;

do $preflight$
begin
  if to_regclass('public.dealer_payroll_statements') is null
     or to_regclass('public.dealer_pt_wage_settlements') is null
     or to_regclass('public.dealer_payroll_delivery_operations') is null
     or to_regclass('public.dealer_payroll_delivery_targets') is null
     or to_regprocedure('public._pt_wage_balance(uuid)') is null
     or to_regprocedure('public._dealer_payroll_statement_sha256(jsonb)') is null
     or to_regprocedure('public._assert_dealer_payroll_statement_actor(uuid)') is null
     or to_regprocedure('public._assert_dealer_payroll_statement_finalizer(uuid)') is null
     or to_regprocedure('public._assert_dealer_payroll_statement_rollout(uuid)') is null
     or to_regprocedure('public.create_dealer_payroll_statement_delivery_operation(uuid,uuid,uuid)') is null
     or to_regprocedure('public._refresh_dealer_payroll_delivery_operation(uuid)') is null then
    raise exception 'PAYROLL_PT_STATEMENT_DEPENDENCY_UNAVAILABLE' using errcode = 'P0001';
  end if;
end;
$preflight$;

create table if not exists public.dealer_payroll_statement_period_links (
  statement_id       uuid primary key references public.dealer_payroll_statements(id),
  club_id            uuid not null references public.clubs(id),
  dealer_id          uuid not null references public.dealers(id),
  payroll_period_id  uuid not null references public.payroll_periods(id),
  linked_by          uuid not null references auth.users(id),
  linked_at          timestamptz not null default now(),
  unique (club_id, payroll_period_id, dealer_id)
);

create index if not exists dealer_payroll_statement_period_links_period_idx
  on public.dealer_payroll_statement_period_links (club_id, payroll_period_id, dealer_id);

alter table public.dealer_payroll_statement_period_links enable row level security;
alter table public.dealer_payroll_statement_period_links force row level security;
revoke all on table public.dealer_payroll_statement_period_links from public, anon, authenticated;
grant select, insert on table public.dealer_payroll_statement_period_links to service_role;

create or replace function public._build_part_time_payroll_statement_preview(
  p_club_id uuid,
  p_dealer_id uuid,
  p_payroll_period_id uuid
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public, extensions, pg_temp
as $$
declare
  v_period public.payroll_periods%rowtype;
  v_dealer public.dealers%rowtype;
  v_club public.clubs%rowtype;
  v_balance jsonb;
  v_rate_segments jsonb;
  v_source jsonb;
  v_dealer_snapshot jsonb;
  v_club_snapshot jsonb;
  v_financial_snapshot jsonb;
  v_payload jsonb;
  v_lines jsonb;
  v_amount bigint;
  v_minutes integer;
  v_rate integer;
  v_anchor timestamptz;
  v_cutoff timestamptz;
begin
  select * into v_period
  from public.payroll_periods
  where id = p_payroll_period_id and club_id = p_club_id;
  if not found then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_FOUND' using errcode = 'P0002';
  end if;

  select * into v_dealer
  from public.dealers
  where id = p_dealer_id and club_id = p_club_id and status = 'active';
  if not found then
    raise exception 'PAYROLL_STATEMENT_DEALER_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_dealer.employment_type <> 'part_time' then
    raise exception 'PAYROLL_STATEMENT_NOT_PART_TIME_DEALER' using errcode = 'P0001';
  end if;

  select * into v_club from public.clubs where id = p_club_id;
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
    'source_kind', 'part_time_effective_dated_balance_preview',
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
    'brand_asset_version', 'v1',
    'brand_asset_hash', 'e9ba119de7f679a0530cb565a677e73acaad4789f5c86cf96c40fbf14f1e86f3'
  );
  v_financial_snapshot := jsonb_build_object(
    'currency', 'VND',
    'gross_amount_vnd', v_amount,
    'deduction_amount_vnd', 0,
    'net_amount_vnd', v_amount,
    'net_amount_source', 'server_preview_pt_rate_segments',
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
  select coalesce(jsonb_agg(jsonb_build_object(
    'line_no', row_number,
    'line_type', 'rate_segment',
    'line_code', 'pt_rate_segment',
    'label', 'Luong theo don gia hieu luc',
    'quantity', coalesce(nullif(segment->>'elapsed_seconds', '')::numeric, 0) / 3600,
    'unit', 'gio',
    'unit_rate_vnd', nullif(segment->>'hourly_rate_vnd', '')::bigint,
    'amount_vnd', floor(coalesce(nullif(segment->>'amount_vnd', '')::numeric, 0))::bigint,
    'source_snapshot', segment
  ) order by row_number), '[]'::jsonb)
  into v_lines
  from jsonb_array_elements(v_rate_segments) with ordinality as rate_rows(segment, row_number);

  v_payload := jsonb_build_object(
    'source_snapshot', v_source,
    'dealer_snapshot', v_dealer_snapshot,
    'club_snapshot', v_club_snapshot,
    'financial_snapshot', v_financial_snapshot,
    'statement_version', 1
  );

  return jsonb_build_object(
    'id', p_dealer_id,
    'club_id', p_club_id,
    'dealer_id', p_dealer_id,
    'statement_kind', 'part_time_settlement',
    'statement_version', 1,
    'state', 'previewed',
    'cutoff_at', v_cutoff,
    'gross_amount_vnd', v_amount,
    'deduction_amount_vnd', 0,
    'net_amount_vnd', v_amount,
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
revoke all on function public._build_part_time_payroll_statement_preview(uuid,uuid,uuid) from public, anon, authenticated;

create or replace function public.preview_part_time_payroll_statement(
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
  return public._build_part_time_payroll_statement_preview(
    p_club_id, p_dealer_id, p_payroll_period_id
  );
end;
$$;
revoke all on function public.preview_part_time_payroll_statement(uuid,uuid,uuid) from public, anon;
grant execute on function public.preview_part_time_payroll_statement(uuid,uuid,uuid) to authenticated, service_role;

create or replace function public.list_part_time_payroll_statements_for_period(
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
    from public.dealer_payroll_statement_period_links l
    join public.dealer_payroll_statements s on s.id = l.statement_id
    where l.club_id = p_club_id
      and l.payroll_period_id = p_payroll_period_id
      and s.statement_kind = 'part_time_settlement'
      and s.state not in ('voided', 'replaced')
  ), '[]'::jsonb);
end;
$$;
revoke all on function public.list_part_time_payroll_statements_for_period(uuid,uuid) from public, anon;
grant execute on function public.list_part_time_payroll_statements_for_period(uuid,uuid) to authenticated, service_role;

create or replace function public.finalize_part_time_payroll_statement_for_period(
  p_request_id uuid,
  p_club_id uuid,
  p_dealer_id uuid,
  p_payroll_period_id uuid,
  p_reason text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public, pg_temp
as $$
declare
  v_actor uuid;
  v_period public.payroll_periods%rowtype;
  v_link public.dealer_payroll_statement_period_links%rowtype;
  v_pending_statement_id uuid;
  v_existing public.dealer_payroll_statements%rowtype;
  v_preview jsonb;
  v_source jsonb;
  v_dealer_snapshot jsonb;
  v_club_snapshot jsonb;
  v_financial_snapshot jsonb;
  v_payload jsonb;
  v_lines jsonb;
  v_line jsonb;
  v_line_no integer := 0;
  v_settlement_id uuid;
  v_amount bigint;
  v_minutes integer;
  v_rate integer;
  v_anchor timestamptz;
  v_cutoff timestamptz;
  v_statement_hash text;
  v_result jsonb;
  v_statement_id uuid;
begin
  if p_request_id is null or p_club_id is null or p_dealer_id is null or p_payroll_period_id is null then
    raise exception 'PAYROLL_STATEMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  perform public._assert_dealer_payroll_statement_rollout(p_club_id);
  v_actor := public._assert_dealer_payroll_statement_finalizer(p_club_id);

  -- Keep the canonical PT policy/dealer lock order used by payout and legacy
  -- finalization before taking the delivery-period lock.
  perform pg_advisory_xact_lock(hashtext('dealer_pt_wage_policy:' || p_club_id::text));
  perform pg_advisory_xact_lock(hashtext('pt_wage:' || p_dealer_id::text));
  perform pg_advisory_xact_lock(hashtextextended(
    'pt-statement-period:' || p_club_id::text || ':' || p_payroll_period_id::text || ':' || p_dealer_id::text, 0
  ));
  select * into v_period
  from public.payroll_periods
  where id = p_payroll_period_id and club_id = p_club_id
  for share;
  if not found then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_period.status <> 'locked' then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_LOCKED' using errcode = 'P0001';
  end if;

  select * into v_existing
  from public.dealer_payroll_statements
  where club_id = p_club_id and request_id = p_request_id
  for update;
  if found then
    if v_existing.statement_kind <> 'part_time_settlement'
       or v_existing.dealer_id <> p_dealer_id then
      raise exception 'PAYROLL_STATEMENT_IDEMPOTENCY_CONFLICT' using errcode = 'P0001';
    end if;
  end if;

  select * into v_link
  from public.dealer_payroll_statement_period_links
  where club_id = p_club_id
    and payroll_period_id = p_payroll_period_id
    and dealer_id = p_dealer_id
  for update;
  if found then
    return jsonb_build_object(
      'statement_id', v_link.statement_id,
      'state', (select s.state from public.dealer_payroll_statements s where s.id = v_link.statement_id),
      'idempotent', true,
      'payroll_period_id', p_payroll_period_id
    );
  end if;

  if v_existing.id is not null then
    raise exception 'PAYROLL_STATEMENT_PERIOD_LINK_MISSING' using errcode = 'P0001';
  end if;

  perform 1
  from public.dealers d
  where d.id = p_dealer_id
    and d.club_id = p_club_id
    and d.status = 'active'
    and d.employment_type = 'part_time'
  for update;
  if not found then
    raise exception 'PAYROLL_STATEMENT_DEALER_NOT_FOUND' using errcode = 'P0002';
  end if;

  select s.statement_id into v_pending_statement_id
  from public.dealer_pt_wage_settlements s
  where s.dealer_id = p_dealer_id and s.club_id = p_club_id and s.status = 'finalized'
  order by s.finalized_at, s.id
  limit 1
  for update;
  if found then
    raise exception 'PT_FINALIZED_STATEMENT_PENDING_PAYMENT' using errcode = 'P0001';
  end if;

  v_preview := public._build_part_time_payroll_statement_preview(
    p_club_id, p_dealer_id, p_payroll_period_id
  );
  v_source := v_preview->'source_snapshot';
  v_dealer_snapshot := v_preview->'dealer_snapshot';
  v_club_snapshot := v_preview->'club_snapshot';
  v_financial_snapshot := v_preview->'financial_snapshot';
  v_lines := coalesce(v_preview->'lines', '[]'::jsonb);
  v_amount := nullif(v_preview->>'net_amount_vnd', '')::bigint;
  v_minutes := nullif(v_financial_snapshot->>'minutes_reserved', '')::integer;
  v_rate := nullif(v_financial_snapshot->>'hourly_rate_vnd_snapshot', '')::integer;
  v_anchor := nullif(v_source->>'covered_from', '')::timestamptz;
  v_cutoff := nullif(v_source->>'covered_to', '')::timestamptz;
  v_payload := jsonb_build_object(
    'source_snapshot', v_source,
    'dealer_snapshot', v_dealer_snapshot,
    'club_snapshot', v_club_snapshot,
    'financial_snapshot', v_financial_snapshot,
    'statement_version', 1
  );
  v_statement_hash := public._dealer_payroll_statement_sha256(v_payload);

  if v_amount is null or v_amount <= 0 or v_minutes is null
     or v_anchor is null or v_cutoff is null or v_cutoff < v_anchor
     or jsonb_typeof(v_lines) <> 'array' or jsonb_array_length(v_lines) = 0
     or nullif(v_club_snapshot->>'brand_asset_hash', '') is null then
    raise exception 'PAYROLL_STATEMENT_FINALIZATION_UNAVAILABLE' using errcode = 'P0001';
  end if;

  insert into public.dealer_payroll_statements (
    club_id, dealer_id, statement_kind, statement_version, state, request_id, cutoff_at,
    gross_amount_vnd, deduction_amount_vnd, net_amount_vnd,
    source_snapshot, dealer_snapshot, club_snapshot, financial_snapshot,
    source_fingerprint, statement_hash, finalized_by
  ) values (
    p_club_id, p_dealer_id, 'part_time_settlement', 1, 'finalized', p_request_id, v_cutoff,
    v_amount, 0, v_amount,
    v_source, v_dealer_snapshot, v_club_snapshot, v_financial_snapshot,
    public._dealer_payroll_statement_sha256(v_source), v_statement_hash, v_actor
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

  for v_line in select value from jsonb_array_elements(v_lines)
  loop
    v_line_no := v_line_no + 1;
    insert into public.dealer_payroll_statement_lines (
      statement_id, line_no, line_type, line_code, label, quantity,
      unit, unit_rate_vnd, amount_vnd, source_snapshot
    ) values (
      v_statement_id,
      coalesce(nullif(v_line->>'line_no', '')::integer, v_line_no),
      coalesce(nullif(v_line->>'line_type', ''), 'rate_segment'),
      coalesce(nullif(v_line->>'line_code', ''), 'pt_rate_segment'),
      coalesce(nullif(v_line->>'label', ''), 'Luong theo don gia hieu luc'),
      nullif(v_line->>'quantity', '')::numeric,
      nullif(v_line->>'unit', ''),
      nullif(v_line->>'unit_rate_vnd', '')::bigint,
      nullif(v_line->>'amount_vnd', '')::bigint,
      coalesce(v_line->'source_snapshot', '{}'::jsonb)
    );
  end loop;

  insert into public.dealer_payroll_statement_period_links (
    statement_id, club_id, dealer_id, payroll_period_id, linked_by
  ) values (
    v_statement_id, p_club_id, p_dealer_id, p_payroll_period_id, v_actor
  );

  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, new_values, changed_by, reason
  ) values (
    'dealer_payroll_statement_period_links', v_statement_id, p_club_id, 'INSERT',
    jsonb_build_object('payroll_period_id', p_payroll_period_id, 'statement_kind', 'part_time_settlement'),
    v_actor, coalesce(nullif(btrim(p_reason), ''), 'PT statement linked to locked payroll delivery period')
  );

  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, new_values, changed_by, reason
  ) values (
    'dealer_payroll_statements', v_statement_id, p_club_id, 'INSERT',
    jsonb_build_object(
      'statement_kind', 'part_time_settlement',
      'state', 'finalized',
      'net_amount_vnd', v_amount,
      'cutoff_at', v_cutoff,
      'statement_hash', v_statement_hash,
      'payroll_period_id', p_payroll_period_id
    ),
    v_actor, coalesce(nullif(btrim(p_reason), ''), 'PT payroll statement finalized for locked delivery period')
  );
  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, new_values, changed_by, reason
  ) values (
    'dealer_pt_wage_settlements', v_settlement_id, p_club_id, 'INSERT',
    jsonb_build_object(
      'statement_id', v_statement_id,
      'covered_from', v_anchor,
      'covered_to', v_cutoff,
      'amount_vnd', v_amount
    ),
    v_actor, coalesce(nullif(btrim(p_reason), ''), 'PT wage interval reserved by finalized statement')
  );

  v_result := jsonb_build_object(
    'statement_id', v_statement_id,
    'settlement_id', v_settlement_id,
    'state', 'finalized',
    'net_amount_vnd', v_amount,
    'cutoff_at', v_cutoff,
    'statement_hash', v_statement_hash,
    'idempotent', false,
    'payroll_period_id', p_payroll_period_id
  );
  return v_result;
end;
$$;
revoke all on function public.finalize_part_time_payroll_statement_for_period(uuid,uuid,uuid,uuid,text) from public, anon;
grant execute on function public.finalize_part_time_payroll_statement_for_period(uuid,uuid,uuid,uuid,text) to authenticated, service_role;

create or replace function public.finalize_part_time_payroll_statements_for_period(
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
  v_period public.payroll_periods%rowtype;
  v_dealer record;
  v_balance jsonb;
  v_result jsonb;
  v_results jsonb := '[]'::jsonb;
  v_finalized integer := 0;
  v_existing integer := 0;
  v_skipped integer := 0;
  v_failed integer := 0;
  v_code text;
begin
  if p_request_id is null or p_club_id is null or p_payroll_period_id is null then
    raise exception 'PAYROLL_STATEMENT_INVALID_REQUEST' using errcode = 'P0001';
  end if;
  perform public._assert_dealer_payroll_statement_rollout(p_club_id);
  v_actor := public._assert_dealer_payroll_statement_finalizer(p_club_id);
  select * into v_period
  from public.payroll_periods
  where id = p_payroll_period_id and club_id = p_club_id
  for share;
  if not found then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_FOUND' using errcode = 'P0002';
  end if;
  if v_period.status <> 'locked' then
    raise exception 'PAYROLL_STATEMENT_PERIOD_NOT_LOCKED' using errcode = 'P0001';
  end if;

  for v_dealer in
    select d.id
    from public.dealers d
    where d.club_id = p_club_id
      and d.status = 'active'
      and d.employment_type = 'part_time'
    order by d.id
  loop
    begin
      if exists (
        select 1 from public.dealer_payroll_statement_period_links l
        where l.club_id = p_club_id
          and l.payroll_period_id = p_payroll_period_id
          and l.dealer_id = v_dealer.id
      ) then
        v_existing := v_existing + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'dealer_id', v_dealer.id, 'outcome', 'existing'
        ));
        continue;
      end if;

      v_balance := public._pt_wage_balance(v_dealer.id);
      if v_balance ? 'error'
         or coalesce(nullif(v_balance->>'balance_vnd', '')::bigint, 0) <= 0 then
        v_skipped := v_skipped + 1;
        v_results := v_results || jsonb_build_array(jsonb_build_object(
          'dealer_id', v_dealer.id, 'outcome', 'not_payable'
        ));
        continue;
      end if;

      v_result := public.finalize_part_time_payroll_statement_for_period(
        gen_random_uuid(), p_club_id, v_dealer.id, p_payroll_period_id,
        'Chot phieu luong PT hang loat tu Dealer Swing'
      );
      v_finalized := v_finalized + 1;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'dealer_id', v_dealer.id,
        'statement_id', v_result->>'statement_id',
        'outcome', 'finalized'
      ));
    exception when others then
      v_failed := v_failed + 1;
      v_code := case
        when sqlerrm in (
          'PT_FINALIZED_STATEMENT_PENDING_PAYMENT',
          'PT_WAGE_BALANCE_UNAVAILABLE',
          'PT_WAGE_FINALIZATION_SNAPSHOT_UNAVAILABLE',
          'PAYROLL_STATEMENT_DEALER_NOT_FOUND',
          'PAYROLL_STATEMENT_NOT_PART_TIME_DEALER'
        ) then sqlerrm
        else 'PAYROLL_PT_STATEMENT_FINALIZATION_FAILED'
      end;
      v_results := v_results || jsonb_build_array(jsonb_build_object(
        'dealer_id', v_dealer.id, 'outcome', 'failed', 'error_code', v_code
      ));
    end;
  end loop;

  insert into public.payroll_audit_log (
    table_name, record_id, club_id, action, new_values, changed_by, reason
  ) values (
    'dealer_payroll_statement_period_links', p_request_id, p_club_id, 'BULK_FINALIZE',
    jsonb_build_object(
      'payroll_period_id', p_payroll_period_id,
      'finalized_count', v_finalized,
      'existing_count', v_existing,
      'skipped_count', v_skipped,
      'failed_count', v_failed
    ),
    v_actor, 'PT payroll statements prepared for immutable PDF delivery'
  );

  return jsonb_build_object(
    'request_id', p_request_id,
    'payroll_period_id', p_payroll_period_id,
    'finalized_count', v_finalized,
    'existing_count', v_existing,
    'skipped_count', v_skipped,
    'failed_count', v_failed,
    'results', v_results
  );
end;
$$;
revoke all on function public.finalize_part_time_payroll_statements_for_period(uuid,uuid,uuid) from public, anon;
grant execute on function public.finalize_part_time_payroll_statements_for_period(uuid,uuid,uuid) to authenticated, service_role;

create or replace function public.create_dealer_payroll_statement_delivery_operation_v2(
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
  v_result jsonb;
  v_operation_id uuid;
  v_target record;
  v_state text;
  v_code text;
begin
  v_result := public.create_dealer_payroll_statement_delivery_operation(
    p_request_id, p_club_id, p_payroll_period_id
  );
  v_operation_id := nullif(v_result->>'operation_id', '')::uuid;
  if v_operation_id is null then
    raise exception 'PAYROLL_DELIVERY_OPERATION_UNAVAILABLE' using errcode = 'P0001';
  end if;

  perform 1 from public.dealer_payroll_delivery_operations
  where id = v_operation_id and club_id = p_club_id and payroll_period_id = p_payroll_period_id
  for update;
  if not found then
    raise exception 'PAYROLL_DELIVERY_OPERATION_CONFLICT' using errcode = 'P0001';
  end if;

  for v_target in
    select
      s.id as statement_id,
      s.dealer_id,
      s.pdf_status,
      coalesce(nullif(to_jsonb(d) ->> 'telegram_user_id', ''), '') as telegram_user_id,
      exists (
        select 1 from public.dealer_payroll_delivery_targets same_operation
        where same_operation.operation_id = v_operation_id
          and same_operation.statement_id = s.id
          and same_operation.channel = 'telegram'
      ) as already_in_operation,
      exists (
        select 1 from public.dealer_payroll_delivery_targets prior
        where prior.statement_id = s.id
          and prior.channel = 'telegram'
          and prior.delivery_state in ('pending', 'sending', 'sent', 'unknown')
      ) as already_active
    from public.dealer_payroll_statement_period_links l
    join public.dealer_payroll_statements s on s.id = l.statement_id
    join public.dealers d on d.id = s.dealer_id and d.club_id = s.club_id
    where l.club_id = p_club_id
      and l.payroll_period_id = p_payroll_period_id
      and s.statement_kind = 'part_time_settlement'
      and s.state in ('pdf_rendered', 'delivery_failed')
      and s.state not in ('voided', 'replaced')
    order by s.dealer_id, s.id
    for update of s
  loop
    if v_target.already_in_operation then
      continue;
    end if;
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

  update public.dealer_payroll_delivery_operations
  set state = 'ready', completed_at = null, updated_at = now()
  where id = v_operation_id
    and exists (
      select 1 from public.dealer_payroll_delivery_targets t
      where t.operation_id = v_operation_id and t.delivery_state = 'pending'
    );

  return public._refresh_dealer_payroll_delivery_operation(v_operation_id)
    || jsonb_build_object('idempotent', coalesce((v_result->>'idempotent')::boolean, false));
end;
$$;
revoke all on function public.create_dealer_payroll_statement_delivery_operation_v2(uuid,uuid,uuid) from public, anon;
grant execute on function public.create_dealer_payroll_statement_delivery_operation_v2(uuid,uuid,uuid) to authenticated, service_role;

do $postcheck$
begin
  if to_regclass('public.dealer_payroll_statement_period_links') is null
     or to_regprocedure('public.preview_part_time_payroll_statement(uuid,uuid,uuid)') is null
     or to_regprocedure('public.list_part_time_payroll_statements_for_period(uuid,uuid)') is null
     or to_regprocedure('public.finalize_part_time_payroll_statement_for_period(uuid,uuid,uuid,uuid,text)') is null
     or to_regprocedure('public.finalize_part_time_payroll_statements_for_period(uuid,uuid,uuid)') is null
     or to_regprocedure('public.create_dealer_payroll_statement_delivery_operation_v2(uuid,uuid,uuid)') is null
     or not coalesce(has_function_privilege('authenticated', 'public.preview_part_time_payroll_statement(uuid,uuid,uuid)', 'EXECUTE'), false)
     or not coalesce(has_function_privilege('authenticated', 'public.list_part_time_payroll_statements_for_period(uuid,uuid)', 'EXECUTE'), false)
     or not coalesce(has_function_privilege('authenticated', 'public.finalize_part_time_payroll_statement_for_period(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), false)
     or not coalesce(has_function_privilege('authenticated', 'public.finalize_part_time_payroll_statements_for_period(uuid,uuid,uuid)', 'EXECUTE'), false)
     or not coalesce(has_function_privilege('authenticated', 'public.create_dealer_payroll_statement_delivery_operation_v2(uuid,uuid,uuid)', 'EXECUTE'), false)
     or coalesce(has_function_privilege('anon', 'public.finalize_part_time_payroll_statement_for_period(uuid,uuid,uuid,uuid,text)', 'EXECUTE'), true)
     or coalesce(has_table_privilege('authenticated', 'public.dealer_payroll_statement_period_links', 'SELECT,INSERT,UPDATE,DELETE'), true) then
    raise exception 'PAYROLL_PT_STATEMENT_POSTCHECK_FAILED' using errcode = 'P0001';
  end if;
end;
$postcheck$;

commit;
