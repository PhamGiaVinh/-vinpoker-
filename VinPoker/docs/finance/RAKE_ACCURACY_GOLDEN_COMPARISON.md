# Finance Rake Accuracy — Golden / Sample Comparison

Companion to `supabase/migrations/20260905000000_finance_summary_rake_accuracy.sql` (source-only
revision of `get_club_finance_summary`) + the `useClubFinanceSummary` hook + `ClubFinanceDashboard`
+ `FeeRevenueDashboard` changes. **No DB applied. No behavior change to registration / cashier /
staking / payroll.** This doc shows the exact taxonomy and how to verify before/after on the live DB.

## Revenue taxonomy (final)

```
TOURNAMENT  (one stream — kept separate from staking)
  rake (= rakeExpected, HEADLINE)  = Σ rake_amount × paying confirmed entries
                                     per tour, split by source (reference_code prefix):
    ├─ rakeOnline   rake_amount × GREATEST(0, n_online − free_rake_used)
    ├─ rakeOffline  rake_amount × n_offline
    └─ rakeReentry  rake_amount × n_reentry
    (rake_amount is a single configured price per tour, same for online & offline)
  rakeActual    = Σ GREATEST(0, tournament_registrations.total_pay − buy_in)
                  WHERE status='confirmed'   ← RECONCILIATION only (real money in)
  rakeVariance  = rakeActual − rake (configured)

STAKING  (separate stream — never mixed into rake)
  stakingFees   = stakingFixed + stakingPercent + stakingArchive
    ├─ stakingFixed    staking_deals.platform_fixed_fee   (on check-in)
    ├─ stakingPercent  staking_deals.platform_percent_fee (on check-in)
    └─ stakingArchive  staking_deals.platform_archive_fee (completed w/ prize, capped at prize)
  payoutFees    = payout_recipients.platform_fee_vnd  (payout / ITM / cash-out)

total = rake (configured) + stakingFees + payoutFees
net   = total − SAVED dealer payroll (never recomputed)
EXCLUDED: tournament buy-in (prize-pool pass-through), staking capital/escrow, cashier cash,
          bankroll_entries.rake, F&B.
```

### Why configured rake_amount × count is the headline
Tournament rake is a **single fixed price per tour** set at setup (`tournaments.rake_amount`),
identical for online and offline entries. The owner's intended revenue is `rake_amount × paying
confirmed entries`. `rakeActual` (Σ total_pay − buy_in) is carried for reconciliation only — it
surfaces any gap between what was charged and the configured price.

### Why `total_pay − buy_in` and NOT `platform_fixed_fee` for rakeActual
The online register edge function (`supabase/functions/tournament-register/index.ts`) stores
`platform_fixed_fee = 0` and folds the rake into `total_pay` (`total_pay = buy_in + rake`).
Offline buy-in / re-entry store the fee in `platform_fixed_fee`, but for them `total_pay − buy_in`
equals that same fee. So `total_pay − buy_in` is the **one** definition correct for all three
sources. Summing `platform_fixed_fee` (the naive definition) would report **0 rake for every
online entry** — see the example below.

## Worked example (illustrative)

**Tournament "Friday NLH"** — `rake_amount = 200,000`, free-rake disabled, 10 confirmed entries:

| Source | Count | Configured rake (rake_amount × n) | Per-entry actual (total_pay − buy_in) | platform_fixed_fee |
|---|---:|---:|---:|---:|
| Online (`VINReg…`)  | 7 | 1,400,000 | 200,000 | **0** |
| Offline (`CASH-%`)  | 2 |   400,000 | 250,000 | 250,000 |
| Re-entry (`REENTRY-%`) | 1 | 200,000 | 200,000 | 200,000 |
| **Total** | 10 | **2,000,000** | | |

- `rake` (headline, configured) = 200,000 × 10 = **2,000,000**
- split: `rakeOnline` 1,400,000 · `rakeOffline` 400,000 · `rakeReentry` 200,000
- `rakeActual` (reconciliation) = 7×200k + 2×250k + 1×200k = **2,100,000**  → `rakeVariance` = **+100,000** (offline charged above rake_amount)
- ❌ naive `Σ platform_fixed_fee` = 0×7 + 250k×2 + 200k = **700,000** — undercounts online to 0 (this is why we don't use it)

**Staking (same period)** — 5 checked-in deals (fixed 50k, percent 20k each), 2 completed-with-prize (archive 199k), payouts 80k:

| Bucket | Value |
|---|---:|
| stakingFixed | 250,000 |
| stakingPercent | 100,000 |
| stakingArchive | 398,000 |
| payoutFees | 80,000 |

- Owner Finance staking (always included percent) = 250k + 100k + 398k = **748,000** (+ payout 80k separately)
- FeeRevenueDashboard **before** (omitted percent) = 250k + 398k = **648,000**  ← the G3 discrepancy
- FeeRevenueDashboard **after** (this PR, includes percent) = **748,000** ← now matches Owner Finance

## Verify on the live DB (READ-ONLY — owner runs in SQL Editor; replace dates/club as needed)

### A) Tournament rake — estimated vs actual + source split (per tournament)
```sql
with regs as (
  select tr.tournament_id, tr.reference_code,
         greatest(0, coalesce(tr.total_pay,0) - coalesce(tr.buy_in,0)) as rake_actual
  from public.tournament_registrations tr
  join public.tournaments t on t.id = tr.tournament_id
  where tr.status = 'confirmed'
    and t.created_at between '2026-06-01' and '2026-06-30'   -- window
    -- and t.club_id = '<CLUB_UUID>'                          -- optional club filter
)
select t.id, t.name,
  coalesce(t.rake_amount,0) * greatest(0, count(r.*) filter (where true)
    - case when t.free_rake_enabled then coalesce(t.free_rake_used,0) else 0 end) as rake_expected,
  coalesce(sum(r.rake_actual),0)                                                   as rake_actual,
  coalesce(sum(r.rake_actual),0)
    - coalesce(t.rake_amount,0) * greatest(0, count(r.*)
        - case when t.free_rake_enabled then coalesce(t.free_rake_used,0) else 0 end) as rake_variance,
  coalesce(sum(r.rake_actual) filter (where r.reference_code not like 'CASH-%'
                                         and r.reference_code not like 'REENTRY-%'),0) as rake_online,
  coalesce(sum(r.rake_actual) filter (where r.reference_code like 'CASH-%'),0)        as rake_offline,
  coalesce(sum(r.rake_actual) filter (where r.reference_code like 'REENTRY-%'),0)     as rake_reentry
from public.tournaments t
left join regs r on r.tournament_id = t.id
where t.created_at between '2026-06-01' and '2026-06-30'
group by t.id, t.name, t.rake_amount, t.free_rake_enabled, t.free_rake_used
order by rake_actual desc;
```

### B) Staking fee split (fixed / percent / archive / payout)
```sql
select
  coalesce(sum(case when d.player_checked_in and coalesce(d.platform_fixed_fee,0)>0   then d.platform_fixed_fee   else 0 end),0) as staking_fixed,
  coalesce(sum(case when d.player_checked_in and coalesce(d.platform_percent_fee,0)>0 then d.platform_percent_fee else 0 end),0) as staking_percent,
  coalesce(sum(case when d.status='completed' and coalesce(d.result_prize_vnd,0)>0
                    then least(coalesce(d.platform_archive_fee,199000), d.result_prize_vnd) else 0 end),0)                       as staking_archive
from public.staking_deals d
where d.created_at between '2026-06-01' and '2026-06-30';   -- and d.club_id = '<CLUB_UUID>'

select coalesce(sum(coalesce(pr.platform_fee_vnd,0)),0) as payout_fees
from public.payout_recipients pr
join public.staking_deals d on d.id = pr.deal_id
where pr.created_at between '2026-06-01' and '2026-06-30'; -- and d.club_id = '<CLUB_UUID>'
```

### C) Reconcile against the live RPC (still the OLD body until v2 is applied)
```sql
-- Until 20260905000000 is applied, this returns the OLD shape (revenue.rake = estimate, no splits).
-- After apply, revenue gains rakeActual/Expected/Variance/Online/Offline/Reentry + staking split.
select get_club_finance_summary('2026-06-01'::timestamptz, '2026-06-30'::timestamptz, null);
```

## Risks / ambiguities
- **Source classification is reference_code-prefix based** (`VINReg…` online, `CASH-%` offline,
  `REENTRY-%` re-entry). These prefixes are set deterministically by the writers
  (`tournament-register` edge fn, `create_offline_buyin_and_seat`, `reenter_tournament_player`).
  Any registration created by another/legacy path with a different prefix falls into the **online**
  bucket (the catch-all). `rakeActual` total is unaffected by classification — only the split is.
- **`tournament_entries.source` is NOT used for the split**: `reenter_tournament_player` preserves the
  original entry source, so an entry's `source` can be 'online' even for a re-entry. The
  `reference_code` prefix is the reliable re-entry signal. (Source column remains correct for the
  *original* entry; it's just not the re-entry discriminator.)
- **Headline**: `revenue.rake`, `revenue.total` and `net` use `rake_amount × paying entries`
  (configured), which matches what the owner set at tour creation. `rakeActual` (Σ total_pay − buy_in)
  and `rakeVariance` are reconciliation fields — they surface any gap between charged and configured.
- **Time attribution** unchanged: rake is attributed to the **tournament's** `created_at` month
  (consistent with the prior estimate), not the registration's `committed_at`.
- **Voided / cancelled registrations** (`status<>'confirmed'`) are excluded — consistent with the
  void feature (a voided entry drops out of both count and actual sum).
- **Free-rake online entries**: `total_pay = buy_in` → `rake_actual = 0` (rake waived), which is
  correct; `rakeExpected` subtracts `free_rake_used`, so both sides handle free entries.
- **Graceful degradation**: the hook's `normRevenue` defaults the new fields (rakeActual/Expected→
  legacy `rake`, splits→0, stakingFixed→lumped `stakingFees`) so the dashboard renders correctly
  against the OLD live RPC; rollback is therefore safe.

## Controlled apply (owner-gated — NOT done here)
1. Preflight: `select pg_get_functiondef('public.get_club_finance_summary(timestamptz,timestamptz,uuid)'::regprocedure);` (capture current body for rollback).
2. Apply `20260905000000_finance_summary_rake_accuracy.sql` via Management API `CREATE OR REPLACE`.
3. Verify: `SECURITY DEFINER` + `search_path=public` + `EXECUTE` = authenticated only (anon/PUBLIC revoked); run query (C) and confirm the new fields appear and `rakeActual + stakingFees + payoutFees = total`.
4. Idempotency rerun (apply twice → same body).
5. Rollback: `CREATE OR REPLACE` back to the captured 20260826000000 body (hook tolerates missing fields).
- NO `supabase db push`, NO `deploy_db=true`, NO `schema_migrations` edit, NO data writes.
