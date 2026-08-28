-- GTD #2 — server-authoritative TRUE prize pool (READ-ONLY RPC).
--
-- SOURCE-ONLY migration. NOT applied live in this PR. Apply later in a controlled session
-- (Management API / `supabase db query --linked --file`, NOT `db push` / not deploy_db),
-- then verify (security/grants/owner-scope) and regen types.ts in a separate step.
--
-- Returns the TRUE prize pool of one tournament = COALESCE(SUM(buy_in), 0) over CONFIRMED
-- registrations. `status = 'confirmed'` = cashier-verified payment: both the online flow
-- (confirm_registration_and_assign_seat sets status='confirmed', confirmed_by=cashier) and
-- the offline buy-in flow insert a 'confirmed' row with the real `buy_in` + confirmed_by.
-- `buy_in` is the prize contribution per entry (rake_amount / service_fee_amount are SEPARATE
-- fees, not the prize pool). Re-entries are separate confirmed rows, each adding its buy_in.
-- Also returns `confirmed_entry_count` so the client can pick the true-vs-estimate state.
--
-- READ-ONLY: SELECT/SUM only — NO INSERT/UPDATE/DELETE, NO new column, NO trigger. It does
-- NOT read or write `tournaments.prize_pool` (that stored column stays untouched/unused).
-- Owner-scoped, SECURITY DEFINER (RLS is bypassed in a SECURITY DEFINER body, so ownership is
-- enforced explicitly below — same pattern as get_club_series_events). Idempotent.

create or replace function public.get_tournament_prize_pool(p_tournament_id uuid)
returns table (
  tournament_id uuid,
  prize_pool numeric,           -- SUM(buy_in) of confirmed registrations (true / thực thu)
  confirmed_entry_count bigint  -- number of confirmed (cashier-paid) registrations
)
language sql
stable
security definer
set search_path = public
as $$
  select
    t.id                                         as tournament_id,
    coalesce(r.prize_pool, 0)::numeric           as prize_pool,
    coalesce(r.confirmed_entry_count, 0)::bigint as confirmed_entry_count
  from public.tournaments t
  left join lateral (
    select
      sum(tr.buy_in) as prize_pool,
      count(*)       as confirmed_entry_count
    from public.tournament_registrations tr
    where tr.tournament_id = t.id
      and tr.status = 'confirmed'
  ) r on true
  where t.id = p_tournament_id
    and t.deleted_at is null
    -- owner-scope: caller owns the club (or is super_admin via the proven helper)
    and (
      public.has_role(auth.uid(), 'super_admin'::public.app_role)
      or exists (
        select 1 from public.clubs c
        where c.id = t.club_id
          and c.owner_id = auth.uid()
      )
    );
$$;

revoke all on function public.get_tournament_prize_pool(uuid) from public, anon;
grant execute on function public.get_tournament_prize_pool(uuid) to authenticated;
