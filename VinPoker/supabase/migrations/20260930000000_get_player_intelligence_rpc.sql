-- Player Intelligence — MVP 1.5 PR B: player-scoped READ RPC get_player_intelligence.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply later in a controlled
-- session (Management API / `supabase db query --linked --file`, NOT `db push`, NOT
-- deploy_db, NOT a schema_migrations write), then verify (security / grants / player-scope /
-- cross-player-denied / zero-writes) and regen types.ts.
--
-- Read-only / STABLE / zero writes / SECURITY DEFINER. Returns a SAFE JSONB DIGEST of the
-- AUTHENTICATED player's OWN verified poker profile, derived from LIVE tournament data — NOT
-- the stale public `player_stats` and NOT the manual `player_results` path.
--
-- Verified sample = the player's rows in `tournament_eliminations` (one per busted entry, with
-- an EXACT `position`, NOT NULL — the audit's `exact_live` source), joined to `tournaments`.
-- Field size per event = count(*) of `tournament_registrations status='confirmed'` (the
-- payment-backed canonical count, per get_club_series_events), falling back to the weaker
-- `tournaments.current_players` snapshot. ITM = `position <= tournaments.itm_places` (equivalent
-- to `tournament_leaderboard_view.is_itm` for finished entries; `prize` is deliberately NOT used
-- — the audit found live `eliminations.prize` is hardcoded 0). Final table is DERIVED (`position
-- <= 9`), never an exact marker. Each derived dimension reports a `sourceQuality` tier so the UI
-- never over-claims.
--
-- Known limitation (documented in PR #354): the tournament WINNER has no elimination row, so a
-- rare championship is not counted here. A later capture-gap fix records final standings.
--
-- Privacy: SECURITY DEFINER bypasses RLS, so scope is enforced EXPLICITLY below — a normal
-- authenticated user may only read their OWN auth.uid(); service_role may read any player for
-- diagnostics; anon/PUBLIC are revoked. Offline walk-in identities (synthetic player_id, not =
-- auth.uid()) are never reachable by a normal user and are not used for a cross-event profile.
--
-- "scenarioOutlook" is a SCENARIO / OUTLOOK digest only — NOT a prediction. Real numbers are
-- emitted only when unlocked (>=10 verified entries + adequate source quality).
--
-- Rollback: DROP FUNCTION IF EXISTS public.get_player_intelligence(uuid);

create or replace function public.get_player_intelligence(
  p_player_id uuid default auth.uid()
)
returns jsonb
language plpgsql
stable
security definer
set search_path = public
as $$
declare
  v_role     text := auth.role();
  v_caller   uuid := auth.uid();
  v_player   uuid := p_player_id;

  v_total        integer := 0;
  v_unique       integer := 0;
  v_reentries    integer := 0;
  v_last         timestamptz;
  v_itm_rate     numeric;
  v_ft_rate      numeric;
  v_top3_rate    numeric;
  v_avg_nf       numeric;
  v_recent_delta numeric;
  v_field_any      boolean := false;
  v_field_snapshot boolean := false;
  v_struct_any     boolean := false;
  v_best_buyin   text;
  v_best_field   text;
  v_best_struct  text;

  v_profile       text;
  v_confidence    text;
  v_recent_active boolean := false;
  v_sq_finish   text;
  v_sq_itm      text;
  v_sq_field    text;
  v_sq_struct   text;
  v_sq_identity text := 'online_authenticated';
  v_sq_adequate boolean;
  v_unlocked    boolean := false;
  v_reason      text;
  v_windows     jsonb;
begin
  -- ── Deny-by-default scope ────────────────────────────────────────────────
  -- A normal authenticated user may only read their OWN intelligence (auth.uid()).
  -- service_role may read any player for diagnostics. anon/PUBLIC execute is revoked below.
  if v_role is distinct from 'service_role' then
    if v_caller is null then
      v_player := null;                       -- unauthenticated → safe empty digest
    elsif v_player is null then
      v_player := v_caller;
    elsif v_player <> v_caller then
      raise exception 'forbidden: a player may only read their own intelligence'
        using errcode = '42501';
    end if;
  end if;

  if v_player is not null then
    with base as (
      select
        te.tournament_id,
        te.position,
        t.itm_places,
        t.buy_in,
        t.minutes_per_level,
        t.starting_stack,
        t.start_time,
        nullif(rc.cnt, 0)                                  as confirmed_cnt,
        coalesce(nullif(rc.cnt, 0), t.current_players)     as field_size
      from public.tournament_eliminations te
      join public.tournaments t on t.id = te.tournament_id
      left join lateral (
        select count(*) as cnt
        from public.tournament_registrations r
        where r.tournament_id = te.tournament_id
          and r.status = 'confirmed'
      ) rc on true
      where te.player_id = v_player
        and te.position is not null
        and t.deleted_at is null
    ),
    derived as (
      select
        b.*,
        (b.itm_places is not null and b.position <= b.itm_places) as is_itm,
        (b.position <= 9) as is_ft,
        (b.position <= 3) as is_top3,
        case when b.field_size > 1 and b.position is not null
             then greatest(0::numeric, least(1::numeric,
                    (b.field_size - b.position)::numeric / (b.field_size - 1)))
        end as nf,
        case
          when b.minutes_per_level is null and b.starting_stack is null then null
          when coalesce(b.minutes_per_level, 0) >= 20
            or (b.minutes_per_level is null and coalesce(b.starting_stack, 0) >= 30000) then 'deep'
          when (b.minutes_per_level is not null and b.minutes_per_level <= 12)
            or (b.minutes_per_level is null and coalesce(b.starting_stack, 0) <= 12000) then 'turbo'
          else 'standard'
        end as structure,
        -- Buy-in buckets are tunable (VND scale); refine when the band UX is built.
        case
          when b.buy_in is null then null
          when b.buy_in < 1000000 then '<1M'
          when b.buy_in < 2000000 then '1–2M'
          when b.buy_in < 5000000 then '2–5M'
          else '5M+'
        end as buyin_band,
        case
          when b.field_size is null then null
          when b.field_size < 50 then '<50'
          when b.field_size <= 150 then '50–150'
          else '150+'
        end as field_band
      from base b
    ),
    recent as (
      select nf from derived where nf is not null order by start_time desc nulls last limit 5
    )
    select
      count(*)::int,
      count(distinct tournament_id)::int,
      max(start_time),
      avg(case when is_itm  then 1 else 0 end)::numeric,
      avg(case when is_ft   then 1 else 0 end)::numeric,
      avg(case when is_top3 then 1 else 0 end)::numeric,
      avg(nf),
      bool_or(field_size is not null),
      bool_or(confirmed_cnt is null and field_size is not null),
      bool_or(structure is not null),
      (select buyin_band from derived where buyin_band is not null
         group by buyin_band having count(*) >= 2
         order by avg(nf) desc nulls last, count(*) desc limit 1),
      (select field_band from derived where field_band is not null
         group by field_band having count(*) >= 2
         order by avg(nf) desc nulls last, count(*) desc limit 1),
      (select structure from derived where structure is not null
         group by structure having count(*) >= 2
         order by avg(nf) desc nulls last, count(*) desc limit 1),
      case when count(*) >= 5
           then (select avg(nf) from recent) - avg(nf) end
    into
      v_total, v_unique, v_last, v_itm_rate, v_ft_rate, v_top3_rate, v_avg_nf,
      v_field_any, v_field_snapshot, v_struct_any,
      v_best_buyin, v_best_field, v_best_struct, v_recent_delta
    from derived;
  end if;

  v_total     := coalesce(v_total, 0);
  v_unique    := coalesce(v_unique, 0);
  v_reentries := greatest(v_total - v_unique, 0);
  v_recent_active := (v_last is not null and v_last >= (now() - interval '90 days'));

  -- ── source quality ───────────────────────────────────────────────────────
  v_sq_finish := case when v_total > 0 then 'exact_live' else 'missing' end;
  v_sq_itm    := case when v_total > 0 then 'itm_places' else 'unknown' end;
  v_sq_field  := case
                   when not coalesce(v_field_any, false)      then 'unknown'
                   when coalesce(v_field_snapshot, false)     then 'current_players_snapshot'
                   else 'confirmed_entries'
                 end;
  v_sq_struct := case when coalesce(v_struct_any, false) then 'configured' else 'unknown' end;

  -- Online (auth-joinable) vs offline walk-in (synthetic player_id, not in profiles).
  -- A normal caller is always their own auth.uid() (online); this matters for service_role diagnostics.
  if v_player is not null
     and not exists (select 1 from public.profiles p where p.user_id = v_player) then
    v_sq_identity := 'offline_ephemeral';
  end if;

  -- ── profile status / confidence ──────────────────────────────────────────
  v_profile := case
                 when v_total = 0 then 'new'
                 when v_total < 5 then 'provisional'
                 else 'verified'
               end;

  v_sq_adequate := (v_total > 0
                    and v_sq_finish = 'exact_live'
                    and v_sq_itm in ('leaderboard_view', 'itm_places')
                    and v_itm_rate is not null);

  v_confidence := case
                    when v_total >= 25 and v_recent_active and v_sq_adequate then 'high'
                    when v_total >= 10 and v_total <= 24 and v_sq_adequate    then 'medium'
                    else 'low'
                  end;

  -- ── scenario outlook gate (>=10 verified entries AND adequate source quality) ──
  v_unlocked := (v_total >= 10 and v_sq_adequate);
  v_reason   := case
                  when v_unlocked       then null
                  when v_total < 10     then 'not_enough_verified_entries'
                  else                       'low_source_quality'
                end;

  -- Scenario/outlook windows — real numbers only when unlocked. NOT a prediction.
  --   expectedItm        = N * itmRate
  --   chanceAtLeastOneItm = 1 - (1 - itmRate)^N
  v_windows := jsonb_build_array(
    jsonb_build_object('tournaments', 4,
      'expectedItm',         case when v_unlocked then round(4  * v_itm_rate, 2) end,
      'chanceAtLeastOneItm', case when v_unlocked then round(1 - power(1 - v_itm_rate, 4),  4) end),
    jsonb_build_object('tournaments', 8,
      'expectedItm',         case when v_unlocked then round(8  * v_itm_rate, 2) end,
      'chanceAtLeastOneItm', case when v_unlocked then round(1 - power(1 - v_itm_rate, 8),  4) end),
    jsonb_build_object('tournaments', 12,
      'expectedItm',         case when v_unlocked then round(12 * v_itm_rate, 2) end,
      'chanceAtLeastOneItm', case when v_unlocked then round(1 - power(1 - v_itm_rate, 12), 4) end)
  );

  return jsonb_build_object(
    'profileStatus', v_profile,
    'confidence',    v_confidence,
    'verifiedSample', jsonb_build_object(
      'totalEntries', v_total,
      'uniqueEvents', v_unique,
      'reentries',    v_reentries,
      'lastPlayedAt', v_last
    ),
    'results', jsonb_build_object(
      'itmRate',             round(v_itm_rate, 4),
      'finalTableRate',      round(v_ft_rate, 4),
      'top3Rate',            round(v_top3_rate, 4),
      'avgNormalizedFinish', round(v_avg_nf, 4),
      'recentFormDelta',     round(v_recent_delta, 4)
    ),
    'bands', jsonb_build_object(
      'bestBuyInBand',     v_best_buyin,
      'bestFieldSizeBand', v_best_field,
      'bestStructure',     v_best_struct
    ),
    'sourceQuality', jsonb_build_object(
      'finishPosition', v_sq_finish,
      'itm',            v_sq_itm,
      'finalTable',     'derived_position',
      'fieldSize',      v_sq_field,
      'structure',      v_sq_struct,
      'identity',       v_sq_identity
    ),
    'scenarioOutlook', jsonb_build_object(
      'unlocked',     v_unlocked,
      'reasonLocked', v_reason,
      'basedOn', jsonb_build_object(
        'verifiedEntries', v_total,
        'itmRate',         round(v_itm_rate, 4),
        'confidence',      v_confidence
      ),
      'windows', v_windows
    ),
    'locked', jsonb_build_object(
      'scenarioOutlook', not v_unlocked,
      'dreamLadder',     true
    )
  );
end;
$$;

-- Deny-by-default: no anon / PUBLIC execute; authenticated + service_role only.
revoke all on function public.get_player_intelligence(uuid) from public, anon;
grant execute on function public.get_player_intelligence(uuid) to authenticated, service_role;
