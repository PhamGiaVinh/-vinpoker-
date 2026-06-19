-- Club Intelligence — Phase 3a: GTD (guarantee) shared column + SI read path.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply later in a controlled
-- session (Management API / `supabase db query --linked --file`, NOT `db push` / not
-- deploy_db), then verify (column present + nullable; RPC returns guarantee_amount as gtd;
-- security/grants/owner-scope/cross-club-denied unchanged) and regen types.ts.
--
-- What this does (per docs/club-intelligence/GTD_TWO_PART_SPEC.md, Option 1):
--   1. Adds a nullable `tournaments.guarantee_amount numeric` = the COMMITTED guarantee
--      (the real cam kết). NULL means "no GTD yet" — readiness/risk still report it MISSING;
--      GTD is NEVER faked/inferred from prize_pool.
--   2. CREATE OR REPLACE `get_club_series_events` to return `t.guarantee_amount as gtd`
--      (was `null::numeric`). The function SIGNATURE is unchanged (same params + same return
--      columns/types), so this is a safe in-place replace.
--
-- Scope guard: NO Floor write UI here (the floor committed-GTD input is Phase 3b). NO overlay
-- compute here (that is Phase 3c, and only a "stored prize-pool comparison" until prize_pool
-- real-time is confirmed). NO profit/expected/forecast/overlay/prediction output columns.
--
-- Idempotent: ADD COLUMN IF NOT EXISTS + CREATE OR REPLACE + idempotent revoke/grant, so a
-- future gated `db push` is a safe no-op if already applied.

-- 1) Shared committed-guarantee column (nullable, no default → NULL stays "missing").
alter table public.tournaments
  add column if not exists guarantee_amount numeric;

comment on column public.tournaments.guarantee_amount is
  'Committed tournament guarantee (GTD), VND. Nullable: NULL = no GTD set (reported as missing, never faked from prize_pool). Set by floor/owner at setup (Phase 3b write path). Club Intelligence reads it via get_club_series_events.';

-- 2) Update the Series Intelligence read RPC to return the real GTD.
--    Body identical to 20260927000000 except the `gtd` projection.
create or replace function public.get_club_series_events(
  p_club_id uuid default null,
  p_from timestamptz default null,
  p_to timestamptz default null
)
returns table (
  event_id uuid,
  event_name text,
  event_date timestamptz,
  buy_in numeric,
  fee numeric,
  service_fee numeric,
  gtd numeric,
  prize_pool_actual numeric,
  total_entries bigint,
  unique_entries bigint,
  reentries bigint,
  club_id uuid
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id                          as event_id,
    t.name                        as event_name,
    t.start_time                  as event_date,
    t.buy_in::numeric             as buy_in,
    t.rake_amount::numeric        as fee,
    t.service_fee_amount::numeric as service_fee,
    t.guarantee_amount::numeric   as gtd,
    t.prize_pool::numeric         as prize_pool_actual,
    coalesce(r.total_entries, 0)  as total_entries,
    coalesce(r.unique_entries, 0) as unique_entries,
    coalesce(r.total_entries, 0) - coalesce(r.unique_entries, 0) as reentries,
    t.club_id
  from public.tournaments t
  left join lateral (
    select
      count(*)                     as total_entries,
      count(distinct tr.player_id) as unique_entries
    from public.tournament_registrations tr
    where tr.tournament_id = t.id
      and tr.status = 'confirmed'
  ) r on true
  where t.deleted_at is null
    -- owner-scope: caller owns the club (or is super_admin via the proven helper)
    and (
      public.has_role(auth.uid(), 'super_admin'::public.app_role)
      or exists (
        select 1 from public.clubs c
        where c.id = t.club_id
          and c.owner_id = auth.uid()
      )
    )
    -- optional club filter (still ownership-validated by the clause above)
    and (p_club_id is null or t.club_id = p_club_id)
    -- date window on the event date; p_from inclusive, p_to exclusive
    -- (tournaments with a NULL start_time are excluded only when a window is given)
    and (p_from is null or t.start_time >= p_from)
    and (p_to   is null or t.start_time <  p_to)
  order by t.start_time desc nulls last;
$$;

revoke all on function public.get_club_series_events(uuid, timestamptz, timestamptz) from public, anon;
grant execute on function public.get_club_series_events(uuid, timestamptz, timestamptz) to authenticated;
