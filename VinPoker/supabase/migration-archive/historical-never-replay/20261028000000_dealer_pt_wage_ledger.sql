-- ═══════════════════════════════════════════════════════════════════════════════
-- Salary-B1 — Part-time live-wage ledger + RPCs (Option B). SOURCE-ONLY: NOT applied.
--
-- Apply is a SEPARATE owner-gated controlled op (Management API: CREATE objects ->
-- verify grants/SECURITY DEFINER/search_path/RLS -> golden-diff on finance summary ->
-- types regen). NO `supabase db push`, NO deploy_db, NO schema_migrations edit here.
--
-- MODEL (owner decision 2026-06-23, Option B; see docs/payroll/SALARY_B0_PT_WAGE_FINANCE_AUDIT.md):
--   * Part-time dealers accrue an hourly-wage balance while they work. The club pays the
--     FULL balance, which RESETS it to 0. Each payout is an IMMUTABLE ledger row.
--   * The balance is DERIVED from dealer_attendance since the last reset anchor
--     (MAX(covered_to) of non-voided payouts) — never stored as a running total.
--   * PT payouts do NOT touch payment_records (its period_id is NOT NULL + unique/period).
--     A companion migration extends get_club_finance_summary to SUM paid ledger rows by
--     paid_at into payrollNet so PT payouts are visible in owner finance (real cash).
--
-- LIVE-WAGE vs MONTHLY-PAYROLL nuance: monthly payroll caps an OPEN (forgotten-checkout)
--   shift at standard hours (P2, anti-phantom-OT). A live PT wage instead accrues the
--   current open shift to now() so it ticks in real time — with a 24h-per-shift safety cap
--   to bound a forgotten checkout. Break-deduction parity for clubs in unpaid_break mode is
--   a GOLDEN-DIFF item (see the B1 golden-diff plan) — default paid_break = no deduction.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Immutable ledger ──────────────────────────────────────────────────────
create table if not exists public.dealer_pt_wage_payments (
  id                        uuid primary key default gen_random_uuid(),
  dealer_id                 uuid not null references public.dealers(id),
  club_id                   uuid not null references public.clubs(id),
  amount_vnd                bigint  not null check (amount_vnd > 0),
  minutes_paid              integer not null check (minutes_paid >= 0),
  hourly_rate_vnd_snapshot  integer not null,   -- rate at pay time (old payouts stay unambiguous)
  covered_from              timestamptz not null,   -- reset anchor this payout covers from (explanatory)
  covered_to                timestamptz not null,   -- this payout covers up to (= paid instant); next anchor
  paid_at                   timestamptz not null default now(),  -- CASH date (finance sums by this)
  paid_by                   uuid not null references auth.users(id),
  created_by                uuid not null references auth.users(id),
  created_at                timestamptz not null default now(),
  payment_method            text,
  payment_reference         text,
  idempotency_key           text not null,
  note                      text,
  voided_at                 timestamptz,
  voided_by                 uuid references auth.users(id),
  constraint uq_pt_wage_idem unique (dealer_id, idempotency_key)
);

create index if not exists idx_pt_wage_club_paid_at on public.dealer_pt_wage_payments (club_id, paid_at);
create index if not exists idx_pt_wage_dealer_covered on public.dealer_pt_wage_payments (dealer_id, covered_to);

alter table public.dealer_pt_wage_payments enable row level security;

-- Operator read (super_admin / club_admin / club owner / club cashier). No INSERT/UPDATE/
-- DELETE policy → direct writes are denied; all writes go through the SECURITY DEFINER RPC.
drop policy if exists pt_wage_select_operator on public.dealer_pt_wage_payments;
create policy pt_wage_select_operator on public.dealer_pt_wage_payments
  for select using (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    or public.has_role(auth.uid(), 'club_admin'::app_role)
    or exists (select 1 from public.clubs c
               where c.id = dealer_pt_wage_payments.club_id and c.owner_id = auth.uid())
    or exists (select 1 from public.club_cashiers cc
               where cc.club_id = dealer_pt_wage_payments.club_id and cc.user_id = auth.uid())
  );

-- Dealer self read (own payouts only), via dealers.user_id = auth.uid().
drop policy if exists pt_wage_select_self on public.dealer_pt_wage_payments;
create policy pt_wage_select_self on public.dealer_pt_wage_payments
  for select using (
    exists (select 1 from public.dealers d
            where d.id = dealer_pt_wage_payments.dealer_id and d.user_id = auth.uid())
  );

-- ── 2. Balance helper (private; derived, never stored) ───────────────────────
-- Returns the live accrued PT balance for one dealer as of now(): minutes since the reset
-- anchor (open shift → now(), 24h/shift cap), the rate snapshot, the anchor, and the
-- current open-shift start (for the client live tick). STABLE / read-only.
create or replace function public._pt_wage_balance(p_dealer_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_dealer    record;
  v_rate      integer;
  v_anchor    timestamptz;
  v_now       timestamptz := now();
  v_minutes   numeric := 0;
  v_open_start timestamptz;
begin
  select id, full_name, employment_type, hourly_rate_vnd, club_id
    into v_dealer
  from public.dealers
  where id = p_dealer_id and status = 'active';
  if not found then
    return jsonb_build_object('error', 'dealer not found or inactive');
  end if;

  -- mirror payroll's hourly-rate floor (50,000đ/h)
  v_rate := greatest(coalesce(v_dealer.hourly_rate_vnd, 0), 50000);

  -- reset anchor = last non-voided payout covered_to, else first attendance, else now()
  select coalesce(
    (select max(covered_to) from public.dealer_pt_wage_payments
       where dealer_id = p_dealer_id and voided_at is null),
    (select min(check_in_time) from public.dealer_attendance
       where dealer_id = p_dealer_id and check_in_time is not null),
    v_now
  ) into v_anchor;

  -- accrued minutes since the anchor: per shift, overlap of [max(check_in,anchor), min(eff_out,now)]
  -- where eff_out = check_out OR now() (open shift accrues live). Cap each shift at 24h.
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

  -- current open shift (for the client-side live tick)
  select da.check_in_time into v_open_start
  from public.dealer_attendance da
  where da.dealer_id = p_dealer_id
    and da.status = 'checked_in'
    and da.check_out_time is null
    and da.check_in_time is not null
  order by da.check_in_time desc
  limit 1;

  return jsonb_build_object(
    'dealer_id',          p_dealer_id,
    'full_name',          v_dealer.full_name,
    'employment_type',    v_dealer.employment_type,
    'club_id',            v_dealer.club_id,
    'hourly_rate_vnd',    v_rate,
    'accrued_minutes',    floor(v_minutes)::int,
    'balance_vnd',        floor(v_minutes / 60.0 * v_rate)::bigint,
    'last_reset_at',      v_anchor,
    'current_shift_open', (v_open_start is not null),
    'current_shift_start', v_open_start,
    'as_of',              v_now
  );
end;
$$;
revoke all on function public._pt_wage_balance(uuid) from public, anon, authenticated;

-- ── 3. Dealer self read: get_my_pt_wage ──────────────────────────────────────
-- Returns the caller's own PT balance + recent payouts. Verifies p_dealer_id belongs to
-- auth.uid() (a user may be a dealer at several clubs). Never exposes others' data.
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
  if not exists (select 1 from public.dealers d
                 where d.id = p_dealer_id and d.user_id = v_uid) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_result := public._pt_wage_balance(p_dealer_id);

  return v_result || jsonb_build_object(
    'recent_payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'amount_vnd', w.amount_vnd, 'minutes_paid', w.minutes_paid,
               'paid_at', w.paid_at, 'covered_from', w.covered_from, 'covered_to', w.covered_to,
               'payment_method', w.payment_method, 'payment_reference', w.payment_reference
             ) order by w.paid_at desc)
      from (
        select * from public.dealer_pt_wage_payments
        where dealer_id = p_dealer_id and voided_at is null
        order by paid_at desc limit 20
      ) w
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_pt_wage(uuid) from public, anon;
grant execute on function public.get_my_pt_wage(uuid) to authenticated;

-- ── 4. Operator read: get_club_pt_wages ──────────────────────────────────────
-- Per-PT-dealer live balances for a club (operator view). Authz: super_admin / club_admin /
-- club owner / club cashier of p_club_id.
create or replace function public.get_club_pt_wages(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_rows jsonb := '[]'::jsonb;
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
        order by w.paid_at desc limit 1
      )
    );
    v_rows := v_rows || jsonb_build_array(v_bal);
  end loop;

  return jsonb_build_object('club_id', p_club_id, 'as_of', now(), 'dealers', v_rows);
end;
$$;
revoke all on function public.get_club_pt_wages(uuid) from public, anon;
grant execute on function public.get_club_pt_wages(uuid) to authenticated;

-- ── 5. Pay full balance + reset: pay_part_time_balance ───────────────────────
-- Actor = auth.uid() (NOT a client param). Server-recomputes the balance, locks per dealer
-- (no double-pay), rejects ≤ 0, writes an immutable ledger row + a payroll_audit_log row,
-- and advances the reset anchor (covered_to = now). Idempotent on (dealer_id, idempotency_key):
-- a retried call returns the prior payout summary (no second insert / no double reset).
create or replace function public.pay_part_time_balance(
  p_dealer_id        uuid,
  p_payment_method   text,
  p_payment_reference text default null,
  p_idempotency_key  text default null,
  p_note             text default null
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor   uuid := auth.uid();
  v_dealer  record;
  v_key     text;
  v_prior   record;
  v_bal     jsonb;
  v_amount  bigint;
  v_minutes integer;
  v_rate    integer;
  v_anchor  timestamptz;
  v_now     timestamptz := now();
  v_id      uuid;
begin
  if v_actor is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select id, club_id, employment_type, status
    into v_dealer
  from public.dealers
  where id = p_dealer_id;
  if not found or v_dealer.status <> 'active' then
    raise exception 'Dealer không tồn tại hoặc không hoạt động' using errcode = 'P0002';
  end if;
  if v_dealer.employment_type <> 'part_time' then
    raise exception 'Chỉ áp dụng cho dealer part-time' using errcode = 'P0001';
  end if;

  -- Authz: operator of the dealer's club.
  if not (
    public.has_role(v_actor, 'super_admin'::app_role)
    or public.has_role(v_actor, 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = v_dealer.club_id and c.owner_id = v_actor)
    or exists (select 1 from public.club_cashiers cc where cc.club_id = v_dealer.club_id and cc.user_id = v_actor)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);

  -- Per-dealer lock BEFORE recompute/insert/reset (prevents double-pay race).
  perform pg_advisory_xact_lock(hashtext('pt_wage:' || p_dealer_id::text));

  -- Idempotency: if the caller supplied a key that already paid, return the prior result.
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select * into v_prior
    from public.dealer_pt_wage_payments
    where dealer_id = p_dealer_id and idempotency_key = v_key
    limit 1;
    if found then
      return jsonb_build_object(
        'payment_id', v_prior.id, 'idempotent', true,
        'amount_vnd', v_prior.amount_vnd, 'minutes_paid', v_prior.minutes_paid,
        'covered_from', v_prior.covered_from, 'covered_to', v_prior.covered_to, 'paid_at', v_prior.paid_at
      );
    end if;
  end if;

  -- Server-recompute the balance at this instant (ignore any client-supplied amount).
  v_bal     := public._pt_wage_balance(p_dealer_id);
  v_amount  := coalesce((v_bal->>'balance_vnd')::bigint, 0);
  v_minutes := coalesce((v_bal->>'accrued_minutes')::int, 0);
  v_rate    := coalesce((v_bal->>'hourly_rate_vnd')::int, 0);
  v_anchor  := coalesce((v_bal->>'last_reset_at')::timestamptz, v_now);

  if v_amount <= 0 then
    raise exception 'Số dư bằng 0 — không có gì để thanh toán' using errcode = 'P0001';
  end if;

  insert into public.dealer_pt_wage_payments (
    dealer_id, club_id, amount_vnd, minutes_paid, hourly_rate_vnd_snapshot,
    covered_from, covered_to, paid_at, paid_by, created_by,
    payment_method, payment_reference, idempotency_key, note
  ) values (
    p_dealer_id, v_dealer.club_id, v_amount, v_minutes, v_rate,
    v_anchor, v_now, v_now, v_actor, v_actor,
    p_payment_method, p_payment_reference, v_key, p_note
  )
  returning id into v_id;

  insert into public.payroll_audit_log (table_name, record_id, club_id, action, new_values, changed_by, reason)
  values (
    'dealer_pt_wage_payments', v_id, v_dealer.club_id, 'INSERT',
    jsonb_build_object('dealer_id', p_dealer_id, 'amount_vnd', v_amount, 'minutes_paid', v_minutes,
                       'hourly_rate_vnd_snapshot', v_rate, 'covered_from', v_anchor, 'covered_to', v_now,
                       'payment_method', p_payment_method, 'payment_reference', p_payment_reference),
    v_actor, 'PT wage full payout + reset'
  );

  return jsonb_build_object(
    'payment_id', v_id, 'idempotent', false,
    'amount_vnd', v_amount, 'minutes_paid', v_minutes, 'hourly_rate_vnd_snapshot', v_rate,
    'covered_from', v_anchor, 'covered_to', v_now, 'paid_at', v_now
  );
end;
$$;
revoke all on function public.pay_part_time_balance(uuid, text, text, text, text) from public, anon;
grant execute on function public.pay_part_time_balance(uuid, text, text, text, text) to authenticated;
