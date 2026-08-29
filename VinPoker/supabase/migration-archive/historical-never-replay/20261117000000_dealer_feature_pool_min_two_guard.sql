-- ════════════════════════════════════════════════════════════════════════════
-- 20261117000000_dealer_feature_pool_min_two_guard.sql
--
-- Patch 5c (P1) — feature/final pool MUST have >= 2 dealers (server backstop).
--
-- WHY: a special table (table_mode='feature' OR is_final) whose pool has exactly one
-- dealer is structurally impossible to relieve — the only pool member IS the seated
-- dealer, so the rotation can never swing them out (the pgv / Bàn 1 lockup, 2026-06-28).
-- Owner policy (2026-06-28): require >= 2 pool dealers for ALL special tables (feature
-- AND final); NO auto-fallback to a normal dealer. The dialog enforces this in the UI;
-- this RPC is the boundary that cannot be bypassed.
--
-- WHAT: redefine set_table_dealer_pool = the exact #546 (20261105000000) body + ONE
-- new guard after the member count is known: if the (already-locked) profile is special
-- and the new pool count < 2, RAISE errcode 'DT007' → the function aborts and its
-- DELETE/INSERT roll back atomically (no partial pool). New tables are unaffected: the
-- check only fires when the profile is ALREADY special (mode set first in saveProfileToDb),
-- and the dialog only sends a >= 2 pool for special tables. To shrink/clear a special
-- table's pool, flip it to normal first (then this guard does not apply).
--
-- DT registry: DT001 table-not-in-club · DT002 dealer-not-in-club · DT003 game_table
-- missing · DT004 dealer missing · DT005 invalid mode · DT006 dealer-not-in-pool (5a
-- trigger) · DT007 (NEW) special-table-pool-below-min.
--
-- SOURCE-ONLY: do NOT supabase db push / deploy_db. Controlled owner-gated apply only
-- (CREATE OR REPLACE is idempotent; schema_migrations untouched).
-- Rollback: re-apply the #546 body of set_table_dealer_pool from 20261105000000.
-- ════════════════════════════════════════════════════════════════════════════

create or replace function public.set_table_dealer_pool(p_table_id uuid, p_members jsonb)
returns jsonb
language plpgsql
volatile
security definer
set search_path = public
as $$
declare
  v_actor uuid := auth.uid();
  v_club uuid;
  v_old_count int;
  v_new_count int;
  v_is_special boolean;
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

  -- Patch 5c (P1) — special tables require >= 2 pool dealers. Read the (locked)
  -- profile state; if special and under the minimum, abort (rolls back the replace).
  select (table_mode = 'feature' or is_final = true)
    into v_is_special
  from public.dealer_table_profiles
  where table_id = p_table_id;

  if coalesce(v_is_special, false) and v_new_count < 2 then
    raise exception 'feature/final table requires at least 2 pool dealers (got %)', v_new_count
      using errcode = 'DT007';
  end if;

  insert into public.audit_logs (club_id, actor_id, action, entity_type, entity_id, payload)
  values (v_club, v_actor, 'set_table_dealer_pool', 'dealer_table_profile', p_table_id,
          jsonb_build_object('old_count', v_old_count, 'new_count', v_new_count, 'members', coalesce(p_members,'[]'::jsonb)));

  return jsonb_build_object('table_id', p_table_id, 'club_id', v_club, 'member_count', v_new_count);
end;
$$;
revoke all on function public.set_table_dealer_pool(uuid, jsonb) from public, anon;
grant execute on function public.set_table_dealer_pool(uuid, jsonb) to authenticated;
