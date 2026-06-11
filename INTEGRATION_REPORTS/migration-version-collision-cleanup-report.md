# Migration Version Collision Cleanup Report

**Branch:** `chore/migration-version-collision-cleanup`  
**Date:** 2026-06-11  
**Stage:** 3I  
**Status:** Repo-only. No Supabase commands run. No DB writes.

---

## Duplicate Versions Found (Stage 3H audit)

Four version collisions identified in Stage 3H that would cause `supabase db push` to fail
with a duplicate-version error before any migration is executed:

| Version | File A (kept) | File B (resolved) |
|---|---|---|
| `20260605` | `20260605_diagnostic_logs.sql` | `20260605_idx_assignments_due_swing.sql` |
| `20260617000000` | `20260617000000_realtime_hand_tracking.sql` | `20260617000000_batch_swing_duration.sql` |
| `20260801000000` | `20260801000000_pre_assign_cleanup_infrastructure.sql` | `20260801000000_dealer_payroll_soft_delete.sql` |
| `20260801000004` | `20260801000004_fix_missing_columns.sql` | `20260801000004_rollback_pre_assign_cleanup.sql` |

---

## Changes Applied

### 1. `20260605` collision — rename + CONCURRENTLY removal

**Before:** `supabase/migrations/20260605_idx_assignments_due_swing.sql`  
**After:** `supabase/migrations/20260605000001_idx_assignments_due_swing.sql`

Content change: `CREATE INDEX CONCURRENTLY IF NOT EXISTS` → `CREATE INDEX IF NOT EXISTS`

**Why `20260605000001`:** The version `20260605` is already matched to `20260605_diagnostic_logs.sql`
(the remote `schema_migrations` table has `20260605` applied, which was created by the diagnostic
logs migration via Supabase Dashboard). The index migration needed a unique version that sorts
immediately after `20260605` in lexicographic order.

**Why remove `CONCURRENTLY`:** `CREATE INDEX CONCURRENTLY` cannot run inside a transaction block.
Supabase migration runner wraps each migration in a transaction. Running with `CONCURRENTLY` would
cause an error: `ERROR: CREATE INDEX CONCURRENTLY cannot run inside a transaction block`. The index
definition, predicate, and name are preserved exactly; only the keyword is removed.

---

### 2. `20260617000000` collision — rename + CREATE OR REPLACE

**Before:** `supabase/migrations/20260617000000_batch_swing_duration.sql`  
**After:** `supabase/migrations/20260617000001_batch_swing_duration.sql`

Content change: `CREATE FUNCTION perform_swing(` → `CREATE OR REPLACE FUNCTION perform_swing(`

**Why `20260617000001`:** The version `20260617000000` is already matched to
`20260617000000_realtime_hand_tracking.sql` (Stage 3G audit: this version is recorded in remote
`schema_migrations` as applied, and its content matches the hand-tracking migration). The batch
swing duration migration must run after hand tracking in any fresh build, so `20260617000001`
is the correct slot.

**Why `CREATE OR REPLACE`:** The original `CREATE FUNCTION` (without `OR REPLACE`) is not idempotent.
If `perform_swing` already exists with the same signature (e.g., from a previous migration),
re-running this migration would fail with `ERROR: function already exists with same argument types`.
The `DROP FUNCTION IF EXISTS perform_swing(UUID, INT, UUID, BOOLEAN, INT, INT)` immediately before
handles the 6-parameter variant, but if the 7-parameter variant already exists (e.g., from a
prior run of this very migration), the `CREATE FUNCTION` would still fail. Adding `OR REPLACE`
makes the migration safe to re-run. Function body is unchanged.

---

### 3. `20260801000000` collision — rename

**Before:** `supabase/migrations/20260801000000_dealer_payroll_soft_delete.sql`  
**After:** `supabase/migrations/20260724000001_dealer_payroll_soft_delete.sql`

No content changes.

**Why `20260724000001`:** The payroll soft-delete migration was authored/applied around 2026-07-24
based on its content (payroll soft-delete is a July feature). The collision version `20260801000000`
was assigned after the fact. `20260724000001` places it immediately after
`20260724000000_payroll_reject_flow.sql` which already exists in the migration chain, reflecting
the actual development chronology. The `20260801000000` slot is left to
`20260801000000_pre_assign_cleanup_infrastructure.sql` which is its correct owner.

---

### 4. `20260801000004` collision — move out of migrations

**Before:** `supabase/migrations/20260801000004_rollback_pre_assign_cleanup.sql`  
**After:** `docs/emergency_rollbacks/20260801000004_rollback_pre_assign_cleanup.sql`

No content changes.

**Why moved out:** This is an emergency rollback script — it is meant to be run manually by an
operator in a crisis, not automatically applied by the migration runner. Keeping it in
`supabase/migrations/` makes the runner attempt to apply it as a normal migration, which would
conflict with `20260801000004_fix_missing_columns.sql` (same version). The
`docs/emergency_rollbacks/` directory is the correct location for DBA runbooks that must never
be auto-executed. The `20260801000004` version slot is left to `20260801000004_fix_missing_columns.sql`.

---

## Confirmations

| Check | Result |
|---|---|
| `20260808000000_tracker_realtime_publication.sql` absent | ✓ Not present on this branch or `origin/main` |
| No DB command run | ✓ |
| No `supabase migration repair` | ✓ |
| No `supabase db push` | ✓ |
| No workflow edit | ✓ |
| D4a not executed | ✓ |
| D5e not executed | ✓ |
| PR #9 remains Draft | ✓ |
| Milestone B blocked | ✓ |

---

## Out-of-Scope Collisions Found (not fixed in Stage 3I)

Five additional version collisions exist on `origin/main` that were not in the Stage 3H audit
scope. These require separate decisions before Stage 3J/D4a:

| Version | File A | File B |
|---|---|---|
| `20260607000000` | `20260607000000_payroll_fixes.sql` | `20260607000000_suggest_swing_config.sql` |
| `20260608000000` | `20260608000000_attendance_no_overlap_constraint.sql` | `20260608000000_cleanup_test_data.sql` |
| `20260608000001` | `20260608000001_soft_min_rest.sql` | `20260608000001_tournament_live_tracker.sql` |
| `20260608000002` | `20260608000002_short_notice_ot_bonus.sql` | `20260608000002_tournament_hand_tracking.sql` |
| `20260609000000` | `20260609000000_create_pit_function.sql` | `20260609000000_meal_break_feature.sql` |

These collisions will also cause `supabase db push` to fail. A Stage 3I-follow-up pass is needed
with explicit keep/retimestamp decisions for each pair before D4a can be approved.

---

## Next Required Step

After this PR is merged or rebased into the recovery branch:

```
supabase migration list --linked
```

(read-only) — to confirm `20260605` now matches `20260605_diagnostic_logs.sql` correctly and no
new remote-only mismatches were introduced. This read-only check requires no DB writes and is
safe to run at any time.
