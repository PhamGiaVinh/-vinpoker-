-- ═══════════════════════════════════════════════════════════════════════════════
-- Staff Salary Chốt (Bước A / PR-S6) — monthly salary finalization for NON-dealer staff,
-- with a NEW club-scoped "accounting" approval role. SOURCE-ONLY: NOT applied live.
--
-- Apply is a SEPARATE owner-gated controlled op (Management API: CREATE objects -> verify
-- grants/SECURITY DEFINER/search_path/RLS -> types regen). NO `supabase db push`, NO deploy_db,
-- NO schema_migrations edit here. DEPENDS ON the live staff / staff_attendance /
-- staff_pt_wage_payments tables (Bước A, applied 2026-07-10) + club_settings.standard_shifts_per_month.
--
-- OWNER DECISIONS (2026-07-11):
--   • "Kế toán" is the salary-approval role — a NEW club-scoped grant (club_accountants), like
--     club_cashiers. Owner grants it per person per club. (No app_role enum change — the codebase
--     authorises off the club_* grant tables, not the enum.)
--   • "Kế toán làm hết" — the accountant (and owner/admin) prepares + chốt + marks paid; no
--     separate preparer/approver split.
--   • Chốt covers BOTH full-time and part-time in one monthly run.
--
-- MONEY-PATH SAFETY (key design choice):
--   • CHỐT ONLY FINALISES/LOCKS THE NUMBERS — it moves NO cash. staff_salary_runs is the immutable
--     monthly payslip; amounts are SAVED and never recomputed (Tạm tính ≠ Đã chốt).
--   • FT: gross = monthly_salary × min(worked_days, std)/std; net = gross − manual BHXH − manual tax.
--   • PT: the monthly run SUMMARISES the PT payouts already made that month (staff_pt_wage_payments,
--     by paid_at, non-voided) — it does NOT re-pay, so there is ZERO double-pay with the existing
--     pay_staff_pt_balance. PT net == that cash sum (already net); no extra deduction.
--   • Actual FT cash handout is recorded separately by mark_staff_salary_paid (a status/record
--     change, not a cash mover). PT is already paid via pay_staff_pt_balance during the month.
--   • Touches ONLY staff_* / club_* objects — reads staff_pt_wage_payments (own module), writes ZERO
--     dealer payroll objects (dealer_payroll / payment_records / dealer_pt_wage_payments / calculate_*).
--   • Append-only: one active run per (club, staff, month); a correction is a new row (adjusts_id).
--
-- WHAT (additive, idempotent):
--   1. public.club_accountants + is_club_accountant + grant/revoke_club_accountant (owner-only).
--   2. public.staff_salary_runs (immutable monthly payslip) + RLS (operator+accountant+self read).
--   3. public.get_staff_salary_month(club,year,month)  — Tạm tính preview (read-only).
--   4. public.chot_staff_salary_month(club,year,month) — accountant: compute + LOCK all runs.
--   5. public.mark_staff_salary_paid(run_id, ...)      — accountant: record FT cash payment.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Accounting role (club-scoped grant, mirrors club_cashiers) ─────────────
create table if not exists public.club_accountants (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  granted_by uuid references auth.users(id),
  created_at timestamptz not null default now(),
  constraint uq_club_accountant unique (club_id, user_id)
);
create index if not exists idx_club_accountants_user on public.club_accountants (user_id);

alter table public.club_accountants enable row level security;
revoke all on public.club_accountants from public, anon, authenticated;
grant select on public.club_accountants to authenticated;

drop policy if exists club_accountants_select_operator on public.club_accountants;
create policy club_accountants_select_operator on public.club_accountants
  for select to authenticated using (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    or public.has_role(auth.uid(), 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = club_accountants.club_id and c.owner_id = auth.uid())
    or user_id = auth.uid()
  );
-- No write policy → grants happen only via the owner-only RPCs below.

create or replace function public.is_club_accountant(p_uid uuid, p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (
    select 1 from public.club_accountants ca where ca.club_id = p_club_id and ca.user_id = p_uid
  );
$$;
revoke all on function public.is_club_accountant(uuid, uuid) from public, anon;
grant execute on function public.is_club_accountant(uuid, uuid) to authenticated;

-- owner-only grant / revoke (mirror fnb_grant_staff: is_club_owner covers super_admin)
create or replace function public.grant_club_accountant(p_club_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('error', 'Unauthorized'); end if;
  if p_user_id is null then return jsonb_build_object('error', 'INVALID_INPUT', 'detail', 'user_id'); end if;
  if not public.is_club_owner(v_uid, p_club_id) then return jsonb_build_object('error', 'Forbidden'); end if;
  insert into public.club_accountants (club_id, user_id, granted_by)
  values (p_club_id, p_user_id, v_uid)
  on conflict (club_id, user_id) do nothing;
  return jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'user_id', p_user_id);
end; $$;
revoke all on function public.grant_club_accountant(uuid, uuid) from public, anon;
grant execute on function public.grant_club_accountant(uuid, uuid) to authenticated;

create or replace function public.revoke_club_accountant(p_club_id uuid, p_user_id uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare v_uid uuid := auth.uid();
begin
  if v_uid is null then return jsonb_build_object('error', 'Unauthorized'); end if;
  if not public.is_club_owner(v_uid, p_club_id) then return jsonb_build_object('error', 'Forbidden'); end if;
  delete from public.club_accountants where club_id = p_club_id and user_id = p_user_id;
  return jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'user_id', p_user_id);
end; $$;
revoke all on function public.revoke_club_accountant(uuid, uuid) from public, anon;
grant execute on function public.revoke_club_accountant(uuid, uuid) to authenticated;

-- ── 2. Immutable monthly payslip ─────────────────────────────────────────────
create table if not exists public.staff_salary_runs (
  id               uuid primary key default gen_random_uuid(),
  club_id          uuid not null references public.clubs(id) on delete cascade,
  staff_id         uuid not null references public.staff(id) on delete cascade,
  period_year      int  not null,
  period_month     int  not null check (period_month between 1 and 12),
  employment_type  text not null,            -- snapshot at chốt time
  worked_days      int,                      -- FT basis (distinct attendance days in month)
  worked_minutes   int,                      -- PT basis (minutes paid in month)
  gross_vnd        bigint not null,          -- SAVED — never recomputed
  manual_bhxh_vnd  bigint not null default 0,
  manual_tax_vnd   bigint not null default 0,
  net_vnd          bigint not null,          -- SAVED
  status           text not null default 'locked' check (status in ('locked', 'paid', 'voided')),
  locked_by        uuid not null references auth.users(id),
  locked_at        timestamptz not null default now(),
  paid_at          timestamptz,
  paid_by          uuid references auth.users(id),
  payment_method   text,
  payment_reference text,
  note             text,
  adjusts_id       uuid references public.staff_salary_runs(id),  -- correction = new row
  created_at       timestamptz not null default now()
);
create index if not exists idx_staff_salary_runs_club_period on public.staff_salary_runs (club_id, period_year, period_month);
create index if not exists idx_staff_salary_runs_staff on public.staff_salary_runs (staff_id, period_year, period_month);
-- exactly one active (non-voided) run per staff per month
create unique index if not exists uq_staff_salary_run_month
  on public.staff_salary_runs (club_id, staff_id, period_year, period_month) where status <> 'voided';

alter table public.staff_salary_runs enable row level security;
revoke all on public.staff_salary_runs from public, anon, authenticated;
grant select on public.staff_salary_runs to authenticated;

-- Operator (owner/admin/cashier) + accountant read.
drop policy if exists staff_salary_runs_select_operator on public.staff_salary_runs;
create policy staff_salary_runs_select_operator on public.staff_salary_runs
  for select to authenticated using (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    or public.has_role(auth.uid(), 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = staff_salary_runs.club_id and c.owner_id = auth.uid())
    or exists (select 1 from public.club_cashiers cc where cc.club_id = staff_salary_runs.club_id and cc.user_id = auth.uid())
    or exists (select 1 from public.club_accountants ca where ca.club_id = staff_salary_runs.club_id and ca.user_id = auth.uid())
  );
-- Staff self read: own payslips via staff.user_id.
drop policy if exists staff_salary_runs_select_self on public.staff_salary_runs;
create policy staff_salary_runs_select_self on public.staff_salary_runs
  for select to authenticated using (
    exists (select 1 from public.staff s where s.id = staff_salary_runs.staff_id and s.user_id = auth.uid())
  );
-- No write policy → writes only via the SECURITY DEFINER RPCs below.

-- ── Shared authz helper: may this user chốt/read salary for this club? ─────────
-- Accountant (the approval role) OR owner OR admin. (Cashier can prepare/see but not chốt.)
create or replace function public._staff_salary_authorised(p_uid uuid, p_club_id uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select
    public.has_role(p_uid, 'super_admin'::app_role)
    or public.has_role(p_uid, 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = p_club_id and c.owner_id = p_uid)
    or public.is_club_accountant(p_uid, p_club_id);
$$;
revoke all on function public._staff_salary_authorised(uuid, uuid) from public, anon, authenticated;

-- ── 3. Preview (Tạm tính) — read-only compute for a month ────────────────────
create or replace function public.get_staff_salary_month(p_club_id uuid, p_year int, p_month int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid  uuid := auth.uid();
  v_from date := make_date(p_year, p_month, 1);
  v_to   date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_std  int;
  v_rows jsonb := '[]'::jsonb;
  r record;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._staff_salary_authorised(v_uid, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_std := coalesce((select standard_shifts_per_month from public.club_settings where club_id = p_club_id limit 1), 26);

  for r in
    select s.id, s.full_name, s.department, s.employment_type,
           s.monthly_salary_vnd, s.manual_bhxh_vnd, s.manual_tax_vnd
    from public.staff s
    where s.club_id = p_club_id and s.status = 'active' and s.deleted_at is null
    order by s.employment_type, s.full_name
  loop
    if r.employment_type = 'part_time' then
      declare v_amt bigint; v_min int; begin
        select coalesce(sum(amount_vnd),0), coalesce(sum(minutes_paid),0) into v_amt, v_min
        from public.staff_pt_wage_payments
        where staff_id = r.id and voided_at is null and paid_at >= v_from and paid_at < v_to;
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'staff_id', r.id, 'full_name', r.full_name, 'department', r.department, 'employment_type', 'part_time',
          'worked_minutes', v_min, 'gross_vnd', v_amt, 'manual_bhxh_vnd', 0, 'manual_tax_vnd', 0, 'net_vnd', v_amt,
          'basis', 'PT payouts summed for the month', 'already_locked',
          exists(select 1 from public.staff_salary_runs sr where sr.staff_id = r.id and sr.period_year = p_year and sr.period_month = p_month and sr.status <> 'voided')));
      end;
    else
      declare v_days int; v_gross bigint; v_bhxh bigint; v_tax bigint; begin
        select count(distinct shift_date) into v_days from public.staff_attendance
        where staff_id = r.id and shift_date >= v_from and shift_date < v_to;
        v_gross := floor(coalesce(r.monthly_salary_vnd,0)::numeric * least(v_days, v_std) / nullif(v_std,0))::bigint;
        v_bhxh  := coalesce(r.manual_bhxh_vnd, 0);
        v_tax   := coalesce(r.manual_tax_vnd, 0);
        v_rows := v_rows || jsonb_build_array(jsonb_build_object(
          'staff_id', r.id, 'full_name', r.full_name, 'department', r.department, 'employment_type', 'full_time',
          'worked_days', v_days, 'standard_shifts_per_month', v_std,
          'gross_vnd', v_gross, 'manual_bhxh_vnd', v_bhxh, 'manual_tax_vnd', v_tax,
          'net_vnd', greatest(0, v_gross - v_bhxh - v_tax),
          'basis', 'monthly × worked_days/std − BHXH − tax', 'already_locked',
          exists(select 1 from public.staff_salary_runs sr where sr.staff_id = r.id and sr.period_year = p_year and sr.period_month = p_month and sr.status <> 'voided')));
      end;
    end if;
  end loop;

  return jsonb_build_object('club_id', p_club_id, 'period_year', p_year, 'period_month', p_month,
                            'standard_shifts_per_month', v_std, 'as_of', now(), 'staff', v_rows);
end;
$$;
revoke all on function public.get_staff_salary_month(uuid, int, int) from public, anon;
grant execute on function public.get_staff_salary_month(uuid, int, int) to authenticated;

-- ── 4. Chốt (finalize + LOCK all runs for the month). Accountant/owner/admin. ─
-- Locks an immutable row per active staff without one yet (idempotent via the unique index).
-- Moves NO cash: FT = amount owed; PT = summary of payouts already made in the month.
create or replace function public.chot_staff_salary_month(p_club_id uuid, p_year int, p_month int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid   uuid := auth.uid();
  v_from  date := make_date(p_year, p_month, 1);
  v_to    date := (make_date(p_year, p_month, 1) + interval '1 month')::date;
  v_std   int;
  v_locked int := 0;
  r record;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._staff_salary_authorised(v_uid, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  v_std := coalesce((select standard_shifts_per_month from public.club_settings where club_id = p_club_id limit 1), 26);

  for r in
    select s.id, s.employment_type, s.monthly_salary_vnd, s.manual_bhxh_vnd, s.manual_tax_vnd
    from public.staff s
    where s.club_id = p_club_id and s.status = 'active' and s.deleted_at is null
  loop
    -- skip if already locked/paid for this month (append-only; correction = separate later step)
    if exists (select 1 from public.staff_salary_runs sr
               where sr.staff_id = r.id and sr.period_year = p_year and sr.period_month = p_month
                 and sr.status <> 'voided') then
      continue;
    end if;

    if r.employment_type = 'part_time' then
      declare v_amt bigint; v_min int; begin
        select coalesce(sum(amount_vnd),0), coalesce(sum(minutes_paid),0) into v_amt, v_min
        from public.staff_pt_wage_payments
        where staff_id = r.id and voided_at is null and paid_at >= v_from and paid_at < v_to;
        insert into public.staff_salary_runs (
          club_id, staff_id, period_year, period_month, employment_type,
          worked_minutes, gross_vnd, manual_bhxh_vnd, manual_tax_vnd, net_vnd, status, locked_by)
        values (p_club_id, r.id, p_year, p_month, 'part_time',
          v_min, v_amt, 0, 0, v_amt, 'locked', v_uid)
        on conflict do nothing;
      end;
    else
      declare v_days int; v_gross bigint; v_bhxh bigint; v_tax bigint; begin
        select count(distinct shift_date) into v_days from public.staff_attendance
        where staff_id = r.id and shift_date >= v_from and shift_date < v_to;
        v_gross := floor(coalesce(r.monthly_salary_vnd,0)::numeric * least(v_days, v_std) / nullif(v_std,0))::bigint;
        v_bhxh  := coalesce(r.manual_bhxh_vnd, 0);
        v_tax   := coalesce(r.manual_tax_vnd, 0);
        insert into public.staff_salary_runs (
          club_id, staff_id, period_year, period_month, employment_type,
          worked_days, gross_vnd, manual_bhxh_vnd, manual_tax_vnd, net_vnd, status, locked_by)
        values (p_club_id, r.id, p_year, p_month, 'full_time',
          v_days, v_gross, v_bhxh, v_tax, greatest(0, v_gross - v_bhxh - v_tax), 'locked', v_uid)
        on conflict do nothing;
      end;
    end if;
    v_locked := v_locked + 1;
  end loop;

  return jsonb_build_object('status', 'ok', 'club_id', p_club_id, 'period_year', p_year, 'period_month', p_month,
    'locked_now', v_locked,
    'total_net_vnd', (select coalesce(sum(net_vnd),0) from public.staff_salary_runs
                      where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided'));
end;
$$;
revoke all on function public.chot_staff_salary_month(uuid, int, int) from public, anon;
grant execute on function public.chot_staff_salary_month(uuid, int, int) to authenticated;

-- ── 5. Mark a locked run as PAID (records FT cash handout). Accountant/owner/admin. ─
create or replace function public.mark_staff_salary_paid(
  p_run_id uuid, p_payment_method text default null, p_payment_reference text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_run record;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select * into v_run from public.staff_salary_runs where id = p_run_id;
  if not found then return jsonb_build_object('error', 'NOT_FOUND'); end if;
  if not public._staff_salary_authorised(v_uid, v_run.club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  if v_run.status <> 'locked' then
    return jsonb_build_object('status', v_run.status, 'idempotent', true, 'run_id', p_run_id);
  end if;

  update public.staff_salary_runs
  set status = 'paid', paid_at = now(), paid_by = v_uid,
      payment_method = p_payment_method, payment_reference = p_payment_reference
  where id = p_run_id and status = 'locked';

  return jsonb_build_object('status', 'paid', 'run_id', p_run_id, 'paid_at', now());
end;
$$;
revoke all on function public.mark_staff_salary_paid(uuid, text, text) from public, anon;
grant execute on function public.mark_staff_salary_paid(uuid, text, text) to authenticated;

-- ═══════════════════════════════════════════════════════════════════════════════
-- Controlled-apply TEST PLAN (tx + ROLLBACK; <owner> owns <club>, <acct> to be accountant,
-- <ft> a full_time staff, <pt> a part_time staff with some staff_pt_wage_payments this month).
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.grant_club_accountant('<club>','<acct>');                         -- ok
--   SET LOCAL request.jwt.claim.sub = '<acct>';
--   SELECT public.get_staff_salary_month('<club>', 2026, 7);                        -- preview (Tạm tính)
--   SELECT public.chot_staff_salary_month('<club>', 2026, 7);                       -- locks runs; locked_now = N
--   SELECT public.chot_staff_salary_month('<club>', 2026, 7);                       -- idempotent: locked_now = 0
--   SELECT public.mark_staff_salary_paid('<run_id>', 'cash');                       -- paid
--   SET LOCAL request.jwt.claim.sub = '<other>';
--   SELECT public.chot_staff_salary_month('<club>', 2026, 7);                       -- forbidden (42501)
--   SET LOCAL request.jwt.claim.sub = '<ft_user>';
--   SELECT * FROM public.staff_salary_runs WHERE staff_id = '<ft>';                 -- self-read sees own payslip
-- ROLLBACK;
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (undo this migration):
--   DROP FUNCTION IF EXISTS public.mark_staff_salary_paid(uuid, text, text);
--   DROP FUNCTION IF EXISTS public.chot_staff_salary_month(uuid, int, int);
--   DROP FUNCTION IF EXISTS public.get_staff_salary_month(uuid, int, int);
--   DROP FUNCTION IF EXISTS public._staff_salary_authorised(uuid, uuid);
--   DROP TABLE IF EXISTS public.staff_salary_runs;
--   DROP FUNCTION IF EXISTS public.revoke_club_accountant(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.grant_club_accountant(uuid, uuid);
--   DROP FUNCTION IF EXISTS public.is_club_accountant(uuid, uuid);
--   DROP TABLE IF EXISTS public.club_accountants;
-- ═══════════════════════════════════════════════════════════════════════════════
