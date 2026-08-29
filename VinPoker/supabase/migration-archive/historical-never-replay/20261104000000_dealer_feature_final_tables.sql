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
