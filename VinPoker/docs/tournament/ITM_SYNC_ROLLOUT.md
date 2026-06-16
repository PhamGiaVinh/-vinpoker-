# Tournament ITM sync — `itm_places ← MAX(tournament_prizes.position)`

**Source-only PR.** No payroll/finance change. Live apply is **owner-gated** (controlled Management-API op). NO `supabase db push`, NO `deploy_db=true`, `schema_migrations` untouched.

## Why
`tournaments.itm_places` is the "places paid" value read by `get_tournament_leaderboard` (`is_itm`), the TV ITM display, and the tracker bubble/ITM story events (#245). Today **nothing writes it** — it defaults to `0`/NULL and is never synced from the Floor-Ops prize structure (`tournament_prizes`), so ITM is unreliable everywhere. This makes the prize structure the single source of truth: `itm_places = MAX(position)` (robust to non-contiguous positions, e.g. `1,2,4,5 → 5`).

## Two independently-verifiable parts
1. **Structural (migration `20260915000000`)** — an additive `AFTER INSERT/UPDATE/DELETE` trigger on `tournament_prizes`. Applying it **changes no existing row**; it only corrects `itm_places` on FUTURE prize edits.
2. **Data (guarded backfill, below)** — a one-time `UPDATE` that corrects existing tournaments, gated behind a **leaderboard golden diff**.

## Scope guard
Touches only `itm_places` + the new trigger/function. **Not** in scope: `calculate_dealer_payroll`, payroll/finance, prize amounts/percentages, Dealer Swing, Cashier. `itm_places` is not consumed by any money calc (verified) → **no payroll/financial value changes**. The only behavior change is intended: leaderboard/TV/tracker start reflecting real ITM.

---

## Controlled apply plan (owner-gated)

```
Operation name:  apply_tournament_itm_sync_trigger  (+ backfill_tournament_itm_places)
Level:           3 (controlled production patch)
Target ref:      <owner SUPABASE_PROJECT_REF>
Read/write:      WRITE (additive trigger DDL; backfill = data UPDATE on itm_places only)
Won't do:        supabase db push · deploy_db=true · edit schema_migrations · touch
                 get_tournament_leaderboard / payroll / prize amounts
Rollback:        docs/emergency_rollbacks/PRE_ITM_SYNC_20260915000000.sql
```

### STEP 1 — Preflight (read-only)
```sql
-- P1 slot unregistered (controlled op does NOT touch schema_migrations)
select count(*) from supabase_migrations.schema_migrations where version='20260915000000'; -- 0
-- P2 trigger + function ABSENT (expect 0 each)
select count(*) from pg_trigger where tgrelid='public.tournament_prizes'::regclass
  and tgname='trg_sync_tournament_itm_places' and not tgisinternal;
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='sync_tournament_itm_places';
-- P3 leaderboard RPC md5 BASELINE (must stay unchanged — we never touch it)
select md5(pg_get_functiondef('public.get_tournament_leaderboard(uuid)'::regprocedure)) as leaderboard_md5;
-- P4 SNAPSHOT the rows the backfill will change (for rollback + golden diff)
select t.id, t.itm_places as before_itm,
  (select max(position) from public.tournament_prizes p where p.tournament_id=t.id) as prize_max
from public.tournaments t
where exists (select 1 from public.tournament_prizes p where p.tournament_id=t.id)
order by t.id;
```

### STEP 2 — Dry-run the trigger migration (validate, persist nothing)
```sql
BEGIN;
\i supabase/migrations/20260915000000_sync_tournament_itm_places.sql
ROLLBACK;   -- expect: no errors
```

### STEP 3 — Apply the trigger (single txn; NOT db push)
```sql
BEGIN;
\i supabase/migrations/20260915000000_sync_tournament_itm_places.sql
COMMIT;
```
Do NOT insert into `schema_migrations` (keeps it unchanged per the controlled-op model).

### STEP 4 — Verify the trigger (read-only)
```sql
select count(*) from pg_trigger where tgrelid='public.tournament_prizes'::regclass
  and tgname='trg_sync_tournament_itm_places' and not tgisinternal;          -- V1 expect 1
select count(*) from pg_proc p join pg_namespace n on n.oid=p.pronamespace
  where n.nspname='public' and p.proname='sync_tournament_itm_places';        -- V2 expect 1
select md5(pg_get_functiondef('public.get_tournament_leaderboard(uuid)'::regprocedure));
                                                                              -- V3 == P3 (unchanged)
```
Optional functional smoke (on a TEST tournament): re-save its prize structure → confirm
`tournaments.itm_places` becomes `MAX(position)`; delete all prizes → becomes 0.

### STEP 5 — Guarded BACKFILL with leaderboard golden diff (existing tournaments)
Pick a sample tournament `<TID>` that has prizes.
```sql
-- BEFORE (golden diff): is_itm should be all FALSE (itm_places still 0)
select jsonb_path_query_array((get_tournament_leaderboard('<TID>'::uuid))->'players', '$[*].is_itm');

BEGIN;
UPDATE public.tournaments t
SET itm_places = sub.maxpos
FROM (SELECT tournament_id, MAX(position) AS maxpos
      FROM public.tournament_prizes GROUP BY tournament_id) sub
WHERE t.id = sub.tournament_id
  AND COALESCE(t.itm_places,0) IS DISTINCT FROM sub.maxpos;   -- only changed rows

-- AFTER (still inside txn): is_itm now TRUE for paid positions; prize amounts UNCHANGED
select jsonb_path_query_array((get_tournament_leaderboard('<TID>'::uuid))->'players', '$[*].is_itm');
select (get_tournament_leaderboard('<TID>'::uuid))->'prize_pool';  -- unchanged vs before

COMMIT;   -- ONLY if the diff is correct; otherwise ROLLBACK;
```
Golden-diff pass = `is_itm` flips false→correct, `prize_pool`/amounts unchanged, no payroll value moved.

### Rollback
```sql
DROP TRIGGER IF EXISTS trg_sync_tournament_itm_places ON public.tournament_prizes;
DROP FUNCTION IF EXISTS public.sync_tournament_itm_places();
-- to revert backfilled values, restore from the P4 snapshot:
-- UPDATE public.tournaments SET itm_places = <before_itm> WHERE id = <id>;  (per snapshot row)
```

### Required final report
```
schema_migrations changed: NO   deploy_db=true used: NO   supabase db push used: NO
pending migrations applied: NO (only this trigger's DDL + the guarded backfill)
get_tournament_leaderboard md5: unchanged   payroll/finance value change: NONE
secrets exposed: NO
```

## Blocked on owner (to apply)
1. Explicit approval (e.g. "Apply tournament ITM sync").
2. Supabase credentials via secure channel (`SUPABASE_DB_URL` or `SUPABASE_ACCESS_TOKEN`+`PROJECT_REF`).
3. After apply: regenerate `types.ts` only if any signature changed (it doesn't here — trigger/function add nothing to the public API surface read by the client).
