# Runbook — Series Theory Patch v2 (capture-column pre-provision)

**Migration:** `VinPoker/supabase/migrations/20261231000000_series_theory_patch_v2.sql`
**Dry-run:** `VinPoker/supabase/migrations/_dryrun_series_theory_patch_v2.sql`
**Status:** SOURCE-ONLY — committed but **NOT applied**. Apply only via this runbook, in a controlled owner session.

---

## What it does

Adds five additive capture columns to two **existing** Series-Intelligence tables (four nullable; `is_shadow`
is `NOT NULL DEFAULT false`). No new table, no RLS change (columns inherit each table's existing owner-scoped
RLS), no Edge, no trigger, no model/calculation.

| # | Table | Columns added | Notes |
|---|-------|---------------|-------|
| TP5 | `series_forecast_snapshots` | `rival_major_event_same_day boolean`, `rival_gtd bigint` | Pre-event owner context; `rival_gtd >= 0` (`sfs_rival_gtd_chk`). |
| TP6 | `series_forecast_snapshots` | `capacity integer` | Pre-event owner input (seat capacity); `capacity >= 0` (`sfs_capacity_chk`). |
| TP6 | `series_decision_logs` | `hit_capacity boolean` | Post-event owner outcome ("did it reach capacity"), set via the owner `UPDATE` path. |
| TP9 | `series_decision_logs` | `is_shadow boolean NOT NULL DEFAULT false` | Marks a shadow (dry-run) decision; existing rows backfill to `false`. |

> **Targeting note (review fix):** `capacity`/`hit_capacity` do **not** go on `series_event_actuals`. That
> table is system-write-only (authenticated `SELECT` only), and its autosync writer is not modified here and
> has no seat-capacity source — a column there would strand `NULL`. They live on the owner-writable
> snapshot/decision tables instead. **Codex's TP6 UI must target these tables.**

**Leakage rule (locked):** `rival_*` / `capacity` / `hit_capacity` are context/actuals for scoring and
known-before framing — **never** fed back as forecast model inputs. `is_shadow` is bookkeeping only.

**Reversible:** each column is dropped cleanly (its inline CHECK drops with it). See the ROLLBACK block at the
foot of the migration.

---

## Safety (non-negotiable)

- **Prerequisite:** `series_capture_v0` (20261125000000) must already be applied (it is LIVE) — it creates
  both target tables (`series_forecast_snapshots`, `series_decision_logs`). This migration only `ALTER`s them.
- **Never** `supabase db push`, `supabase db reset`, `supabase migration up`, or `deploy_db=true`. Apply with
  the Management API / `supabase db query --linked --file` only. `schema_migrations` is not touched.
- Proceed only on the explicit owner phrase: **"Proceed apply series theory patch v2"**.

---

## Steps

### 1. Dry-run self-test (proves it before touching anything)
```
supabase db query --linked --file VinPoker/supabase/migrations/_dryrun_series_theory_patch_v2.sql
```
- Read the returned matrix — **every** row (`T1..T8`) must say `PASS`.
- The script applies the body inside a transaction and `ROLLBACK`s; nothing persists.
- **Safety re-check** (paste after the dry-run): the 5 columns must be **gone** (proves ROLLBACK held):
```
SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
  AND ((table_name='series_forecast_snapshots' AND column_name IN ('rival_major_event_same_day','rival_gtd','capacity'))
    OR (table_name='series_decision_logs'      AND column_name IN ('hit_capacity','is_shadow')));   -- MUST be 0
```
If this returns non-zero, your client did **not** honor ROLLBACK — STOP and report.

### 2. Apply (controlled, only after step 1 is all-PASS + owner phrase)
```
supabase db query --linked --file VinPoker/supabase/migrations/20261231000000_series_theory_patch_v2.sql
```

### 3. Verify (post-apply — columns now persist)
```
SELECT count(*) FROM information_schema.columns WHERE table_schema='public'
  AND ((table_name='series_forecast_snapshots' AND column_name IN ('rival_major_event_same_day','rival_gtd','capacity'))
    OR (table_name='series_decision_logs'      AND column_name IN ('hit_capacity','is_shadow')));   -- MUST be 5
```
Spot-check `is_shadow` backfilled to `false`:
```
SELECT bool_and(is_shadow = false) AS all_false FROM public.series_decision_logs;   -- true (or NULL if empty)
```

### 4. Regen types (separate step)
Regenerate `src/integrations/supabase/types.ts` so the new columns are typed. This is a code change (own PR),
independent of the DDL.

### 5. Flip the feature flags — **only after the matching Codex UI PRs merge**
These columns are written/read by the theory-patch-v2 UI increments **TP5 / TP6 / TP9 (Codex-owned)**. Do **not**
flip anything from this migration. After each Codex UI PR merges *and* this migration is applied + types
regenerated, flip that increment's flag (each is default-OFF, per the one-flag-per-PR rule). Until then the new
columns simply sit empty — no behavior change.

---

## Rollback
If needed, run the ROLLBACK block from the foot of the migration (drops the 5 columns; their CHECKs drop with
them). Safe because every column is additive and nothing else references them.
