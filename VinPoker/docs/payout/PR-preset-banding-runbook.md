# Group payout (banding) as default for DAILY/MULTI/INTL/TRITON — controlled apply runbook

Owner-approved, **no feature flag** for the banding behavior itself (explicit choice — direct,
immediate change to live money math for every club). Source-only PR first; the DB migration and
Edge deploy are separate, owner-gated controlled steps below.

## What changes
- `computePayouts()` (`src/lib/payoutEngine.ts`, engine version bumped `engine3neo-v1` →
  `engine3neo-v1.1`) now groups ranks 10+ into equal-amount bands by default, for **every**
  archetype (DAILY/INTL/MULTI/TRITON) — using each archetype's **own** curve for ranks 1-9, not a
  hardcoded INTL base (the bug the old `LIVE_STANDARD`-only implementation had).
- `computeBandedPayouts()`/`LIVE_STANDARD` is simplified to a thin relabel of the same computation
  (single source of truth) — kept, not deleted, for the DB/Edge code path's backward compatibility
  and the one already-applied real `LIVE_STANDARD` close. **Hidden from the UI dropdown** (now
  redundant with banded `INTL`).
- **Real bug found and fixed during implementation**: the band-flooring step can undershoot the
  true min-cash floor by up to nearly one full rounding unit whenever `floor` isn't an exact
  multiple of `roundingUnit` (a common combination, e.g. floor=4.8M with a 1M unit — undershoot was
  measured at 800,000đ, ~17% below the promised floor, in the existing sweep-test parameter space).
  Fixed by clamping every band's floored amount to `Math.max(down(avg), floor)` — mathematically
  proven to preserve descending order and Σ=pool (see the function's doc comment). This fix also
  applies retroactively to the (already-shipped) `LIVE_STANDARD` path since it's now the same code.
- `apply_payout_run` (`supabase/migrations/20261127000000_preset_banding_default.sql`): the **only**
  SQL change — `v_is_banded` now also derives from `p_itm_places > 9` (any archetype), not just
  `archetype = 'LIVE_STANDARD'`, so `LAST_NOT_FLOOR` is correctly bypassed whenever banding
  actually applies. `FLOOR_MISMATCH`/`SUM_MISMATCH`/`POSITION_GAP_OR_DUP`/`NOT_MONOTONE` unchanged.
- No new archetype string, no schema/column change, no Edge Function (`compute-payouts/index.ts`)
  change needed — it already calls `computePayouts({archetype: run.archetype, ...})` for every
  preset, so the new behavior applies automatically once the shared engine + DB are updated.

## Order (each step owner-gated)
1. Merge the source-only PR. Behavior does **not** change yet — the live Edge/DB are untouched
   until steps 2-3 below (CI does not deploy `compute-payouts`, confirmed in prior sessions).
2. **DB dry-run** (`BEGIN … ROLLBACK`): apply `20261127000000` inside the transaction, then assert:
   - a DAILY/MULTI/INTL/TRITON close with `itm_places > 9` succeeds (no `LAST_NOT_FLOOR`);
   - a DAILY/MULTI/INTL/TRITON close with `itm_places` in 2..9 still RAISES `LAST_NOT_FLOOR` when
     the last rank isn't exactly the floor (regression — small fields unchanged);
   - `CUSTOM` and `LIVE_STANDARD` closes behave exactly as before (regression);
   - `FLOOR_MISMATCH`/`SUM_MISMATCH`/`POSITION_GAP_OR_DUP` still fire on bad input (regression).
3. **DB apply** (`BEGIN … COMMIT`) of `20261127000000` only. Do not write `schema_migrations`; no
   `db push`.
4. **Edge deploy** of `compute-payouts` (Management-API multipart, same method as prior sessions) —
   picks up the regenerated `_shared/payoutEngine.ts` mirror.
5. **Sandbox smoke** on a disposable fixture (club 22222222): close a DAILY tournament with N=19
   through the real Edge; verify bands 10-12/13-15/16-19 equal using DAILY's own (steeper) curve,
   Σ=pool, descending, cleanup clean. This is the concrete proof the fix generalizes beyond the old
   INTL-only `LIVE_STANDARD` hardcoding.
6. Report back. From this point, every new close with `itm_places > 9` for DAILY/MULTI/INTL/TRITON
   on **any** club uses the new banded math.

## Dry-run asserts (sketch) — BEGIN … ROLLBACK
```sql
BEGIN;
-- (20261127000000 prepended in the controlled dry-run)
-- 1) fixture: disposable tournament + ~19 paid entries under a real club_id, archetype DAILY;
--    prepare_payout_snapshot(itm=0.1, archetype='DAILY', ...) → draft run;
-- 2) apply_payout_run with a banded-shaped p_rows (ranks 10-12/13-15/16-19 equal, computed by the
--    updated TS engine) → SUCCEEDS (LAST_NOT_FLOOR skipped because p_itm_places=19 > 9);
-- 3) a small-field DAILY run (itm_places=5) with a non-floor last rank → still RAISES
--    LAST_NOT_FLOOR (regression — unchanged for N<=9);
-- 4) CUSTOM and LIVE_STANDARD prepare/apply still behave exactly as 20261126 (regression).
ROLLBACK;
```

## Rollback
No feature flag exists for this behavior (owner's explicit choice). To revert:
1. `git revert` this PR (restores the pre-v1.1 `computePayouts`/`computeBandedPayouts`).
2. Controlled `BEGIN…COMMIT` re-applying the prior `apply_payout_run` body (from
   `20261124000000_payout_banded.sql`, unchanged except this migration's one line).
3. Redeploy the prior `compute-payouts` Edge (regenerate `_shared/payoutEngine.ts` from the
   reverted `src/lib/payoutEngine.ts`).
Already-applied payout runs made under the new banded math during the window before rollback are
**not** retroactively changed — amounts already paid stay as paid, as the owner acknowledged.

## Verification done in this session
- `vitest` single-fork: 76/76 green across the full payout suite, including the new
  `payoutEngine.presetBanding.test.ts` (proves DAILY/MULTI/TRITON band using their OWN curve, not a
  hardcoded INTL base) and the floor-clamp regression test.
- `tsc -b` clean (see report).
- `deno check` on the (unchanged) Edge entrypoint (see report).
- Mandatory `game-engine-auditor` read-only pass on the full diff (see report) — this touches live
  money math for every club.
