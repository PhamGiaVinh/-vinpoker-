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
