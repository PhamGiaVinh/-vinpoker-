-- ===============================================================================
-- DRY-RUN — WHOLE CLUSTER P2->P5a — single BEGIN...ROLLBACK — NOTHING PERSISTED
--
-- REVIEWABLE ARTIFACT for the owner to READ before the apply window. NOT an apply.
-- When run: applies all 5 migrations + runs 15 functests inside ONE transaction,
-- then ROLLBACK at the very end -> zero schema/rows persisted.
--
-- RUN ONLY: in a low/no-swing window (it takes brief DDL locks on dealer_assignments
-- even though rolled back), with the owner's explicit go-phrase, via the controlled
-- Management-API path. It does NOT COMMIT, db push, deploy, or touch schema_migrations.
-- NO REVOKE anywhere (the no-REVOKE claim model).
--
-- STRUCTURE:
--   BEGIN;   <- the ONLY BEGIN; everything below is undone by the final ROLLBACK;
--     [1/5] 20261104  P2          feature/final tables (dealer_table_profiles, pool) + RLS
--     [2/5] 20261105  P3          helper _assert + RPCs + kill-switch seed ('false')
--     [3/5] 20261106  P4          assign 10-param + override  (gen-v3, STEP-0.7) [TRANSIENT]
--     [4/5] 20261108  P5a-claim   dealer_override_claims (RLS no-write, unforgeable)
--     [5/5] 20261109  P5a-rewrite trigger + assign M2 (gen-v4) [FINAL]
--     [harness] flip kill-switch ON in-tx . fixtures . functests F1-F16 (F2/F8/F15/F16 hardened per owner SQL review)
--   ROLLBACK;
--
-- On a real run, READ each line: 'PASS Fn' = good ; 'FAIL Fn' = investigate ;
-- 'MANUAL Fn' = a 2-session concurrency test that cannot run in one tx (procedure inline).
--
-- Each migration below is VERBATIM from origin/main; only each file's own top-level
-- BEGIN;/COMMIT; were stripped so the whole cluster runs in the single outer tx.
-- ===============================================================================

BEGIN;  -- OUTER dry-run transaction (the ONLY BEGIN; final ROLLBACK undoes ALL of it)


-- -------------------------------------------------------------------------------
-- [1/5]  20261104000000_dealer_feature_final_tables.sql
--        P2: dealer_table_profiles + dealer_table_pool_members + RLS (no-write claim pattern precedent)
-- -------------------------------------------------------------------------------
-- ═══════════════════════════════════════════════════════════════════════════════
-- Patch 2 — Dealer Swing Feature/Final table dealer pools: tables + RLS. SOURCE-ONLY.
--
-- Per ADR 012 (docs/adr/012-dealer-feature-final-tables.md) + owner-review amendments:
--   • P1-E: dealer_table_pool_members.table_id FK → dealer_table_profiles(table_id)
--     (NOT game_tables) → a pool cannot exist without a profile (lock-anchor for DR-2
--     always present; no orphan pools; cascade is 2-hop game_table→profile→pool).
--   • P1-A: multiple `is_primary` allowed (display-only); the picker resolves order by
--     `priority` — NO partial unique index.
--   • DR-8c: same-club integrity via denormalized `club_id` + validating triggers
--     (house style, like dealer_assignments 20260719000000) — NO composite FK, NO ALTER
--     of game_tables/dealers.
--   • RLS: SELECT-only for dealer-control of the club / super_admin (reuse
--     is_club_dealer_control). NO write policy → all writes go through the Patch-3
--     SECURITY DEFINER RPCs (deny-by-default writes; DR-8g pools not dealer-readable).
--
-- Apply is a SEPARATE owner-gated controlled op (DR-3: do NOT apply enforcement patches
-- before this). NO `supabase db push`, NO deploy_db, NO schema_migrations edit. Inert until
-- the `dealerFeatureTables` flag + Patch-3 RPCs land. No grants needed — Supabase default
-- privileges grant `authenticated` (like every dealer-swing table); RLS gates access.
-- ROLLBACK: DROP the two tables (pool first) + the two same-club functions.
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── 1. profiles: one row per special table ───────────────────────────────────
create table if not exists public.dealer_table_profiles (
  id           uuid primary key default gen_random_uuid(),
  club_id      uuid not null references public.clubs(id) on delete cascade,
  table_id     uuid not null unique references public.game_tables(id) on delete cascade,
  table_mode   text not null default 'normal' check (table_mode in ('normal','feature')),
  is_final     boolean not null default false,
  allow_override boolean not null default false,
  display_label text,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists idx_dealer_table_profiles_club on public.dealer_table_profiles(club_id);

-- ── 2. pool members: allowed dealers per special table (P1-E: FK → profiles) ──
create table if not exists public.dealer_table_pool_members (
  id         uuid primary key default gen_random_uuid(),
  club_id    uuid not null references public.clubs(id) on delete cascade,
  table_id   uuid not null references public.dealer_table_profiles(table_id) on delete cascade,
  dealer_id  uuid not null references public.dealers(id) on delete cascade,
  priority   int not null default 100,
  is_primary boolean not null default false,  -- P1-A: display-only; multiple allowed; picker resolves by priority
  created_at timestamptz not null default now(),
  unique (table_id, dealer_id)
);
-- club_id for RLS; dealer_id for the dealers-cascade. No separate table_id index:
-- UNIQUE(table_id, dealer_id) already serves table_id-prefix lookups + the profile cascade.
create index if not exists idx_dealer_table_pool_members_club on public.dealer_table_pool_members(club_id);
create index if not exists idx_dealer_table_pool_members_dealer on public.dealer_table_pool_members(dealer_id);

-- ── 3. same-club integrity triggers (denormalized club_id; auto-populate + assert) ──
-- distinct ERRCODEs so consumers switch on SQLSTATE, not message text:
--   DT001 = table not in this club · DT002 = dealer not in this club
--   DT003 = game_table missing  · DT004 = dealer missing
create or replace function public.dealer_table_profiles_same_club_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_gt_club uuid;
begin
  select club_id into v_gt_club from public.game_tables where id = new.table_id;
  if v_gt_club is null then
    raise exception 'game_table % not found', new.table_id using errcode = 'DT003';
  end if;
  if new.club_id is null then new.club_id := v_gt_club; end if;
  if new.club_id <> v_gt_club then
    raise exception 'FEATURE_TABLE_CROSS_CLUB: table % belongs to club %, not %', new.table_id, v_gt_club, new.club_id using errcode = 'DT001';
  end if;
  return new;
end;
$$;

create or replace function public.dealer_table_pool_members_same_club_check()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_gt_club uuid; v_d_club uuid;
begin
  select club_id into v_gt_club from public.game_tables where id = new.table_id;
  if v_gt_club is null then
    raise exception 'game_table % not found', new.table_id using errcode = 'DT003';
  end if;
  if new.club_id is null then new.club_id := v_gt_club; end if;
  if new.club_id <> v_gt_club then
    raise exception 'FEATURE_TABLE_CROSS_CLUB: table % belongs to club %, not %', new.table_id, v_gt_club, new.club_id using errcode = 'DT001';
  end if;
  select club_id into v_d_club from public.dealers where id = new.dealer_id;
  if v_d_club is null then
    raise exception 'dealer % not found', new.dealer_id using errcode = 'DT004';
  end if;
  if v_d_club <> new.club_id then
    raise exception 'FEATURE_POOL_DEALER_CROSS_CLUB: dealer % belongs to club %, not %', new.dealer_id, v_d_club, new.club_id using errcode = 'DT002';
  end if;
  return new;
end;
$$;

-- profiles: same-club (BEFORE INSERT/UPDATE) + updated_at (BEFORE UPDATE; reuse existing fn)
drop trigger if exists trg_dealer_table_profiles_same_club on public.dealer_table_profiles;
create trigger trg_dealer_table_profiles_same_club
  before insert or update on public.dealer_table_profiles
  for each row execute function public.dealer_table_profiles_same_club_check();

drop trigger if exists trg_dealer_table_profiles_updated on public.dealer_table_profiles;
create trigger trg_dealer_table_profiles_updated
  before update on public.dealer_table_profiles
  for each row execute function public.update_updated_at_column();

-- pool: same-club (BEFORE INSERT/UPDATE; UPDATE branch is defensive — set_table_dealer_pool is replace-all)
drop trigger if exists trg_dealer_table_pool_members_same_club on public.dealer_table_pool_members;
create trigger trg_dealer_table_pool_members_same_club
  before insert or update on public.dealer_table_pool_members
  for each row execute function public.dealer_table_pool_members_same_club_check();

-- ── 4. RLS: SELECT-only for dealer-control of the club / super_admin. NO write policy. ──
alter table public.dealer_table_profiles enable row level security;
alter table public.dealer_table_pool_members enable row level security;

drop policy if exists "dealer_table_profiles_select_control" on public.dealer_table_profiles;
create policy "dealer_table_profiles_select_control" on public.dealer_table_profiles
  for select using (
    public.is_club_dealer_control(auth.uid(), club_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );

drop policy if exists "dealer_table_pool_members_select_control" on public.dealer_table_pool_members;
create policy "dealer_table_pool_members_select_control" on public.dealer_table_pool_members
  for select using (
    public.is_club_dealer_control(auth.uid(), club_id)
    or public.has_role(auth.uid(), 'super_admin'::public.app_role)
  );
-- NO INSERT/UPDATE/DELETE policy → direct client writes denied; writes only via Patch-3 RPCs.

-- -------------------------------------------------------------------------------
-- [2/5]  20261105000000_dealer_feature_tables_rpcs.sql
--        P3: _assert_dealer_allowed_for_table + config RPCs + get_table_dealer_rules + kill-switch seed 'false'
-- -------------------------------------------------------------------------------
-- ═══════════════════════════════════════════════════════════════════════════════
-- Patch 3 — Dealer feature/final tables: eligibility helper + config RPCs. SOURCE-ONLY.
--
-- Per ADR 012 (+ amendments). Builds on Patch 2 tables (20261104000000). Apply AFTER
-- Patch 2 (DR-3). NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--   • DR-1 kill-switch lives in app_settings('dealer_feature_tables_enabled'); the SQL
--     helper AND the (Patch-5) TS picker read the SAME key. Default seeded false.
--   • DR-2 lock order: config writes lock the profile row FIRST (the anchor); the
--     eligibility helper does a plain read (no pool lock).
--   • Writes are SECURITY DEFINER + internal authz (is_club_dealer_control OR super_admin)
--     + audit to public.audit_logs. Reads (get_table_dealer_rules) bypass RLS but authz the
--     same way (P1-B: the canonical read path for operators).
-- ═══════════════════════════════════════════════════════════════════════════════

-- ── DR-1 kill-switch (default OFF) ───────────────────────────────────────────
insert into public.app_settings (key, value)
values ('dealer_feature_tables_enabled', 'false'::jsonb)
on conflict (key) do nothing;

-- ── eligibility helper (private; authoritative for Patch 4/5) ─────────────────
-- Returns TRUE (allowed) when: kill-switch off, tables absent (DR-3 guard), the table
-- has no profile, or the table is normal (not feature and not final). For a SPECIAL
-- table (feature OR final) returns whether the dealer is in its pool. Plain read (DR-2).
create or replace function public._assert_dealer_allowed_for_table(p_table_id uuid, p_dealer_id uuid)
returns boolean
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_mode text; v_is_final boolean;
begin
  -- kill-switch OFF → feature inert → everyone allowed
  if not coalesce(
       (select s.value = 'true'::jsonb from public.app_settings s where s.key = 'dealer_feature_tables_enabled'),
       false) then
    return true;
  end if;
  -- absence guard (DR-3): tables not applied → behave as normal
  if to_regclass('public.dealer_table_profiles') is null then
    return true;
  end if;
  select table_mode, is_final into v_mode, v_is_final
  from public.dealer_table_profiles where table_id = p_table_id;
  if not found then return true; end if;            -- no profile → normal
  if v_mode <> 'feature' and not v_is_final then return true; end if;  -- normal table
  -- special table → dealer must be in the pool
  return exists (
    select 1 from public.dealer_table_pool_members
    where table_id = p_table_id and dealer_id = p_dealer_id
  );
end;
$$;
revoke all on function public._assert_dealer_allowed_for_table(uuid, uuid) from public, anon, authenticated;

-- ── internal authz helper (operator/dealer-control of the table's club) ──────
create or replace function public._dealer_feature_can_manage(p_actor uuid, p_club_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select public.is_club_dealer_control(p_actor, p_club_id)
      or public.has_role(p_actor, 'super_admin'::public.app_role);
$$;
revoke all on function public._dealer_feature_can_manage(uuid, uuid) from public, anon, authenticated;

-- ── set_table_dealer_mode ────────────────────────────────────────────────────
create or replace function public.set_table_dealer_mode(
  p_table_id uuid,
  p_table_mode text,
  p_is_final boolean default false,
  p_allow_override boolean default false
)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_club uuid; v_old jsonb;
begin
  if v_actor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if p_table_mode not in ('normal','feature') then
    raise exception 'invalid table_mode %', p_table_mode using errcode = 'DT005';
  end if;
  select club_id into v_club from public.game_tables where id = p_table_id;
  if v_club is null then raise exception 'game_table % not found', p_table_id using errcode = 'DT003'; end if;
  if not public._dealer_feature_can_manage(v_actor, v_club) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  select to_jsonb(p) into v_old from public.dealer_table_profiles p where p.table_id = p_table_id;

  insert into public.dealer_table_profiles (club_id, table_id, table_mode, is_final, allow_override)
  values (v_club, p_table_id, p_table_mode, coalesce(p_is_final,false), coalesce(p_allow_override,false))
  on conflict (table_id) do update
    set table_mode = excluded.table_mode,
        is_final = excluded.is_final,
        allow_override = excluded.allow_override,
        updated_at = now();

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  values (v_club, v_actor, 'set_table_dealer_mode', 'dealer_table_profile', p_table_id,
          jsonb_build_object('old', v_old,
            'new', jsonb_build_object('table_mode', p_table_mode, 'is_final', coalesce(p_is_final,false),
                                      'allow_override', coalesce(p_allow_override,false))));

  return jsonb_build_object('table_id', p_table_id, 'club_id', v_club, 'table_mode', p_table_mode,
                           'is_final', coalesce(p_is_final,false), 'allow_override', coalesce(p_allow_override,false));
end;
$$;
revoke all on function public.set_table_dealer_mode(uuid, text, boolean, boolean) from public, anon;
grant execute on function public.set_table_dealer_mode(uuid, text, boolean, boolean) to authenticated;

-- ── set_table_dealer_pool (replace-all; locks the profile row first, DR-2) ────
-- p_members = jsonb array of {dealer_id, priority?, is_primary?}. Same-club enforced by trigger.
create or replace function public.set_table_dealer_pool(p_table_id uuid, p_members jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid(); v_club uuid; v_old_count int; v_new_count int;
begin
  if v_actor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  select club_id into v_club from public.game_tables where id = p_table_id;
  if v_club is null then raise exception 'game_table % not found', p_table_id using errcode = 'DT003'; end if;
  if not public._dealer_feature_can_manage(v_actor, v_club) then
    raise exception 'forbidden' using errcode = '42501';
  end if;

  -- DR-2: lock the profile row (the serialization anchor); create a default normal
  -- profile if none exists so the pool can attach (flow A: pre-load pool, flip later).
  perform 1 from public.dealer_table_profiles where table_id = p_table_id for update;
  if not found then
    insert into public.dealer_table_profiles (club_id, table_id) values (v_club, p_table_id);
  end if;

  select count(*) into v_old_count from public.dealer_table_pool_members where table_id = p_table_id;

  delete from public.dealer_table_pool_members where table_id = p_table_id;
  insert into public.dealer_table_pool_members (club_id, table_id, dealer_id, priority, is_primary)
  select v_club, p_table_id, (e->>'dealer_id')::uuid,
         coalesce((e->>'priority')::int, 100),
         coalesce((e->>'is_primary')::boolean, false)
  from jsonb_array_elements(coalesce(p_members, '[]'::jsonb)) e;
  get diagnostics v_new_count = row_count;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  values (v_club, v_actor, 'set_table_dealer_pool', 'dealer_table_profile', p_table_id,
          jsonb_build_object('old_count', v_old_count, 'new_count', v_new_count, 'members', coalesce(p_members,'[]'::jsonb)));

  return jsonb_build_object('table_id', p_table_id, 'club_id', v_club, 'member_count', v_new_count);
end;
$$;
revoke all on function public.set_table_dealer_pool(uuid, jsonb) from public, anon;
grant execute on function public.set_table_dealer_pool(uuid, jsonb) to authenticated;

-- ── get_table_dealer_rules (canonical operator read; P1-B) ───────────────────
create or replace function public.get_table_dealer_rules(p_club_id uuid)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare v_actor uuid := auth.uid();
begin
  if v_actor is null then raise exception 'forbidden' using errcode = '42501'; end if;
  if not public._dealer_feature_can_manage(v_actor, p_club_id) then
    raise exception 'forbidden' using errcode = '42501';
  end if;
  return jsonb_build_object(
    'club_id', p_club_id,
    'as_of', now(),
    'tables', coalesce((
      select jsonb_agg(jsonb_build_object(
        'table_id', pr.table_id,
        'table_mode', pr.table_mode,
        'is_final', pr.is_final,
        'allow_override', pr.allow_override,
        'display_label', pr.display_label,
        'pool', coalesce((
          select jsonb_agg(jsonb_build_object(
            'dealer_id', pm.dealer_id, 'name', d.full_name,
            'priority', pm.priority, 'is_primary', pm.is_primary
          ) order by pm.priority asc, pm.is_primary desc, pm.created_at asc, pm.dealer_id)
          from public.dealer_table_pool_members pm
          join public.dealers d on d.id = pm.dealer_id
          where pm.table_id = pr.table_id
        ), '[]'::jsonb)
      ) order by pr.created_at)
      from public.dealer_table_profiles pr
      where pr.club_id = p_club_id
    ), '[]'::jsonb)
  );
end;
$$;
revoke all on function public.get_table_dealer_rules(uuid) from public, anon;
grant execute on function public.get_table_dealer_rules(uuid) to authenticated;

-- -------------------------------------------------------------------------------
-- [3/5]  20261106000000_dealer_feature_enforce_manual_assign.sql
--        P4: assign_dealer_to_table 10-param + audited override (gen-v3, STEP-0.7 profile-first lock) — TRANSIENT
-- -------------------------------------------------------------------------------
-- ═══════════════════════════════════════════════════════════════════════════════
-- Patch 4 — Enforce feature/final dealer-pool eligibility in assign_dealer_to_table
-- + audited manual floor override. SOURCE-ONLY (per ADR 012 + Amendment A7).
--
-- Redefines the single chokepoint for ALL dealer-assignment writes (manual edge +
-- fillEmptyTables + checkout-dealer + process-swing Pass 3). Builds on Patch 2 tables
-- (20261104000000) + Patch 3 helper (20261105000000). Apply AFTER both (DR-3).
-- NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--
--   • DR-2 lock order (Amendment A7): lock dealer_table_profiles FOR UPDATE (the anchor)
--     BEFORE the attendance lock (order profile→da), so _assert_dealer_allowed_for_table
--     reads under the anchor and the pool cannot change between check and seat (closes TOCTOU).
--   • DR-1 kill-switch: the helper returns "allowed" while app_settings
--     'dealer_feature_tables_enabled' is off → enforcement OUTCOMES are inert until enabled.
--   • Override (DR-8b) is MANUAL-only: requires p_override + a non-empty reason + an actor
--     authorized via is_club_dealer_control against the table's AUTHORITATIVE game_tables club
--     (not client p_club_id) + a self-guard for direct callers; audited FATALLY to audit_logs.
--   • allow_override is informational (owner decision) — no SQL hard-lock against override.
--
-- HARD SEQUENCING GATE: do NOT enable the kill-switch until Patch 5 (force-release checks
-- eligibility BEFORE releasing; swing re-check under the profile lock) AND Patch 6 (edge passes
-- the override args) are merged — else the existing edge force-assign of a non-pool dealer to a
-- special table returns 'not_eligible' → HTTP 500, and Pass-3 force-release strands tables empty.
--
-- ROLLBACK: snapshot pg_get_functiondef('public.assign_dealer_to_table') BEFORE apply; rollback
-- = DROP the 10-param + CREATE the original 7-param body (20260801000005). Inert until the flip.
-- ═══════════════════════════════════════════════════════════════════════════════


-- Drop prior signatures so the new 10-param is the ONLY overload (the post-condition DO block
-- below fail-safes a missed/mismatched drop). Live signature = the 7-param (20260801000005).
DROP FUNCTION IF EXISTS public.assign_dealer_to_table(uuid, uuid, timestamptz, timestamptz);
DROP FUNCTION IF EXISTS public.assign_dealer_to_table(uuid, uuid, timestamptz, timestamptz, uuid, text, text);
DROP FUNCTION IF EXISTS public.assign_dealer_to_table(uuid, uuid, timestamptz, timestamptz, uuid, text, boolean);                  -- live 7-param
DROP FUNCTION IF EXISTS public.assign_dealer_to_table(uuid, uuid, timestamptz, timestamptz, uuid, text, boolean, boolean, text, uuid);  -- new 10-param (re-run safety)

CREATE OR REPLACE FUNCTION public.assign_dealer_to_table(
  p_attendance_id    UUID,
  p_table_id         UUID,
  p_assigned_at      TIMESTAMPTZ  DEFAULT NOW(),
  p_swing_due_at     TIMESTAMPTZ  DEFAULT NULL,
  p_club_id          UUID          DEFAULT NULL,
  p_idempotency_key  TEXT          DEFAULT NULL,
  p_force_replace    BOOLEAN       DEFAULT false,
  p_override         BOOLEAN       DEFAULT false,    -- Patch 4: manual override of a special-table pool
  p_override_reason  TEXT          DEFAULT NULL,     -- Patch 4: required, audited
  p_actor            UUID          DEFAULT NULL      -- Patch 4: override actor (edge passes JWT sub)
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public    -- Patch 4: was missing → closes a latent SECURITY DEFINER search_path hole
AS $$
DECLARE
  v_assignment_id    UUID;
  v_orphan_count     INT := 0;
  v_now              TIMESTAMPTZ := NOW();
  v_resolved_club_id UUID;
  v_dealer_id        UUID;    -- Patch 4: resolved from the locked attendance row (for eligibility)
  v_gt_club          UUID;    -- Patch 4: authoritative game_tables club (override authz/audit only)
BEGIN
  -- STEP 0: Idempotency check — BEFORE any side effects (a replay returns the already-decided
  -- assignment; it does NOT re-run eligibility/override or re-audit).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_assignment_id
    FROM dealer_assignments
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_assignment_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'outcome', 'ok',
        'assignment_id', v_assignment_id,
        'orphan_count', 0,
        'idempotent', true
      );
    END IF;
  END IF;

  -- STEP 0.7 (Patch 4 — DR-2 profile-lock anchor): lock the special table's profile row FIRST,
  -- BEFORE the attendance lock, so set_table_dealer_pool cannot mutate the pool between the
  -- eligibility read (STEP 1.5) and the seat. Lock order = profile → da (canonical, ADR A7).
  -- Normal tables have no profile row → FOR UPDATE matches nothing → common path unchanged
  -- (serialization only on special tables, never the outcome). to_regclass guard mirrors the
  -- helper (DR-3) so applying before Patch 2 cannot error.
  IF to_regclass('public.dealer_table_profiles') IS NOT NULL THEN
    PERFORM 1 FROM public.dealer_table_profiles WHERE table_id = p_table_id FOR UPDATE;
  END IF;

  -- STEP 1: Lock attendance row (dealer must be available and checked in)
  SELECT dealer_id INTO v_dealer_id FROM dealer_attendance
  WHERE id = p_attendance_id
    AND current_state = 'available'
    AND status = 'checked_in'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'detail', 'Dealer not available or locked');
  END IF;

  -- STEP 1.5 (Patch 4 — feature/final eligibility + audited manual override):
  -- The profile row is FOR UPDATE'd in STEP 0.7 (DR-2 anchor, order profile→da) BEFORE this read,
  -- so _assert_dealer_allowed_for_table is authoritative — the pool cannot change between check and seat.
  IF NOT public._assert_dealer_allowed_for_table(p_table_id, v_dealer_id) THEN
    IF NOT p_override THEN
      RETURN jsonb_build_object('outcome', 'not_eligible', 'detail', 'Dealer not in pool for feature/final table', 'table_id', p_table_id);
    END IF;
    IF p_actor IS NULL OR btrim(coalesce(p_override_reason, '')) = '' THEN
      RETURN jsonb_build_object('outcome', 'override_invalid', 'detail', 'Override requires actor and non-empty reason');
    END IF;
    -- Direct authenticated caller may only act as itself; the edge runs as service_role
    -- (auth.uid() NULL) so p_actor (the JWT sub it verified) is trusted.
    IF auth.uid() IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid() THEN
      RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'Actor mismatch');
    END IF;
    -- AUTHORITATIVE club from game_tables (NOT client p_club_id) → no cross-club override bypass.
    SELECT club_id INTO v_gt_club FROM game_tables WHERE id = p_table_id;
    IF v_gt_club IS NULL OR NOT public.is_club_dealer_control(p_actor, v_gt_club) THEN
      RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'Actor not authorized to override for this table');
    END IF;
    -- FATAL audit by design: an override that cannot be recorded must NOT happen (no silent
    -- non-pool seat on a final/livestream table). p_actor passed is_club_dealer_control ⇒ a real
    -- auth.users id ⇒ the actor_id FK will not fail. entity_type/entity_id match Patch-3 config
    -- audits so one query pulls a table's full config + override history.
    INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
    VALUES (v_gt_club, p_actor, 'dealer_feature_override_assign', 'dealer_table_profile', p_table_id,
      jsonb_build_object('table_id', p_table_id, 'dealer_id', v_dealer_id, 'attendance_id', p_attendance_id,
        'override', true, 'reason', p_override_reason, 'forced_non_pool_dealer', true));
  END IF;

  -- STEP 2: Check table is not already occupied (skip if p_force_replace)
  IF NOT p_force_replace AND EXISTS (
    SELECT 1 FROM dealer_assignments
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('outcome', 'table_occupied', 'detail', 'Table already has an active dealer');
  END IF;

  -- STEP 3: Release existing assignment at target table
  -- (has effect when p_force_replace bypassed Step 2, or for stale data cleanup)
  WITH released AS (
    UPDATE dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'displaced_by_new_assignment'
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
    RETURNING attendance_id
  )
  UPDATE dealer_attendance
  SET current_state = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL
  WHERE id IN (SELECT attendance_id FROM released)
    AND current_state IN ('assigned', 'on_break');

  -- STEP 4: Release orphan assignments for this dealer at OTHER tables
  SELECT COUNT(*) INTO v_orphan_count
  FROM dealer_assignments
  WHERE attendance_id = p_attendance_id
    AND status IN ('assigned', 'on_break')
    AND table_id != p_table_id
    AND released_at IS NULL;

  IF v_orphan_count > 0 THEN
    UPDATE dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'force_release_before_reassign'
    WHERE attendance_id = p_attendance_id
      AND status IN ('assigned', 'on_break')
      AND table_id != p_table_id
      AND released_at IS NULL;

    RAISE NOTICE '[assign_dealer_to_table] Released % orphan assignment(s) for attendance %',
      v_orphan_count, p_attendance_id;
  END IF;

  -- STEP 5: Clear stale needs_replacement flag
  UPDATE dealer_assignments
  SET needs_replacement = false
  WHERE table_id = p_table_id
    AND needs_replacement = true;

  -- STEP 6: Resolve club_id (unchanged — p_club_id wins; v_gt_club above is override-path only)
  IF p_club_id IS NOT NULL THEN
    v_resolved_club_id := p_club_id;
  ELSE
    SELECT club_id INTO v_resolved_club_id
    FROM game_tables
    WHERE id = p_table_id;
  END IF;

  -- STEP 7: Insert new assignment
  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status,
    assigned_at, swing_due_at, idempotency_key
  ) VALUES (
    p_attendance_id, p_table_id, v_resolved_club_id, 'assigned',
    p_assigned_at, p_swing_due_at, p_idempotency_key
  ) RETURNING id INTO v_assignment_id;

  -- STEP 8: Update dealer state
  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'assignment_id', v_assignment_id,
    'orphan_count', v_orphan_count
  );
END;
$$;

-- Overload-bomb guard (P1-C fail-safe): exactly one assign_dealer_to_table must remain.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc
      WHERE proname = 'assign_dealer_to_table'
        AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'assign_dealer_to_table overload not unique (a prior signature was not dropped)';
  END IF;
END $$;

COMMENT ON FUNCTION public.assign_dealer_to_table(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, UUID) IS
  'v3 (Patch 4): v2 atomic-assign + feature/final eligibility under a dealer_table_profiles FOR UPDATE anchor (DR-2/A7) + audited manual override (p_override/p_override_reason/p_actor; outcomes not_eligible/override_invalid/forbidden). Enforcement OUTCOMES inert while app_settings.dealer_feature_tables_enabled is off.';


-- -------------------------------------------------------------------------------
-- [4/5]  20261108000000_dealer_override_claims.sql
--        P5a-claim: dealer_override_claims table (RLS enabled, NO write policy => unforgeable)
-- -------------------------------------------------------------------------------
-- ═══════════════════════════════════════════════════════════════════════════════
-- Patch 5a-claim — additive override-claim table for the M2 non-forgeable override
-- signal. SOURCE-ONLY (ADR 012 + Amendment A8, claim model).
--
-- WHY: the rejected REVOKE+GUC model (#556) would have broken release_dealer_from_table
-- (SECURITY INVOKER, called from DealerSwingTab.tsx:2168 as authenticated) and exposed 3
-- other INVOKER writers. This table replaces it: an authorized manual override leaves a
-- same-transaction, single-use CLAIM row that the seat trigger (Patch 5a-rewrite,
-- 20261109000000) consumes — instead of a forgeable GUC + a collateral REVOKE.
--
-- FORGERY-PROOF BY CONSTRUCTION (no REVOKE needed): RLS enabled + NO write policy
-- (the proven Patch-2 pattern, 20261104000000:122-139) → authenticated/anon direct writes
-- are RLS-denied even with the default grant. Only the postgres SECURITY DEFINER
-- assign_dealer_to_table (owner bypasses RLS) writes a claim; only the postgres SECURITY
-- DEFINER trigger reads/consumes it. No client can fabricate a claim.
--
-- SAME-TX + REPLAY-PROOF: `txid` = pg_current_xact_id() of the writing (assign) tx. The
-- trigger matches `txid = pg_current_xact_id()` of the seating tx → matches only its own
-- tx; a different tx (a client's direct insert) never matches; a stale claim from a past
-- tx never re-matches (different xid). Match is anchored on `attendance_id` (the seat
-- instance) so a claim for one seat cannot cover a different seat in the same tx.
--
-- NO REVOKE here or in the rewrite → release_dealer_from_table + the 3 INVOKER writers are
-- UNTOUCHED → zero production regression. Apply BEFORE 20261109000000 (it references this
-- table). NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--
-- ROLLBACK: `DROP TABLE public.dealer_override_claims;` (independent, additive, inert until
-- the rewrite's trigger/assign reference it).
-- ═══════════════════════════════════════════════════════════════════════════════


create table if not exists public.dealer_override_claims (
  id            uuid primary key default gen_random_uuid(),
  table_id      uuid not null references public.game_tables(id) on delete cascade,
  dealer_id     uuid not null references public.dealers(id) on delete cascade,         -- audit/debug only; matching anchors on attendance_id
  attendance_id uuid not null references public.dealer_attendance(id) on delete cascade, -- seat-instance anchor for trigger matching
  txid          bigint not null,                                                        -- pg_current_xact_id() of the assign tx (same-tx, replay-proof)
  created_at    timestamptz not null default now()
);

-- Trigger match path: (attendance_id, txid).
create index if not exists idx_dealer_override_claims_match on public.dealer_override_claims(attendance_id, txid);
-- Cleanup of harmless orphans (an override that wrote a claim but returned before the seat INSERT,
-- e.g. table_occupied): such claims never re-match (txid-scoped) but can be pruned by age.
create index if not exists idx_dealer_override_claims_created on public.dealer_override_claims(created_at);

-- RLS: enable + NO write policy → direct client writes denied (Patch-2 precedent). The trigger
-- (postgres DEFINER, owner) bypasses RLS to read/DELETE; assign (postgres DEFINER) bypasses RLS to
-- INSERT. No SELECT policy → clients cannot read claims either. service_role bypasses RLS but never
-- writes claims. No GRANT/REVOKE statements — default grants are inert under RLS-with-no-policy.
alter table public.dealer_override_claims enable row level security;

COMMENT ON TABLE public.dealer_override_claims IS
  'Patch 5a (M2): same-tx, single-use authorized-override claims consumed by dealer_assignments_pool_enforce. RLS-on + no write policy → unforgeable by clients; only the postgres DEFINER assign_dealer_to_table writes, only the postgres DEFINER trigger reads/consumes. txid=pg_current_xact_id() gives same-tx + replay-proof matching anchored on attendance_id. Replaces the rejected REVOKE+GUC override model (no REVOKE → release_dealer_from_table + INVOKER writers untouched).';


-- -------------------------------------------------------------------------------
-- [5/5]  20261109000000_dealer_feature_pool_seat_trigger.sql
--        P5a-rewrite: BEFORE INSERT/UPDATE trigger + assign M2 (gen-v4, claim-consume override, no REVOKE)
-- -------------------------------------------------------------------------------
-- ═══════════════════════════════════════════════════════════════════════════════
-- Patch 5a-rewrite — auto-swing feature/final pool enforcement via a dealer_assignments
-- seat trigger, using the M2 same-tx single-use override CLAIM (NO REVOKE, NO GUC).
-- SOURCE-ONLY (ADR 012 + Amendment A8, claim model). Supersedes the rejected #556
-- (REVOKE+GUC) approach.
--
-- Apply AFTER Patch 2 (20261104000000), Patch 3 (20261105000000), Patch 4 (20261106000000),
-- AND Patch 5a-claim (20261108000000 — this migration references public.dealer_override_claims).
-- NO `supabase db push`, NO deploy_db, NO schema_migrations edit.
--
-- WHY this replaces #556: re-grep proved REVOKE would break release_dealer_from_table
-- (SECURITY INVOKER, called from DealerSwingTab.tsx:2168 as authenticated) + expose 3 other
-- INVOKER writers. So: NO REVOKE; the override signal is a same-tx, single-use claim row
-- written by assign's DEFINER override branch into dealer_override_claims (RLS-no-write →
-- unforgeable) and consumed by this trigger. release_dealer_from_table + the 3 INVOKER
-- writers are UNTOUCHED → zero production regression.
--
--   • A8.0 model: BEFORE INSERT OR UPDATE trigger at the shared seat sink — covers every
--     seat-writer + future ones; fires on new active seats + promote-to-active UPDATEs;
--     skips already-active bookkeeping + same-dealer/table race-restores.
--   • A8.2 lock: trigger holds dealer_table_profiles FOR UPDATE through the write → TOCTOU
--     closed. Uniform order {da|attendance} → profile (assign STEP 0.7 removed). Deadlock-free
--     (config RPCs lock only profile; assign uses SKIP LOCKED on attendance).
--   • A8.3 override = same-tx single-use CLAIM (no GUC, no REVOKE). Trigger consumes (DELETE)
--     the claim anchored on attendance_id (seat-instance) + txid=pg_current_xact_id() (same-tx,
--     replay-proof). Single-use is safe: an override seat is created by assign via ONE direct
--     status='assigned' INSERT (STEP 7) → trigger fires exactly once → consume there. The
--     reserved/pre_assigned→assigned multi-transition path is auto/pool (claim-free).
--   • A8.1 kill-switch + non-special short-circuit BEFORE pg_current_xact_id() → no xid forcing
--     on the hot path (normal tables, off-state, pool dealers never touch it).
--
-- ROLLBACK: snapshot pg_get_functiondef of the trigger fn + assign_dealer_to_table BEFORE apply.
-- Undo = DROP TRIGGER + DROP FUNCTION dealer_assignments_pool_enforce() + restore the Patch-4
-- assign body (re-add STEP 0.7, drop the claim INSERT). Inert until the kill-switch flips.
-- ═══════════════════════════════════════════════════════════════════════════════


-- ── (1) Enforcement trigger (claim-model; the hard guarantee for ALL seat-writers) ──
create or replace function public.dealer_assignments_pool_enforce()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare v_dealer_id uuid;
begin
  -- Only active seats matter.
  if NEW.status not in ('assigned', 'on_break') then
    return NEW;
  end if;

  -- Same dealer continuing/restoring the SAME table's seat (already-active version/time
  -- bookkeeping, or a race-lost restore completed→assigned) → not a new occupant → no re-check.
  -- INSERT, a different dealer/table, or a reserved/pre_assigned → assigned promote → falls through.
  if TG_OP = 'UPDATE'
     and OLD.attendance_id = NEW.attendance_id
     and OLD.table_id = NEW.table_id
     and OLD.status in ('assigned', 'on_break', 'completed') then
    return NEW;
  end if;

  -- A8.1 kill-switch: fully inert when off (short-circuit BEFORE any lock / xid).
  if not coalesce(
       (select s.value = 'true'::jsonb from public.app_settings s
        where s.key = 'dealer_feature_tables_enabled'),
       false) then
    return NEW;
  end if;

  -- DR-3 absence guard (defensive; the tables exist once Patch 2 is applied).
  if to_regclass('public.dealer_table_profiles') is null then
    return NEW;
  end if;

  select dealer_id into v_dealer_id from public.dealer_attendance where id = NEW.attendance_id;

  -- A8.2 anchor: hold the profile row FOR UPDATE through the write → set_table_dealer_pool
  -- (which locks the same row) cannot change the pool between this check and the seat.
  -- Normal tables have no profile row → FOR UPDATE matches nothing → no lock, no cost.
  perform 1 from public.dealer_table_profiles where table_id = NEW.table_id for update;

  -- Pool dealer (or normal table → helper returns true) → allowed. NO claim lookup, NO xid touched
  -- (honors the "short-circuit before pg_current_xact_id() on the hot path" requirement: only a
  -- NON-pool dealer on a SPECIAL table reaches the claim/xid branch below).
  if public._assert_dealer_allowed_for_table(NEW.table_id, v_dealer_id) then
    return NEW;
  end if;

  -- Non-pool dealer on a special table → require a same-tx, single-use authorized override CLAIM.
  -- A8.3: match anchored on attendance_id (this seat instance) + txid (same assign tx);
  -- DELETE consumes it (single-use) so one claim authorizes exactly one seat write. A client
  -- cannot fabricate a claim (dealer_override_claims is RLS-no-write; only the postgres DEFINER
  -- assign writes it). pg_current_xact_id() is reached ONLY here (rare).
  delete from public.dealer_override_claims
   where attendance_id = NEW.attendance_id
     and txid = pg_current_xact_id()::text::bigint;
  if FOUND then
    return NEW;  -- authorized override, consumed
  end if;

  raise exception 'DEALER_NOT_IN_POOL: dealer % not allowed for feature/final table %',
    v_dealer_id, NEW.table_id using errcode = 'DT006';
end;
$$;

drop trigger if exists trg_dealer_assignments_pool_enforce on public.dealer_assignments;
create trigger trg_dealer_assignments_pool_enforce
  before insert or update on public.dealer_assignments
  for each row execute function public.dealer_assignments_pool_enforce();

-- ── (2) assign_dealer_to_table: uniform lock order + write an override CLAIM ───────
-- Faithful re-copy of the merged Patch-4 10-arg body (20261106000000) with TWO changes:
--   • REMOVE the STEP 0.7 profile-first lock — the trigger is the sole locking enforcer →
--     uniform {da|attendance} → profile order (A8.2). STEP 1.5's inline _assert stays a
--     PLAIN-read pre-check for a clean 'not_eligible'; the trigger is the race-authoritative backstop.
--   • REPLACE the override skip-signal: instead of a forgeable GUC, INSERT a same-tx single-use
--     claim into dealer_override_claims (after the audit) so the trigger allows THIS seat.
-- Same 10-arg signature → CREATE OR REPLACE (no DROP); the overload guard fail-safes drift.
create or replace function public.assign_dealer_to_table(
  p_attendance_id    UUID,
  p_table_id         UUID,
  p_assigned_at      TIMESTAMPTZ  DEFAULT NOW(),
  p_swing_due_at     TIMESTAMPTZ  DEFAULT NULL,
  p_club_id          UUID          DEFAULT NULL,
  p_idempotency_key  TEXT          DEFAULT NULL,
  p_force_replace    BOOLEAN       DEFAULT false,
  p_override         BOOLEAN       DEFAULT false,
  p_override_reason  TEXT          DEFAULT NULL,
  p_actor            UUID          DEFAULT NULL
)
RETURNS JSONB
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public
AS $$
DECLARE
  v_assignment_id    UUID;
  v_orphan_count     INT := 0;
  v_now              TIMESTAMPTZ := NOW();
  v_resolved_club_id UUID;
  v_dealer_id        UUID;
  v_gt_club          UUID;
BEGIN
  -- STEP 0: Idempotency check — BEFORE any side effects (a replay returns the already-decided
  -- assignment; it does NOT re-run eligibility/override, re-audit, or write a claim).
  IF p_idempotency_key IS NOT NULL THEN
    SELECT id INTO v_assignment_id
    FROM dealer_assignments
    WHERE idempotency_key = p_idempotency_key
    LIMIT 1;

    IF v_assignment_id IS NOT NULL THEN
      RETURN jsonb_build_object(
        'outcome', 'ok',
        'assignment_id', v_assignment_id,
        'orphan_count', 0,
        'idempotent', true
      );
    END IF;
  END IF;

  -- STEP 1: Lock attendance row (dealer must be available and checked in)
  SELECT dealer_id INTO v_dealer_id FROM dealer_attendance
  WHERE id = p_attendance_id
    AND current_state = 'available'
    AND status = 'checked_in'
  FOR UPDATE SKIP LOCKED;

  IF NOT FOUND THEN
    RETURN jsonb_build_object('outcome', 'conflict', 'detail', 'Dealer not available or locked');
  END IF;

  -- STEP 1.5 (Patch 4 + 5a-rewrite): feature/final eligibility PLAIN-read pre-check for a clean
  -- 'not_eligible' / the audited manual override. The race-authoritative enforcer is the
  -- BEFORE INSERT/UPDATE trigger (dealer_assignments_pool_enforce) which holds
  -- dealer_table_profiles FOR UPDATE through the seat (A8.2); this inline read is not locked.
  IF NOT public._assert_dealer_allowed_for_table(p_table_id, v_dealer_id) THEN
    IF NOT p_override THEN
      RETURN jsonb_build_object('outcome', 'not_eligible', 'detail', 'Dealer not in pool for feature/final table', 'table_id', p_table_id);
    END IF;
    IF p_actor IS NULL OR btrim(coalesce(p_override_reason, '')) = '' THEN
      RETURN jsonb_build_object('outcome', 'override_invalid', 'detail', 'Override requires actor and non-empty reason');
    END IF;
    -- Direct authenticated caller may only act as itself; the edge runs as service_role
    -- (auth.uid() NULL) so p_actor (the JWT sub it verified) is trusted.
    IF auth.uid() IS NOT NULL AND p_actor IS DISTINCT FROM auth.uid() THEN
      RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'Actor mismatch');
    END IF;
    -- AUTHORITATIVE club from game_tables (NOT client p_club_id) → no cross-club override bypass.
    SELECT club_id INTO v_gt_club FROM game_tables WHERE id = p_table_id;
    IF v_gt_club IS NULL OR NOT public.is_club_dealer_control(p_actor, v_gt_club) THEN
      RETURN jsonb_build_object('outcome', 'forbidden', 'detail', 'Actor not authorized to override for this table');
    END IF;
    -- FATAL audit by design: an override that cannot be recorded must NOT happen. p_actor passed
    -- is_club_dealer_control ⇒ a real auth.users id ⇒ the actor_id FK will not fail.
    INSERT INTO public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
    VALUES (v_gt_club, p_actor, 'dealer_feature_override_assign', 'dealer_table_profile', p_table_id,
      jsonb_build_object('table_id', p_table_id, 'dealer_id', v_dealer_id, 'attendance_id', p_attendance_id,
        'override', true, 'reason', p_override_reason, 'forced_non_pool_dealer', true));
    -- A8.3: write a same-tx, single-use override CLAIM (anchored on attendance_id; txid = THIS tx →
    -- replay-proof) so the seat trigger allows THIS authorized seat. Unforgeable by clients
    -- (dealer_override_claims is RLS-no-write; only this postgres DEFINER fn writes it). The trigger
    -- DELETE-consumes it on the STEP 7 INSERT (the override seat fires the trigger exactly once).
    INSERT INTO public.dealer_override_claims (table_id, dealer_id, attendance_id, txid)
    VALUES (p_table_id, v_dealer_id, p_attendance_id, pg_current_xact_id()::text::bigint);
  END IF;

  -- STEP 2: Check table is not already occupied (skip if p_force_replace)
  IF NOT p_force_replace AND EXISTS (
    SELECT 1 FROM dealer_assignments
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
  ) THEN
    RETURN jsonb_build_object('outcome', 'table_occupied', 'detail', 'Table already has an active dealer');
  END IF;

  -- STEP 3: Release existing assignment at target table
  -- (has effect when p_force_replace bypassed Step 2, or for stale data cleanup)
  WITH released AS (
    UPDATE dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'displaced_by_new_assignment'
    WHERE table_id = p_table_id
      AND status IN ('assigned', 'on_break')
      AND released_at IS NULL
    RETURNING attendance_id
  )
  UPDATE dealer_attendance
  SET current_state = 'available',
      pre_assigned_table_id = NULL,
      pre_assigned_at = NULL
  WHERE id IN (SELECT attendance_id FROM released)
    AND current_state IN ('assigned', 'on_break');

  -- STEP 4: Release orphan assignments for this dealer at OTHER tables
  SELECT COUNT(*) INTO v_orphan_count
  FROM dealer_assignments
  WHERE attendance_id = p_attendance_id
    AND status IN ('assigned', 'on_break')
    AND table_id != p_table_id
    AND released_at IS NULL;

  IF v_orphan_count > 0 THEN
    UPDATE dealer_assignments
    SET status = 'completed',
        released_at = v_now,
        release_reason = 'force_release_before_reassign'
    WHERE attendance_id = p_attendance_id
      AND status IN ('assigned', 'on_break')
      AND table_id != p_table_id
      AND released_at IS NULL;

    RAISE NOTICE '[assign_dealer_to_table] Released % orphan assignment(s) for attendance %',
      v_orphan_count, p_attendance_id;
  END IF;

  -- STEP 5: Clear stale needs_replacement flag
  UPDATE dealer_assignments
  SET needs_replacement = false
  WHERE table_id = p_table_id
    AND needs_replacement = true;

  -- STEP 6: Resolve club_id (p_club_id wins; v_gt_club above is override-path only)
  IF p_club_id IS NOT NULL THEN
    v_resolved_club_id := p_club_id;
  ELSE
    SELECT club_id INTO v_resolved_club_id
    FROM game_tables
    WHERE id = p_table_id;
  END IF;

  -- STEP 7: Insert new assignment
  INSERT INTO dealer_assignments (
    attendance_id, table_id, club_id, status,
    assigned_at, swing_due_at, idempotency_key
  ) VALUES (
    p_attendance_id, p_table_id, v_resolved_club_id, 'assigned',
    p_assigned_at, p_swing_due_at, p_idempotency_key
  ) RETURNING id INTO v_assignment_id;

  -- STEP 8: Update dealer state
  UPDATE dealer_attendance
  SET current_state = 'assigned'
  WHERE id = p_attendance_id;

  RETURN jsonb_build_object(
    'outcome', 'ok',
    'assignment_id', v_assignment_id,
    'orphan_count', v_orphan_count
  );
END;
$$;

-- Overload-bomb guard: exactly one assign_dealer_to_table must remain.
DO $$
BEGIN
  IF (SELECT count(*) FROM pg_proc
      WHERE proname = 'assign_dealer_to_table'
        AND pronamespace = 'public'::regnamespace) <> 1 THEN
    RAISE EXCEPTION 'assign_dealer_to_table overload not unique (a prior signature was not dropped)';
  END IF;
END $$;

COMMENT ON FUNCTION public.assign_dealer_to_table(UUID, UUID, TIMESTAMPTZ, TIMESTAMPTZ, UUID, TEXT, BOOLEAN, BOOLEAN, TEXT, UUID) IS
  'v4 (Patch 5a-rewrite): v3 atomic-assign + override, profile-first lock removed (the BEFORE INSERT/UPDATE trigger dealer_assignments_pool_enforce is the sole locking enforcer, uniform {da|attendance}→profile); the override branch writes a same-tx single-use claim into dealer_override_claims (no GUC, no REVOKE) so the trigger allows the authorized seat. Inline _assert is a plain-read pre-check only.';

COMMENT ON FUNCTION public.dealer_assignments_pool_enforce() IS
  'Patch 5a-rewrite: BEFORE INSERT OR UPDATE enforcement on dealer_assignments. Blocks a non-pool dealer from a feature/final table (errcode DT006) under dealer_table_profiles FOR UPDATE (A8.2 TOCTOU). Inert when app_settings.dealer_feature_tables_enabled is off. Authorized override = a same-tx single-use claim in dealer_override_claims (anchored on attendance_id + txid=pg_current_xact_id()); the trigger DELETE-consumes it. No REVOKE, no GUC.';


-- ═══════════════════════════════════════════════════════════════════════════════
-- HARNESS (kill-switch flip + fixtures + functests + ROLLBACK)
-- Runs AFTER the 5 inlined migrations above, inside the SAME outer BEGIN…ROLLBACK.
-- ═══════════════════════════════════════════════════════════════════════════════

DO $$ BEGIN RAISE NOTICE '=== migrations applied IN-TX (will be ROLLED BACK); starting fixtures + functests ==='; END $$;

-- ── Bật enforcement tạm trong tx (P3 seed = false; functest cần ON) ───────────
-- (ROLLBACK cuối sẽ đưa app_settings về 'false')
UPDATE public.app_settings SET value = 'true'::jsonb WHERE key = 'dealer_feature_tables_enabled';

-- ── FIXTURES (UUID cố định; sẽ rollback) ─────────────────────────────────────
-- club: owner = một auth.users THẬT → is_club_dealer_control(owner, club) = true (nhánh owner)
INSERT INTO public.clubs (id, name, region, owner_id)
VALUES ('0d000000-0000-0000-0000-0000000000c1', 'DRYRUN CLUB', 'DRYRUN', '2078287d-8692-4836-8783-425a64804e40');
-- game_tables: NT (thường) + X (feature/tâm điểm)
INSERT INTO public.game_tables (id, club_id, table_name, status) VALUES
  ('0d000000-0000-0000-0000-0000000000a1', '0d000000-0000-0000-0000-0000000000c1', 'DRYRUN-NORMAL', 'active'),
  ('0d000000-0000-0000-0000-0000000000a2', '0d000000-0000-0000-0000-0000000000c1', 'DRYRUN-FEATURE-X', 'active');
-- dealers: P (pool), N (non-pool), R (relief; cũng non-pool)
INSERT INTO public.dealers (id, club_id, full_name, status) VALUES
  ('0d000000-0000-0000-0000-0000000000d1', '0d000000-0000-0000-0000-0000000000c1', 'Pool Dealer P', 'active'),
  ('0d000000-0000-0000-0000-0000000000d2', '0d000000-0000-0000-0000-0000000000c1', 'NonPool Dealer N', 'active'),
  ('0d000000-0000-0000-0000-0000000000d3', '0d000000-0000-0000-0000-0000000000c1', 'Relief Dealer R', 'active');
-- attendance: available + checked_in
INSERT INTO public.dealer_attendance (id, dealer_id, current_state, status) VALUES
  ('0d000000-0000-0000-0000-0000000000e1', '0d000000-0000-0000-0000-0000000000d1', 'available', 'checked_in'),
  ('0d000000-0000-0000-0000-0000000000e2', '0d000000-0000-0000-0000-0000000000d2', 'available', 'checked_in'),
  ('0d000000-0000-0000-0000-0000000000e3', '0d000000-0000-0000-0000-0000000000d3', 'available', 'checked_in');
-- profile: X = feature; pool: chỉ P (N, R ngoài pool)
INSERT INTO public.dealer_table_profiles (club_id, table_id, table_mode)
VALUES ('0d000000-0000-0000-0000-0000000000c1', '0d000000-0000-0000-0000-0000000000a2', 'feature');
INSERT INTO public.dealer_table_pool_members (club_id, table_id, dealer_id)
VALUES ('0d000000-0000-0000-0000-0000000000c1', '0d000000-0000-0000-0000-0000000000a2', '0d000000-0000-0000-0000-0000000000d1');

DO $$ BEGIN RAISE NOTICE '=== fixtures ready (club, NT, X=feature, dealers P/N/R, pool={P}) — running functests ==='; END $$;

-- ── results sink: rows (Management-API KHÔNG trả RAISE NOTICE — probe-verified) ──
-- Pattern mỗi functest: chạy mutation trong inner BEGIN…EXCEPTION → tự rollback data (raise errcode
-- 'DR000') hoặc bắt expected-exception → giữ verdict ở biến block-ngoài → INSERT 1 row vào bảng này.
-- Cuối: SELECT bảng này TRƯỚC ROLLBACK ngoài cùng → endpoint trả bảng PASS/FAIL. ROLLBACK xoá sạch.
CREATE TEMP TABLE _dryrun_results (seq serial, test text, status text, detail text);

-- ════════════════════════════════ FUNCTESTS ════════════════════════════════

-- F1: pool dealer P → seat trên bàn feature X → OK (INSERT path)
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; BEGIN
  BEGIN
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e1','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour');
    v_st:='PASS'; v_d:='pool dealer P seated on feature table X';
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='unexpected '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F1', v_st, v_d);
END $$;

-- F2 (P0-1 vá — chống PASS-giả): cùng row e2 seat được khi switch OFF (schema-valid) → bật ON → DT006.
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; v_off_ok boolean:=false; BEGIN
  BEGIN
    UPDATE public.app_settings SET value='false'::jsonb WHERE key='dealer_feature_tables_enabled';
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour');
    v_off_ok:=true;
    DELETE FROM public.dealer_assignments WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2' AND table_id='0d000000-0000-0000-0000-0000000000a2';
    UPDATE public.app_settings SET value='true'::jsonb WHERE key='dealer_feature_tables_enabled';
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour');
    v_st:='FAIL'; v_d:='non-pool N seated under enforcement (expected DT006)';
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DT006' THEN
      IF v_off_ok THEN v_st:='PASS'; v_d:='identical row seats with switch OFF (schema-valid) but DT006 with switch ON -> blocked PURELY by pool membership';
      ELSE v_st:='FAIL'; v_d:='DT006 before the OFF control could seat (control failed?)'; END IF;
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN
      IF v_off_ok THEN v_st:='FAIL'; v_d:='unexpected after control: '||SQLSTATE||' '||SQLERRM;
      ELSE v_st:='FAIL'; v_d:='NOT pool logic - e2 row invalid even with enforcement OFF (missing column/constraint): '||SQLSTATE||' '||SQLERRM; END IF;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F2', v_st, v_d);
END $$;

-- F3: authenticated INSERT thẳng dealer_override_claims → RLS-denied (claim unforgeable)
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; BEGIN
  BEGIN
    SET LOCAL ROLE authenticated;
    INSERT INTO public.dealer_override_claims (table_id, dealer_id, attendance_id, txid)
    VALUES ('0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000d2','0d000000-0000-0000-0000-0000000000e2', pg_current_xact_id()::text::bigint);
    v_st:='FAIL'; v_d:='authenticated wrote a claim (RLS should deny)';
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN insufficient_privilege THEN v_st:='PASS'; v_d:='authenticated claim INSERT denied (RLS no-write)';
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='unexpected '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F3', v_st, v_d);
END $$;

-- F4: authorized override (full assign RPC) → claim written → seat allowed same-tx + đúng 1 audit_logs
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; r jsonb; v_audit int; v_seat int; BEGIN
  BEGIN
    r := public.assign_dealer_to_table(
      p_attendance_id => '0d000000-0000-0000-0000-0000000000e2',
      p_table_id      => '0d000000-0000-0000-0000-0000000000a2',
      p_override      => true, p_override_reason => 'dryrun authorized override',
      p_actor         => '2078287d-8692-4836-8783-425a64804e40', p_force_replace => true);
    SELECT count(*) INTO v_audit FROM public.audit_logs
     WHERE action='dealer_feature_override_assign' AND entity_id='0d000000-0000-0000-0000-0000000000a2';
    SELECT count(*) INTO v_seat FROM public.dealer_assignments
     WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2' AND table_id='0d000000-0000-0000-0000-0000000000a2' AND status='assigned' AND released_at IS NULL;
    IF coalesce(r->>'outcome','')='ok' AND v_audit=1 AND v_seat=1
      THEN v_st:='PASS'; v_d:='authorized override seated non-pool N on X (outcome=ok, audit=1, seat=1)';
      ELSE v_st:='FAIL'; v_d:='outcome='||coalesce(r->>'outcome','?')||' audit='||v_audit||' seat='||v_seat; END IF;
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='unexpected '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F4', v_st, v_d);
END $$;

-- F5: claim txid KHÁC (giả lập tx cũ) → không match → DT006 (replay-proof)
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; BEGIN
  BEGIN
    INSERT INTO public.dealer_override_claims (table_id, dealer_id, attendance_id, txid)
    VALUES ('0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000d2','0d000000-0000-0000-0000-0000000000e2', pg_current_xact_id()::text::bigint + 1);
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour');
    v_st:='FAIL'; v_d:='seat allowed with a stale-txid claim';
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DT006' THEN v_st:='PASS'; v_d:='stale-txid claim did NOT match -> DT006';
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='unexpected '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F5', v_st, v_d);
END $$;

-- F6: claim cho e2 KHÔNG che được seat cho e3 (neo attendance_id) → DT006
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; BEGIN
  BEGIN
    INSERT INTO public.dealer_override_claims (table_id, dealer_id, attendance_id, txid)
    VALUES ('0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000d2','0d000000-0000-0000-0000-0000000000e2', pg_current_xact_id()::text::bigint);
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e3','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour');
    v_st:='FAIL'; v_d:='e2 claim covered a seat for e3';
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DT006' THEN v_st:='PASS'; v_d:='claim anchored on attendance_id - e2 claim did NOT cover e3 -> DT006';
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='unexpected '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F6', v_st, v_d);
END $$;

-- F7: single-use — một claim authorize đúng MỘT seat; seat thứ hai (sau release) → DT006
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; v_left int; BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.dealer_override_claims WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2') THEN
      v_st:='FAIL'; v_d:='pre: leftover claim for e2 (SAVEPOINT/inner-block isolation broken)';
      RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
    END IF;
    INSERT INTO public.dealer_override_claims (table_id, dealer_id, attendance_id, txid)
    VALUES ('0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000d2','0d000000-0000-0000-0000-0000000000e2', pg_current_xact_id()::text::bigint);
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour');  -- seat 1: consume
    SELECT count(*) INTO v_left FROM public.dealer_override_claims WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2';
    UPDATE public.dealer_assignments SET status='completed', released_at=now()
     WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2' AND table_id='0d000000-0000-0000-0000-0000000000a2' AND released_at IS NULL;
    BEGIN
      INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
      VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour');  -- seat 2
      v_st:='FAIL'; v_d:='second seat allowed (not single-use); left_after_first='||v_left;
    EXCEPTION WHEN sqlstate 'DT006' THEN
      IF v_left=0 THEN v_st:='PASS'; v_d:='claim consumed once (0 left) + second seat blocked DT006';
      ELSE v_st:='FAIL'; v_d:='second blocked but '||v_left||' claim left'; END IF;
    END;
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='unexpected '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F7', v_st, v_d);
END $$;

-- F8 (P0-1 vá — chống PASS-giả): cùng reserved→assigned promote chạy được khi switch OFF → bật ON → DT006.
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; v_id uuid; v_off_ok boolean:=false; BEGIN
  BEGIN
    UPDATE public.app_settings SET value='false'::jsonb WHERE key='dealer_feature_tables_enabled';
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','reserved', now(), now()+interval '1 hour') RETURNING id INTO v_id;
    UPDATE public.dealer_assignments SET status='assigned' WHERE id=v_id;
    v_off_ok:=true;
    DELETE FROM public.dealer_assignments WHERE id=v_id;
    UPDATE public.app_settings SET value='true'::jsonb WHERE key='dealer_feature_tables_enabled';
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','reserved', now(), now()+interval '1 hour') RETURNING id INTO v_id;
    UPDATE public.dealer_assignments SET status='assigned' WHERE id=v_id;  -- expect DT006
    v_st:='FAIL'; v_d:='non-pool reserved->assigned promote allowed under enforcement (expected DT006)';
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DT006' THEN
      IF v_off_ok THEN v_st:='PASS'; v_d:='identical promote succeeds with switch OFF (schema-valid) but DT006 with switch ON -> blocked PURELY by pool membership (BEFORE UPDATE)';
      ELSE v_st:='FAIL'; v_d:='DT006 before OFF control completed (control failed?)'; END IF;
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN
      IF v_off_ok THEN v_st:='FAIL'; v_d:='unexpected after control: '||SQLSTATE||' '||SQLERRM;
      ELSE v_st:='FAIL'; v_d:='NOT pool logic - reserved->assigned invalid with switch OFF: '||SQLSTATE||' '||SQLERRM; END IF;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F8', v_st, v_d);
END $$;

-- F9: race-restore completed→assigned (cùng attendance+table) → SKIP re-check → allowed
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; v_id uuid; BEGIN
  BEGIN
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e1','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour') RETURNING id INTO v_id;
    UPDATE public.dealer_assignments SET status='completed', released_at=now() WHERE id=v_id;
    UPDATE public.dealer_assignments SET status='assigned', released_at=NULL WHERE id=v_id;  -- race-restore
    v_st:='PASS'; v_d:='race-restore completed->assigned (same attendance+table) skipped re-check, allowed';
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='race-restore blocked: '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F9', v_st, v_d);
END $$;

-- F10 (DEFENSIVE / FUTURE-PATH — NOT the path assign produces; real path = F16):
--   FIRE-COUNT (đọc từ assign body): override-via-assign = STEP 7 INSERT status='assigned' trực tiếp →
--   trigger fire ĐÚNG 1 lần, consume tại INSERT-assigned. F10 test đường reserved→promote như coverage
--   phòng thủ (chứng minh trigger consume đúng NẾU một override-seat tương lai đi qua pre-assign).
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; v_id uuid; v_left int; BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.dealer_override_claims WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2') THEN
      v_st:='FAIL'; v_d:='pre: leftover claim for e2 (inner-block isolation broken)';
      RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
    END IF;
    INSERT INTO public.dealer_override_claims (table_id, dealer_id, attendance_id, txid)
    VALUES ('0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000d2','0d000000-0000-0000-0000-0000000000e2', pg_current_xact_id()::text::bigint);
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','reserved', now(), now()+interval '1 hour') RETURNING id INTO v_id;  -- skip, claim not consumed
    UPDATE public.dealer_assignments SET status='assigned' WHERE id=v_id;  -- promote: enforce, consume, allow
    SELECT count(*) INTO v_left FROM public.dealer_override_claims WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2';
    IF v_left=0 THEN v_st:='PASS'; v_d:='(defensive) claim survived reserved INSERT + consumed once at promote fire (0 left), not blocked mid-promote';
    ELSE v_st:='FAIL'; v_d:='promote allowed but '||v_left||' claim left'; END IF;
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='unexpected (override blocked mid-promote?): '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F10', v_st, v_d);
END $$;

-- F16 (P1-A — REAL override-via-assign path; the path production uses): assign override → STEP 7
--   INSERT status='assigned' → trigger fire 1 lần, consume tại đó. Single-use trên đúng đường đó.
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; r jsonb; v_left int; v_seat int; BEGIN
  BEGIN
    IF EXISTS (SELECT 1 FROM public.dealer_override_claims WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2') THEN
      v_st:='FAIL'; v_d:='pre: leftover claim for e2 (inner-block isolation broken)';
      RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
    END IF;
    r := public.assign_dealer_to_table(
      p_attendance_id => '0d000000-0000-0000-0000-0000000000e2',
      p_table_id      => '0d000000-0000-0000-0000-0000000000a2',
      p_override      => true, p_override_reason => 'dryrun real-path single-use',
      p_actor         => '2078287d-8692-4836-8783-425a64804e40', p_force_replace => true);
    SELECT count(*) INTO v_left FROM public.dealer_override_claims WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2';
    SELECT count(*) INTO v_seat FROM public.dealer_assignments
     WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2' AND table_id='0d000000-0000-0000-0000-0000000000a2' AND status='assigned' AND released_at IS NULL;
    IF coalesce(r->>'outcome','')<>'ok' OR v_seat<>1 OR v_left<>0 THEN
      v_st:='FAIL'; v_d:='real-path override outcome='||coalesce(r->>'outcome','?')||' seat='||v_seat||' claims_left='||v_left||' (expect ok/1/0 = 1 fire, consumed once)';
      RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
    END IF;
    UPDATE public.dealer_assignments SET status='completed', released_at=now()
     WHERE attendance_id='0d000000-0000-0000-0000-0000000000e2' AND table_id='0d000000-0000-0000-0000-0000000000a2' AND released_at IS NULL;
    UPDATE public.dealer_attendance SET current_state='available' WHERE id='0d000000-0000-0000-0000-0000000000e2';
    BEGIN
      INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
      VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour');  -- 2nd seat, no fresh claim
      v_st:='FAIL'; v_d:='second non-pool seat allowed after override claim consumed (single-use broken on real path)';
    EXCEPTION WHEN sqlstate 'DT006' THEN
      v_st:='PASS'; v_d:='real assign path: 1 enforced fire at INSERT-assigned, claim consumed once (0 left, seat=1); 2nd e2 seat (no fresh claim) -> DT006 -> single-use on the path production uses';
    END;
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='unexpected '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F16', v_st, v_d);
END $$;

-- F11 / F12 — 2-session concurrency, KHÔNG chạy được trong 1 tx → ghi MANUAL row + thủ tục.
INSERT INTO _dryrun_results(test,status,detail) VALUES
  ('F11','MANUAL','config-vs-promote race (2 sessions): A) BEGIN; promote a POOL seat on X (UPDATE ''assigned'') holds dealer_table_profiles FOR UPDATE; B) set_table_dealer_pool(X,...) waits on the lock; commit A -> B proceeds. Expect serialize, no deadlock, B does not mutate pool under A.'),
  ('F12','MANUAL','deadlock smoke (2 sessions): config-edit (set_table_dealer_pool on X) x seat (INSERT/UPDATE ''assigned'' on X) concurrently on the SAME table. Expect no deadlock (one waits on profile FOR UPDATE, both complete).');

-- F13: kill-switch OFF → enforcement inert (non-pool seat on special table ALLOWED)
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; BEGIN
  BEGIN
    UPDATE public.app_settings SET value='false'::jsonb WHERE key='dealer_feature_tables_enabled';
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e2','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now(), now()+interval '1 hour');
    v_st:='PASS'; v_d:='kill-switch OFF -> non-pool seat on special table ALLOWED (enforcement inert)';
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN sqlstate 'DT006' THEN v_st:='FAIL'; v_d:='switch OFF still blocked with DT006 (kill-switch not honored)';
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='FAIL'; v_d:='switch OFF still blocked: '||SQLSTATE||' '||SQLERRM;
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F13', v_st, v_d);
END $$;

-- F14: overload guard — đúng 1 proc assign_dealer_to_table (read-only, no inner-block needed)
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; v int; BEGIN
  SELECT count(*) INTO v FROM pg_proc WHERE proname='assign_dealer_to_table' AND pronamespace='public'::regnamespace;
  IF v=1 THEN v_st:='PASS'; v_d:='exactly 1 assign_dealer_to_table proc (overload guard)';
  ELSE v_st:='FAIL'; v_d:=v||' assign_dealer_to_table proc(s)'; END IF;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F14', v_st, v_d);
END $$;

-- F15a (no-REVOKE, DEFINITIVE): read grants directly — authenticated must keep INSERT/UPDATE/DELETE.
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; v_missing text; BEGIN
  SELECT string_agg(p, ',') INTO v_missing FROM (
    SELECT unnest(array['INSERT','UPDATE','DELETE']) AS p
    EXCEPT
    SELECT privilege_type FROM information_schema.role_table_grants
     WHERE table_schema='public' AND table_name='dealer_assignments' AND grantee='authenticated'
  ) m;
  IF v_missing IS NULL THEN v_st:='PASS'; v_d:='authenticated retains INSERT/UPDATE/DELETE on dealer_assignments (no REVOKE)';
  ELSE v_st:='FAIL'; v_d:='authenticated MISSING grant(s) on dealer_assignments: '||v_missing||' (a REVOKE leaked in)'; END IF;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F15a', v_st, v_d);
END $$;

-- F15b: release_dealer_from_table must exist (else the smoke proves nothing).
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; BEGIN
  IF EXISTS (SELECT 1 FROM pg_proc WHERE proname='release_dealer_from_table' AND pronamespace='public'::regnamespace)
    THEN v_st:='PASS'; v_d:='release_dealer_from_table exists';
    ELSE v_st:='FAIL'; v_d:='release_dealer_from_table does NOT exist (cannot smoke the INVOKER write path)'; END IF;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F15b', v_st, v_d);
END $$;

-- F15c: smoke — release_dealer_from_table (SECURITY INVOKER) RETURNS as authenticated → write grant intact.
--   PASS chỉ từ đường trả-về-thật. insufficient_privilege/undefined_function → FAIL. Khác → NOTE (không pass).
DO $$ DECLARE v_st text:='FAIL'; v_d text:=''; r jsonb; BEGIN
  BEGIN
    INSERT INTO public.dealer_assignments (attendance_id, table_id, club_id, status, assigned_at, swing_due_at, swing_processed_at)
    VALUES ('0d000000-0000-0000-0000-0000000000e1','0d000000-0000-0000-0000-0000000000a2','0d000000-0000-0000-0000-0000000000c1','assigned', now()-interval '2 hour', now()-interval '1 hour', NULL);
    SET LOCAL ROLE authenticated;
    r := public.release_dealer_from_table('0d000000-0000-0000-0000-0000000000a2');  -- p_released_by defaults NULL
    v_st:='PASS'; v_d:='release_dealer_from_table RETURNED as authenticated (INVOKER write grant intact, no-REVOKE) -> '||coalesce(r::text,'(void)');
    RAISE EXCEPTION 'self-rollback' USING errcode='DR000';
  EXCEPTION
    WHEN insufficient_privilege THEN v_st:='FAIL'; v_d:='PERMISSION-DENIED as authenticated (a REVOKE leaked in?)';
    WHEN undefined_function THEN v_st:='FAIL'; v_d:='undefined_function (name/signature mismatch) - smoke not proven';
    WHEN sqlstate 'DR000' THEN NULL;
    WHEN OTHERS THEN v_st:='NOTE'; v_d:='neutral (NOT a pass): RPC executed past grant but raised '||SQLSTATE||' '||SQLERRM||' - write grant likely intact, outcome not asserted';
  END;
  INSERT INTO _dryrun_results(test,status,detail) VALUES ('F15c', v_st, v_d);
END $$;

-- ════════════════════════════════ RESULTS ════════════════════════════════
-- Bảng kết quả (rows) — Management-API trả về cái này. Đọc cột status: PASS / FAIL / MANUAL / NOTE.
SELECT seq, test, status, detail FROM _dryrun_results ORDER BY seq;

-- ════════════════════════════════ END ════════════════════════════════
ROLLBACK;  -- OUTER: undo EVERYTHING (schema + fixtures + functests + results table). This is a dry-run.
