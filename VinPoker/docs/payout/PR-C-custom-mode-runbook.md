# PR-C — Native CUSTOM payout mode · controlled apply/deploy runbook

Source-only PR. **No DB apply, no Edge deploy, no live payout action in the PR.** This runbook is the
owner-gated sequence to take CUSTOM live for the existing `payoutEngine` allowlist club `22222222`
ONLY. Tests 6–9 below run here (they need a DB/Edge), not in the source PR.

## Order (each step owner-gated)
1. **Controlled DB dry-run** — Management API `BEGIN … ROLLBACK`: prepend `20261123000000_payout_custom_mode.sql`,
   then the assertions in *Dry-run SQL* below (CUSTOM good/bad + preset DAILY regression). Verify, ROLLBACK.
2. **Controlled DB apply** — owner phrase → `BEGIN … COMMIT` of `20261123000000_payout_custom_mode.sql`
   (ALTER CHECK + ADD `custom_percents` + DROP/recreate `prepare_payout_snapshot` + replace `apply_payout_run`
   + REVOKE/GRANT + old-overload verification). Do **not** write `schema_migrations`.
3. **Edge deploy** — redeploy `compute-payouts` (CUSTOM preview + official path) via the multipart deploy API.
4. **Sandbox smoke** (tests 8–9) on a disposable tournament under club `22222222`; clean up.
5. **Flip `FEATURES.payoutCustomMode = true`** (separate one-line PR) — CUSTOM appears only inside the
   existing `payoutEngine` allowlist (club `22222222`). **No allowlist widening.**

## Dry-run SQL (test 6 CUSTOM good/bad · test 7 preset regression) — BEGIN … ROLLBACK
```sql
BEGIN;
-- (the migration 20261123000000 is prepended here in the controlled dry-run)

-- fixture: disposable tournament + 10 entries under a test club  (:club_id = '22222222-…')
WITH t AS (
  INSERT INTO public.tournaments (club_id,name,start_time,buy_in,starting_stack,rake_amount)
  VALUES (:club_id,'PRC dryrun',now(),1000000,20000,200000) RETURNING id
), e AS (
  INSERT INTO public.tournament_entries (tournament_id,player_id,entry_no,status)
  SELECT t.id, gen_random_uuid(), gs, 'registered' FROM t, generate_series(1,10) gs RETURNING 1
) SELECT id AS tour FROM t \gset

-- 6a CUSTOM good: prepare freezes percents (no BAD_ARCHETYPE), archetype=CUSTOM, effective_floor=0
SELECT (public.prepare_payout_snapshot(:'tour',0.15,'CUSTOM',2,100000,NULL,NULL,false,NULL,
        '[{"position":1,"percent_bp":5000},{"position":2,"percent_bp":3000},{"position":3,"percent_bp":2000}]'::jsonb)->>'run_id') AS run \gset
-- apply with the engine-computed amounts (pool 10M → 5M/3M/2M); CUSTOM branch skips LAST_NOT_FLOOR
SELECT public.apply_payout_run(:'run',
  '[{"position":1,"amount":5000000},{"position":2,"amount":3000000},{"position":3,"amount":2000000}]'::jsonb,
  10000000, 3, 0, '[]'::jsonb, 'custom3neo-v1', NULL);
-- ASSERT: 3 prize rows, archetype=CUSTOM applied, custom_percents frozen
SELECT count(*) FROM public.tournament_prizes WHERE tournament_id=:'tour';                 -- expect 3
SELECT archetype, source, custom_percents IS NOT NULL FROM public.tournament_payout_runs
  WHERE tournament_id=:'tour' AND status='applied';                                        -- CUSTOM/close/t

-- 6b CUSTOM bad: Σ bp ≠ 10000 → CUSTOM_BP_SUM (wrap in a sub-block to capture the RAISE)
DO $$ BEGIN
  PERFORM public.prepare_payout_snapshot(:'tour',0.15,'CUSTOM',2,100000,NULL,NULL,true,'x',
    '[{"position":1,"percent_bp":5000},{"position":2,"percent_bp":4000}]'::jsonb);
  RAISE EXCEPTION 'EXPECTED_CUSTOM_BP_SUM_NOT_RAISED';
EXCEPTION WHEN OTHERS THEN
  IF SQLERRM NOT LIKE '%CUSTOM_BP_SUM%' THEN RAISE; END IF;
END $$;

-- 7 preset regression: a DAILY close still enforces the min-cash floor (LAST_NOT_FLOOR)
--   prepare DAILY → apply with a LAST ≠ floor must still RAISE LAST_NOT_FLOOR (unchanged behaviour).
ROLLBACK;
```

## Sandbox smoke (test 8 preview no-persist · test 9 one applied CUSTOM run)
Disposable tournament under club `22222222`, real cashier JWT (same pattern as the PR-2b smoke):
- **8** — `compute-payouts` preview `{archetype:"CUSTOM", custom_percents:[…]}` → `estimated:true`, rows from the
  engine, **DB unchanged** (no `registration_closed_at`, no prizes/runs).
- **9** — `prepare_payout_snapshot(CUSTOM, custom_percents)` → `compute-payouts` official(run_id) → **exactly one**
  applied run `archetype=CUSTOM source=close`, prizes Σ=pool, `custom_percents` frozen, NO superseded throwaway.
- unauthorized → `NOT_AUTHORIZED`; manual edit after CUSTOM → `save_tournament_prizes_v2` still works. Clean up.

## Rollback / kill-switch
- **Instant:** `FEATURES.payoutCustomMode=false` → CUSTOM hidden, backend path never invoked.
- **Edge:** redeploy the prior archetype-only `compute-payouts`.
- **DB:** restore `20261120000000`'s `prepare`/`apply` bodies; the `custom_percents` column + widened CHECK are
  harmless to leave (narrow the CHECK only if no CUSTOM run exists).
