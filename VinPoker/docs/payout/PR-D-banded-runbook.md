# PR-D — Banded preset `LIVE_STANDARD` · controlled apply/deploy runbook

Source-only PR. **No DB apply, no manual Edge deploy, no live payout in the PR.** Owner-gated sequence
to take LIVE_STANDARD live for the existing `payoutEngine` allowlist club `22222222` ONLY. Apply AFTER
the CUSTOM migration `20261123000000` (this builds on the post-CUSTOM `prepare`/`apply`).

## Order (each step owner-gated)
1. **DB dry-run** — Management API `BEGIN … ROLLBACK`: prepend `20261124000000_payout_banded.sql`, run the
   asserts below (LIVE_STANDARD good + preset DAILY/INTL regression), ROLLBACK.
2. **DB apply** — owner phrase → `BEGIN … COMMIT` of `20261124000000` (ALTER CHECK +LIVE_STANDARD; `CREATE
   OR REPLACE prepare` (same 10-arg sig, CUSTOM intact); `CREATE OR REPLACE apply` (adds `v_is_banded`)). Do
   **not** write `schema_migrations`.
3. **Edge** — `compute-payouts` already redeploys on the PR merge (LIVE_STANDARD path dark; **merge-safe** —
   no new column, banded official reads the same frozen columns as presets). Re-confirm the deploy.
4. **Sandbox smoke** on a disposable tournament under club `22222222`: preview/official `LIVE_STANDARD` →
   exactly one applied run, Σ=pool, every 10+ band equal, last band > floor; preset close still works.
5. **Flip `FEATURES.payoutBandedMode = true`** (separate one-line PR) — LIVE_STANDARD appears only inside the
   existing `payoutEngine` allowlist (club `22222222`). **No allowlist widening.**

## Dry-run asserts (test 10: LIVE_STANDARD skips only LAST_NOT_FLOOR; preset regression) — BEGIN … ROLLBACK
```sql
BEGIN;
-- (20261124000000 prepended in the controlled dry-run)
-- fixture: disposable tournament + ~200 entries under :club_id ('22222222-…')  (so N≈19+ → banding)
--   then via the Edge/engine-computed banded rows (last band > floor):
--   1) prepare_payout_snapshot(itm,'LIVE_STANDARD',2,100000,…) succeeds (no BAD_ARCHETYPE); effective_floor>0;
--   2) apply_payout_run(<run>, <banded rows where last != floor>, pool, N, <floor>, …) SUCCEEDS
--      (LAST_NOT_FLOOR skipped) while FLOOR_MISMATCH / SUM_MISMATCH / contiguous / descending still bind;
--   3) a non-floor last row on a DAILY run still RAISES LAST_NOT_FLOOR (regression — preset path unchanged);
--   4) CUSTOM prepare/apply still behave exactly as 20261123 (CUSTOM not clobbered).
ROLLBACK;
```

## Rollback / kill-switch
- **Instant:** `FEATURES.payoutBandedMode = false` → LIVE_STANDARD hidden; backend never receives it.
- **Edge:** redeploy the prior `compute-payouts`.
- **DB:** restore the `20261123` `prepare`/`apply` bodies (CUSTOM, no LIVE_STANDARD); the widened CHECK is
  harmless to leave — narrow it only if no `LIVE_STANDARD` run exists.
