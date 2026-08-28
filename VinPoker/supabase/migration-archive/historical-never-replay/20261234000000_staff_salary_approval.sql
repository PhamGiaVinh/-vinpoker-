-- ═══════════════════════════════════════════════════════════════════════════════
-- Staff Salary Approval (Bước A / PR-S7) — owner-approval workflow on top of the S6 chốt.
-- SOURCE-ONLY: NOT applied live. DEPENDS ON 20261233000000_staff_salary_chot.sql (apply S6 first).
--
-- Apply is a SEPARATE owner-gated controlled op (Management API -> verify grants/DEFINER/
-- search_path/RLS -> types regen). NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--
-- OWNER DECISION (2026-07-11): the accountant must SEND the monthly salary report to the club
-- OWNER, and the OWNER approves it. So the final approver is the club owner — NOT the accountant.
-- Flow:  kế toán chốt (S6, locks runs) → submit (gửi báo cáo) → OWNER approve/reject (duyệt) →
--        pay only AFTER approved.
--
-- MONEY-PATH SAFETY: this layer moves NO cash — it is a report header + approval state machine.
-- Touches ONLY staff_*/club_* objects. mark_staff_salary_paid is hardened to require an APPROVED
-- period before any run can be marked paid.
--
-- WHAT (additive, idempotent):
--   1. public.staff_salary_periods — one report header per (club, year, month) + approval state.
--   2. public.submit_staff_salary_month(...)  — accountant/owner: chốt done -> 'submitted' (gửi).
--   3. public.approve_staff_salary_month(...)  — OWNER only: 'submitted' -> 'approved' (duyệt).
--   4. public.reject_staff_salary_month(...)   — OWNER only: 'submitted' -> 'rejected' (trả lại).
--   5. public.get_staff_salary_report(...)     — accountant/owner: header + locked runs + totals.
--   6. CREATE OR REPLACE public.mark_staff_salary_paid(...) — now requires an APPROVED period.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. Monthly report header + approval state ────────────────────────────────
create table if not exists public.staff_salary_periods (
  id              uuid primary key default gen_random_uuid(),
  club_id         uuid not null references public.clubs(id) on delete cascade,
  period_year     int  not null,
  period_month    int  not null check (period_month between 1 and 12),
  status          text not null default 'prepared'
                    check (status in ('prepared', 'submitted', 'approved', 'rejected')),
  prepared_by     uuid references auth.users(id),
  prepared_at     timestamptz,
  submitted_by    uuid references auth.users(id),   -- accountant who sent the report
  submitted_at    timestamptz,
  approved_by     uuid references auth.users(id),   -- club owner who approved
  approved_at     timestamptz,
  rejected_by     uuid references auth.users(id),
  rejected_at     timestamptz,
  rejected_reason text,
  note            text,
  updated_at      timestamptz not null default now(),
  created_at      timestamptz not null default now(),
  constraint uq_staff_salary_period unique (club_id, period_year, period_month)
);
create index if not exists idx_staff_salary_periods_club on public.staff_salary_periods (club_id, status);

alter table public.staff_salary_periods enable row level security;
revoke all on public.staff_salary_periods from public, anon, authenticated;
grant select on public.staff_salary_periods to authenticated;

-- Operator (owner/admin/cashier) + accountant read. (Staff don't read the club-level header.)
drop policy if exists staff_salary_periods_select_operator on public.staff_salary_periods;
create policy staff_salary_periods_select_operator on public.staff_salary_periods
  for select to authenticated using (
    public.has_role(auth.uid(), 'super_admin'::app_role)
    or public.has_role(auth.uid(), 'club_admin'::app_role)
    or exists (select 1 from public.clubs c where c.id = staff_salary_periods.club_id and c.owner_id = auth.uid())
    or exists (select 1 from public.club_cashiers cc where cc.club_id = staff_salary_periods.club_id and cc.user_id = auth.uid())
    or exists (select 1 from public.club_accountants ca where ca.club_id = staff_salary_periods.club_id and ca.user_id = auth.uid())
  );
-- No write policy → writes only via the SECURITY DEFINER RPCs below.

-- ── 2. Submit the month's report to the owner (accountant/owner) ──────────────
-- Requires the runs to be chốt first (S6). prepared/rejected → submitted. Approved is immutable.
create or replace function public.submit_staff_salary_month(
  p_club_id uuid, p_year int, p_month int, p_note text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cnt int;
  v_cur text;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._staff_salary_authorised(v_uid, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select count(*) into v_cnt from public.staff_salary_runs
  where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided';
  if v_cnt = 0 then
    return jsonb_build_object('error', 'NO_RUNS', 'detail', 'Chưa chốt lương tháng này (chạy chốt trước).');
  end if;

  select status into v_cur from public.staff_salary_periods
  where club_id = p_club_id and period_year = p_year and period_month = p_month;
  if v_cur = 'approved' then
    return jsonb_build_object('status', 'approved', 'idempotent', true);
  end if;

  insert into public.staff_salary_periods (
    club_id, period_year, period_month, status, prepared_by, prepared_at, submitted_by, submitted_at, note)
  values (p_club_id, p_year, p_month, 'submitted', v_uid, now(), v_uid, now(), p_note)
  on conflict (club_id, period_year, period_month) do update
    set status = 'submitted', submitted_by = v_uid, submitted_at = now(),
        note = coalesce(excluded.note, public.staff_salary_periods.note),
        rejected_reason = null, updated_at = now();

  return jsonb_build_object('status', 'submitted', 'club_id', p_club_id,
    'period_year', p_year, 'period_month', p_month, 'runs', v_cnt);
end;
$$;
revoke all on function public.submit_staff_salary_month(uuid, int, int, text) from public, anon;
grant execute on function public.submit_staff_salary_month(uuid, int, int, text) to authenticated;

-- ── 3. Approve (OWNER only) ──────────────────────────────────────────────────
create or replace function public.approve_staff_salary_month(p_club_id uuid, p_year int, p_month int)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cur text;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  -- OWNER (or super_admin) only — the accountant cannot approve their own report.
  if not (public.has_role(v_uid, 'super_admin'::app_role) or public.is_club_owner(v_uid, p_club_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select status into v_cur from public.staff_salary_periods
  where club_id = p_club_id and period_year = p_year and period_month = p_month;
  if v_cur is null then
    return jsonb_build_object('error', 'NOT_SUBMITTED', 'detail', 'Kế toán chưa gửi báo cáo tháng này.');
  end if;
  if v_cur = 'approved' then return jsonb_build_object('status', 'approved', 'idempotent', true); end if;
  if v_cur <> 'submitted' then return jsonb_build_object('error', 'INVALID_STATE', 'detail', v_cur); end if;

  update public.staff_salary_periods
  set status = 'approved', approved_by = v_uid, approved_at = now(), updated_at = now()
  where club_id = p_club_id and period_year = p_year and period_month = p_month;

  return jsonb_build_object('status', 'approved', 'club_id', p_club_id,
    'period_year', p_year, 'period_month', p_month, 'approved_at', now());
end;
$$;
revoke all on function public.approve_staff_salary_month(uuid, int, int) from public, anon;
grant execute on function public.approve_staff_salary_month(uuid, int, int) to authenticated;

-- ── 4. Reject / send back (OWNER only) ───────────────────────────────────────
create or replace function public.reject_staff_salary_month(
  p_club_id uuid, p_year int, p_month int, p_reason text default null)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_cur text;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not (public.has_role(v_uid, 'super_admin'::app_role) or public.is_club_owner(v_uid, p_club_id)) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select status into v_cur from public.staff_salary_periods
  where club_id = p_club_id and period_year = p_year and period_month = p_month;
  if v_cur is null or v_cur <> 'submitted' then
    return jsonb_build_object('error', 'INVALID_STATE', 'detail', coalesce(v_cur, 'none'));
  end if;

  update public.staff_salary_periods
  set status = 'rejected', rejected_by = v_uid, rejected_at = now(),
      rejected_reason = p_reason, updated_at = now()
  where club_id = p_club_id and period_year = p_year and period_month = p_month;

  return jsonb_build_object('status', 'rejected', 'reason', p_reason);
end;
$$;
revoke all on function public.reject_staff_salary_month(uuid, int, int, text) from public, anon;
grant execute on function public.reject_staff_salary_month(uuid, int, int, text) to authenticated;

-- ── 5. Report reader (accountant/owner): header + locked runs + totals ───────
create or replace function public.get_staff_salary_report(p_club_id uuid, p_year int, p_month int)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_uid uuid := auth.uid();
  v_hdr jsonb;
begin
  if v_uid is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._staff_salary_authorised(v_uid, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select to_jsonb(p) into v_hdr from public.staff_salary_periods p
  where p.club_id = p_club_id and p.period_year = p_year and p.period_month = p_month;

  return jsonb_build_object(
    'club_id', p_club_id, 'period_year', p_year, 'period_month', p_month,
    'header', coalesce(v_hdr, jsonb_build_object('status', 'prepared')),
    'rows', coalesce((
      select jsonb_agg(jsonb_build_object(
               'id', r.id, 'staff_id', r.staff_id, 'employment_type', r.employment_type,
               'worked_days', r.worked_days, 'worked_minutes', r.worked_minutes,
               'gross_vnd', r.gross_vnd, 'manual_bhxh_vnd', r.manual_bhxh_vnd,
               'manual_tax_vnd', r.manual_tax_vnd, 'net_vnd', r.net_vnd,
               'status', r.status, 'full_name', s.full_name, 'department', s.department
             ) order by s.employment_type, s.full_name)
      from public.staff_salary_runs r join public.staff s on s.id = r.staff_id
      where r.club_id = p_club_id and r.period_year = p_year and r.period_month = p_month and r.status <> 'voided'
    ), '[]'::jsonb),
    'total_gross_vnd', (select coalesce(sum(gross_vnd),0) from public.staff_salary_runs
                        where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided'),
    'total_net_vnd', (select coalesce(sum(net_vnd),0) from public.staff_salary_runs
                      where club_id = p_club_id and period_year = p_year and period_month = p_month and status <> 'voided')
  );
end;
$$;
revoke all on function public.get_staff_salary_report(uuid, int, int) from public, anon;
grant execute on function public.get_staff_salary_report(uuid, int, int) to authenticated;

-- ── 6. Harden mark_staff_salary_paid: require an APPROVED period ──────────────
-- (CREATE OR REPLACE over the S6 body; adds the owner-approval gate before any payment record.)
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
  -- [S7] owner must have approved the month's report before anyone can be marked paid.
  if not exists (
    select 1 from public.staff_salary_periods p
    where p.club_id = v_run.club_id and p.period_year = v_run.period_year
      and p.period_month = v_run.period_month and p.status = 'approved'
  ) then
    return jsonb_build_object('error', 'NOT_APPROVED', 'detail', 'Chủ CLB chưa duyệt bảng lương tháng này.');
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
-- Controlled-apply TEST PLAN (tx + ROLLBACK; <acct> accountant of <club>, <owner> owns <club>,
-- runs already chốt for 2026/07 via S6).
-- BEGIN;
--   SET LOCAL request.jwt.claim.sub = '<acct>';
--   SELECT public.submit_staff_salary_month('<club>', 2026, 7);        -- submitted (gửi báo cáo)
--   SELECT public.get_staff_salary_report('<club>', 2026, 7);          -- header + rows + totals
--   SELECT public.approve_staff_salary_month('<club>', 2026, 7);       -- forbidden (accountant ≠ owner)
--   SELECT public.mark_staff_salary_paid('<run_id>', 'cash');          -- NOT_APPROVED (owner hasn't duyệt)
--   SET LOCAL request.jwt.claim.sub = '<owner>';
--   SELECT public.approve_staff_salary_month('<club>', 2026, 7);       -- approved (duyệt)
--   SET LOCAL request.jwt.claim.sub = '<acct>';
--   SELECT public.mark_staff_salary_paid('<run_id>', 'cash');          -- paid (now allowed)
-- ROLLBACK;
-- ═══════════════════════════════════════════════════════════════════════════════
-- ROLLBACK (undo this migration; restore S6 mark_staff_salary_paid from 20261233000000):
--   -- re-apply the mark_staff_salary_paid body from 20261233000000_staff_salary_chot.sql, then:
--   DROP FUNCTION IF EXISTS public.get_staff_salary_report(uuid, int, int);
--   DROP FUNCTION IF EXISTS public.reject_staff_salary_month(uuid, int, int, text);
--   DROP FUNCTION IF EXISTS public.approve_staff_salary_month(uuid, int, int);
--   DROP FUNCTION IF EXISTS public.submit_staff_salary_month(uuid, int, int, text);
--   DROP TABLE IF EXISTS public.staff_salary_periods;
-- ═══════════════════════════════════════════════════════════════════════════════
