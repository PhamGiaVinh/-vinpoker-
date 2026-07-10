-- ═══════════════════════════════════════════════════════════════════════════════
-- Staff Payroll (Bước A / PR-S4) — PT live-wage ledger + payroll reads for NON-dealer staff.
-- SOURCE-ONLY: NOT applied live. DEPENDS ON 20261227000000_staff_directory.sql +
-- 20261228000000_staff_attendance.sql (both applied live 2026-07-10).
--
-- Apply is a SEPARATE owner-gated controlled op (Management API: CREATE objects -> verify
-- grants/SECURITY DEFINER/search_path/RLS -> types regen). NO `supabase db push`, NO deploy_db,
-- NO schema_migrations edit here.
--
-- MODEL = exact twin of the dealer PT live-wage ledger (20261028000000_dealer_pt_wage_ledger.sql,
-- Option B), but on the SEPARATE staff / staff_attendance tables. Part-time staff accrue an
-- hourly-wage balance while they work; the club pays the FULL balance which RESETS it to 0;
-- each payout is an IMMUTABLE ledger row. The balance is DERIVED from staff_attendance since the
-- last reset anchor (MAX(covered_to) of non-voided payouts) — never stored as a running total.
--
-- ISOLATION (money-path safety): touches ONLY staff_* objects. Reads/writes ZERO dealer payroll
-- objects (dealer_payroll / payment_records / dealer_pt_wage_payments / calculate_dealer_payroll),
-- and does NOT write payroll_audit_log (the immutable ledger row IS the record). The advisory-lock
-- key is 'staff_pt_wage:<id>' — DISTINCT from the dealer 'pt_wage:<id>' lock (no cross-collision).
--
-- SCOPE: S4 ships the PT live-wage ledger + pay-and-reset + payroll READS. FT staff get a
-- READ-ONLY "tạm tính" monthly estimate prorated by club_settings.standard_shifts_per_month.
-- S4 writes NO FT payout — FT monthly lock/pay is a LATER increment (needs owner spec).
-- Rate = staff.hourly_rate_vnd as configured (no implicit floor; owner sets the rate).
--
-- WHAT (additive, idempotent):
--   1. public.staff_pt_wage_payments — immutable ledger + RLS (operator + self read; NO write policy).
--   2. public._staff_pt_wage_balance(staff_id)          — private derived live balance (24h/shift cap).
--   3. public.get_my_staff_salary(staff_id)             — self read (own balance + payouts + FT ref).
--   4. public.get_club_staff_payroll(club_id, from, to) — operator read (PT balances + FT tạm tính).
--   5. public.pay_staff_pt_balance(staff_id, ...)       — pay full PT balance + reset (idempotent).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Immutable ledger ──────────────────────────────────────────────────────
create table if not exists public.staff_pt_wage_payments (
  id                        uuid primary key default gen_random_uuid(),
  staff_id                  uuid not null references public.staff(id) on delete cascade,
  club_id                   uuid not null references public.clubs(id),
  amount_vnd                bigint  not null check (amount_vnd > 0),
  minutes_paid              integer not null check (minutes_paid >= 0),
  hourly_rate_vnd_snapshot  integer not null,   -- rate at pay time (old payouts stay unambiguous)
  covered_from              timestamptz not null,   -- reset anchor this payout covers from (explanatory)
  covered_to                timestamptz not null,   -- this payout covers up to (= paid instant); next anchor
  paid_at                   timestamptz not null default now(),  -- CASH date
  paid_by                   uuid not null references auth.users(id),
  created_by                uuid not null references auth.users(id),
  created_at                timestamptz not null default now(),
  payment_method            text,
  payment_reference         text,
  idempotency_key           text not null,
  note                      text,
  voided_at                 timestamptz,
  voided_by                 uuid references auth.users(id),
  constraint uq_staff_pt_wage_idem unique (staff_id, idempotency_key)
);

create index if not exists idx_staff_pt_wage_club_paid_at on public.staff_pt_wage_payments (club_id, paid_at);
create index if not exists idx_staff_pt_wage_staff_covered on public.staff_pt_wage_payments (staff_id, covered_to);

alter table public.staff_pt_wage_payments enable row level security;
revoke all on public.staff_pt_wage_payments from public, anon, authenticated;
grant select on public.staff_pt_wage_payments to authenticated;

-- Operator read: super_admin / club_admin / club owner / club cashier of the row's club.
-- NO INSERT/UPDATE/DELETE policy → direct writes denied; the only writer is pay_staff_pt_balance.
drop policy if exists staff_pt_wage_select_operator on public.staff_pt_wage_payments;
create policy staff_pt_wage_select_operator on public.staff_pt_wage_payments
  for select to authenticated using (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    or public.has_role(auth.uid(), 'club_admin'::app_role)
    or exists (select 1 from public.clubs c
               where c.id = staff_pt_wage_payments.club_id and c.owner_id = auth.uid())
    or exists (select 1 from public.club_cashiers cc
               where cc.club_id = staff_pt_wage_payments.club_id and cc.user_id = auth.uid())
  );

-- Staff self read (own payouts only), via staff.user_id = auth.uid().
drop policy if exists staff_pt_wage_select_self on public.staff_pt_wage_payments;
create policy staff_pt_wage_select_self on public.staff_pt_wage_payments
  for select to authenticated using (
    exists (select 1 from public.staff s
            where s.id = staff_pt_wage_payments.staff_id and s.user_id = auth.uid())
  );

-- ── 2. Balance helper (private; derived, never stored) ───────────────────────
-- Live accrued PT balance for one staff as of now(): minutes since the reset anchor
-- (open shift → now(), 24h/shift cap), the rate snapshot, the anchor, and the current open-shift
-- start (for the client live tick). STABLE / read-only. PRIVATE (no grant) — called only by the
-- SECURITY DEFINER RPCs below, which enforce their own authz.
create or replace function public._staff_pt_wage_balance(p_staff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_staff      record;
  v_rate       integer;
  v_anchor     timestamptz;
  v_now        timestamptz := now();
  v_minutes    numeric := 0;
  v_open_start timestamptz;
begin
  select id, full_name, employment_type, hourly_rate_vnd, club_id
    into v_staff
  from public.staff
  where id = p_staff_id and status = 'active' and deleted_at is null;
  if not found then
    return jsonb_build_object('error', 'staff not found or inactive');
  end if;

  -- Rate = configured staff hourly rate (no implicit floor — owner sets it).
  v_rate := coalesce(v_staff.hourly_rate_vnd, 0);

  -- reset anchor = last non-voided payout covered_to, else first attendance, else now()
  select coalesce(
    (select max(covered_to) from public.staff_pt_wage_payments
       where staff_id = p_staff_id and voided_at is null),
    (select min(check_in_time) from public.staff_attendance
       where staff_id = p_staff_id and check_in_time is not null),
    v_now
  ) into v_anchor;

  -- accrued minutes since anchor: per shift, overlap of [max(check_in,anchor), min(eff_out,now)]
  -- where eff_out = check_out OR now() (open shift accrues live). Cap each shift at 24h.
  select coalesce(sum(
           least(
             greatest(0, extract(epoch from (
               least(coalesce(sa.check_out_time, v_now), v_now)
               - greatest(sa.check_in_time, v_anchor)
             )) / 60.0),
             1440
           )
         ), 0)
    into v_minutes
  from public.staff_attendance sa
  where sa.staff_id = p_staff_id
    and sa.status in ('checked_in', 'checked_out')
    and sa.check_in_time is not null
    and sa.check_in_time < v_now
    and coalesce(sa.check_out_time, v_now) > v_anchor;

  -- current open shift (client-side live tick)
  select sa.check_in_time into v_open_start
  from public.staff_attendance sa
  where sa.staff_id = p_staff_id
    and sa.status = 'checked_in'
    and sa.check_out_time is null
    and sa.check_in_time is not null
  order by sa.check_in_time desc
  limit 1;

  return jsonb_build_object(
    'staff_id',            p_staff_id,
    'full_name',           v_staff.full_name,
    'employment_type',     v_staff.employment_type,
    'club_id',             v_staff.club_id,
    'hourly_rate_vnd',     v_rate,
    'accrued_minutes',     floor(v_minutes)::int,
    'balance_vnd',         floor(v_minutes / 60.0 * v_rate)::bigint,
    'last_reset_at',       v_anchor,
    'current_shift_open',  (v_open_start is not null),
    'current_shift_start', v_open_start,
    'as_of',               v_now
  );
end;
$$;
revoke all on function public._staff_pt_wage_balance(uuid) from public, anon, authenticated;

-- ── 3. Staff self read: get_my_staff_salary ──────────────────────────────────
-- Caller's own PT balance + recent payouts (+ FT monthly reference). Verifies p_staff_id belongs
-- to auth.uid() (a person may be staff at several clubs). Never exposes others' data.
create or replace function public.get_my_staff_salary(p_staff_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid    uuid := auth.uid();
  v_staff  record;
  v_result jsonb;
begin
  if v_uid is null then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  select id, employment_type, monthly_salary_vnd into v_staff
  from public.staff
  where id = p_staff_id and user_id = v_uid and deleted_at is null;
  if not found then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_result := public._staff_pt_wage_balance(p_staff_id);

  return v_result || jsonb_build_object(
    'monthly_salary_vnd', v_staff.monthly_salary_vnd,   -- FT reference (informational only)
    'recent_payments', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', w.id, 'amount_vnd', w.amount_vnd, 'minutes_paid', w.minutes_paid,
               'paid_at', w.paid_at, 'covered_from', w.covered_from, 'covered_to', w.covered_to,
               'payment_method', w.payment_method, 'payment_reference', w.payment_reference
             ) order by w.paid_at desc)
      from (
        select * from public.staff_pt_wage_payments
        where staff_id = p_staff_id and voided_at is null
        order by paid_at desc limit 20
      ) w
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_my_staff_salary(uuid) from public, anon;
grant execute on function public.get_my_staff_salary(uuid) to authenticated;

-- ── 4. Operator read: get_club_staff_payroll ─────────────────────────────────
-- PT staff → live balance (from the helper). FT staff → READ-ONLY monthly "tạm tính": monthly
-- salary prorated by worked-days / club_settings.standard_shifts_per_month (default 26), capped at
-- the full monthly salary. Period defaults to the current calendar month. Authz: operator of p_club_id.
create or replace function public.get_club_staff_payroll(
  p_club_id      uuid,
  p_period_start timestamptz default null,
  p_period_end   timestamptz default null
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_from timestamptz;
  v_to   timestamptz;
  v_std  integer;
  v_rows jsonb := '[]'::jsonb;
  r record;
  v_bal jsonb;
  v_worked_days integer;
  v_est bigint;
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

  v_from := coalesce(p_period_start, date_trunc('month', now()));
  v_to   := coalesce(p_period_end,   date_trunc('month', now()) + interval '1 month');
  v_std  := coalesce((select standard_shifts_per_month from public.club_settings
                      where club_id = p_club_id limit 1), 26);

  for r in
    select s.id, s.full_name, s.department, s.employment_type, s.monthly_salary_vnd, s.hourly_rate_vnd
    from public.staff s
    where s.club_id = p_club_id and s.status = 'active' and s.deleted_at is null
    order by s.employment_type, s.full_name
  loop
    if r.employment_type = 'part_time' then
      v_bal := public._staff_pt_wage_balance(r.id);
      v_bal := v_bal || jsonb_build_object(
        'department', r.department,
        'employment_type', r.employment_type,
        'last_payment', (
          select jsonb_build_object('amount_vnd', w.amount_vnd, 'paid_at', w.paid_at)
          from public.staff_pt_wage_payments w
          where w.staff_id = r.id and w.voided_at is null
          order by w.paid_at desc limit 1
        )
      );
    else
      -- FT: worked-day proration estimate (tạm tính, read-only — no payout written here).
      select count(distinct sa.shift_date) into v_worked_days
      from public.staff_attendance sa
      where sa.staff_id = r.id
        and sa.check_in_time >= v_from and sa.check_in_time < v_to;
      v_est := floor(coalesce(r.monthly_salary_vnd, 0)::numeric
                     * least(v_worked_days, v_std) / nullif(v_std, 0))::bigint;
      v_bal := jsonb_build_object(
        'staff_id', r.id, 'full_name', r.full_name, 'department', r.department,
        'employment_type', r.employment_type, 'monthly_salary_vnd', r.monthly_salary_vnd,
        'worked_days', v_worked_days, 'standard_shifts_per_month', v_std,
        'estimated_month_vnd', v_est, 'estimate_only', true
      );
    end if;
    v_rows := v_rows || jsonb_build_array(v_bal);
  end loop;

  return jsonb_build_object(
    'club_id', p_club_id, 'period_start', v_from, 'period_end', v_to,
    'standard_shifts_per_month', v_std, 'as_of', now(), 'staff', v_rows
  );
end;
$$;
revoke all on function public.get_club_staff_payroll(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_club_staff_payroll(uuid, timestamptz, timestamptz) to authenticated;

-- ── 5. Pay full PT balance + reset: pay_staff_pt_balance ──────────────────────
-- Actor = auth.uid() (NOT a client param). Server-recomputes the balance, locks per staff (no
-- double-pay), rejects ≤ 0, writes an immutable ledger row, and advances the reset anchor
-- (covered_to = now). Idempotent on (staff_id, idempotency_key): a retried call returns the prior
-- payout summary (no second insert / no double reset). PART-TIME only.
create or replace function public.pay_staff_pt_balance(
  p_staff_id          uuid,
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
  v_actor   uuid := auth.uid();
  v_staff   record;
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

  select id, club_id, employment_type, status into v_staff
  from public.staff
  where id = p_staff_id and deleted_at is null;
  if not found or v_staff.status <> 'active' then
    raise exception 'Nhân viên không tồn tại hoặc không hoạt động' using errcode = 'P0002';
  end if;
  if v_staff.employment_type <> 'part_time' then
    raise exception 'Chỉ áp dụng cho nhân viên part-time' using errcode = 'P0001';
  end if;

  -- Authz: operator of the staff's club (Owner+Cashier).
  if not (
    public.has_role(v_actor, 'super_admin'::app_role)
    or public.has_role(v_actor, 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = v_staff.club_id and c.owner_id = v_actor)
    or exists (select 1 from public.club_cashiers cc where cc.club_id = v_staff.club_id and cc.user_id = v_actor)
  ) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  v_key := coalesce(nullif(btrim(p_idempotency_key), ''), gen_random_uuid()::text);

  -- Per-staff lock BEFORE recompute/insert/reset (prevents double-pay race).
  perform pg_advisory_xact_lock(hashtext('staff_pt_wage:' || p_staff_id::text));

  -- Idempotency: a supplied key that already paid → return the prior result (no 2nd insert).
  if p_idempotency_key is not null and btrim(p_idempotency_key) <> '' then
    select * into v_prior
    from public.staff_pt_wage_payments
    where staff_id = p_staff_id and idempotency_key = v_key
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
  v_bal     := public._staff_pt_wage_balance(p_staff_id);
  v_amount  := coalesce((v_bal->>'balance_vnd')::bigint, 0);
  v_minutes := coalesce((v_bal->>'accrued_minutes')::int, 0);
  v_rate    := coalesce((v_bal->>'hourly_rate_vnd')::int, 0);
  v_anchor  := coalesce((v_bal->>'last_reset_at')::timestamptz, v_now);

  if v_amount <= 0 then
    raise exception 'Số dư bằng 0 — không có gì để thanh toán' using errcode = 'P0001';
  end if;

  insert into public.staff_pt_wage_payments (
    staff_id, club_id, amount_vnd, minutes_paid, hourly_rate_vnd_snapshot,
    covered_from, covered_to, paid_at, paid_by, created_by,
    payment_method, payment_reference, idempotency_key, note
  ) values (
    p_staff_id, v_staff.club_id, v_amount, v_minutes, v_rate,
    v_anchor, v_now, v_now, v_actor, v_actor,
    p_payment_method, p_payment_reference, v_key, p_note
  )
  returning id into v_id;

  return jsonb_build_object(
    'payment_id', v_id, 'idempotent', false,
    'amount_vnd', v_amount, 'minutes_paid', v_minutes, 'hourly_rate_vnd_snapshot', v_rate,
    'covered_from', v_anchor, 'covered_to', v_now, 'paid_at', v_now
  );
end;
$$;
revoke all on function public.pay_staff_pt_balance(uuid, text, text, text, text) from public, anon;
grant execute on function public.pay_staff_pt_balance(uuid, text, text, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Controlled-apply TEST PLAN (tx + ROLLBACK; <owner> owns <club>, <cash> cashier, <other>
-- unrelated, <pt> a part_time staff at <club> owned by auth user <emp> with some staff_attendance).
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.get_club_staff_payroll('<club>');                       -- PT balances + FT tạm tính
--   SELECT public.pay_staff_pt_balance('<pt>','cash', NULL, 'idem-1');    -- ok → payment_id (if balance>0)
--   SELECT public.pay_staff_pt_balance('<pt>','cash', NULL, 'idem-1');    -- idempotent=true (no 2nd row)
--   SELECT public.pay_staff_pt_balance('<pt>','cash');                    -- 'Số dư bằng 0' after reset (P0001)
--   SET LOCAL request.jwt.claim.sub = '<other>';
--   SELECT public.pay_staff_pt_balance('<pt>','cash');                    -- forbidden (42501)
--   SET LOCAL request.jwt.claim.sub = '<emp>';
--   SELECT public.get_my_staff_salary('<pt>');                           -- self balance + own payouts
--   SELECT public.get_my_staff_salary('<other_staff>');                  -- forbidden (42501, not owner)
-- ROLLBACK;
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.pay_staff_pt_balance(uuid, text, text, text, text);
--   DROP FUNCTION IF EXISTS public.get_club_staff_payroll(uuid, timestamptz, timestamptz);
--   DROP FUNCTION IF EXISTS public.get_my_staff_salary(uuid);
--   DROP FUNCTION IF EXISTS public._staff_pt_wage_balance(uuid);
--   DROP TABLE IF EXISTS public.staff_pt_wage_payments;
-- ═══════════════════════════════════════════════════════════════════════════════
