-- Series Intelligence — Phase 2 PR A: owner-scoped READ RPC for the native event payload.
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply later in a controlled
-- session (Management API / `supabase db query --linked --file`, NOT `db push` / not
-- deploy_db), then verify (security/grants/owner-scope/cross-club-denied) and regen types.ts.
--
-- Read-only / STABLE / zero writes / SECURITY DEFINER. Returns one row per tournament with
-- the Series Intelligence event shape and SERVER-DERIVED entry counts from the AUTHORITATIVE
-- `tournament_registrations` table (the payment-backed cashier record; status TEXT):
--   total_entries  = count(*) of confirmed registrations
--   unique_entries = count(distinct player_id) of confirmed registrations
--   reentries      = total_entries - unique_entries
-- Audited canonical rule: include only status = 'confirmed' (excludes pending/rejected/
-- cancelled/void). `stack_registrations` (offline walk-in queue) and `tournament_entries`
-- (seating/play record) are deliberately NOT used for counting.
--
-- Fee semantics (owner-decided, keep separate): fee = rake_amount, service_fee =
-- service_fee_amount — NOT summed. Per-registration platform_fixed_fee is intentionally
-- NOT mixed into the event-level fee.
--
-- gtd is returned as NULL here (no `tournaments.guarantee_amount` column yet); a later PR B
-- adds that nullable column and updates this function to return it. GTD is never faked.
--
-- NO profit / expected / forecast / overlay / causal / prediction output columns.
-- Security: RLS is bypassed inside a SECURITY DEFINER function, so ownership is enforced
-- explicitly below (clubs.owner_id = auth.uid(), or super_admin via the existing public.has_role).

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
    null::numeric                 as gtd,
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
