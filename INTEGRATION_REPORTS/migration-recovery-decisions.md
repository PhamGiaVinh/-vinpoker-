# Migration Recovery — Preflight Decisions

**Date:** 2026-06-11  
**Branch:** `chore/migration-recovery-preflight`  
**Status:** Repo-only preflight complete. No DB commands run. No workflow edited. No baseline migration created.

---

## Decision Log

### D3a — Baseline Inclusion List: Approved (plan only)

The following remote-only objects are approved for inclusion in the future baseline migration. The baseline migration file itself has **not been created yet** (pending D5e approval).

**Tables (all require `CREATE TABLE IF NOT EXISTS`):**
- `club_trackers` — composite PK `(club_id, user_id)`, RLS enabled, 5 policies; CRITICAL (RLS dependency for all tracker tables)
- `tournament_hand_audit_log` — 8 columns, action CHECK constraint, trigger writes to it from `tournament_hands`; CRITICAL (trigger dependency)
- `payroll_calculation_log` — 4 columns, FK to `dealer_payroll`; MEDIUM

**Functions (all require `CREATE OR REPLACE FUNCTION`):**
- `is_club_tracker(_user_id uuid, _club_id uuid)` — CRITICAL (RLS USING on tracker tables; 2 params)
- `tracker_club_ids(_user_id uuid)` — CRITICAL (RLS USING on tracker tables)
- `audit_tournament_hand()` — CRITICAL (trigger function; called by `trg_audit_tournament_hand` on `tournament_hands`)
- `get_escalation_config(p_club_id uuid)` — HIGH (called in `perform_swing` core path)
- `reconcile_ghost_assignments(p_club_id uuid)` — HIGH (cron job every 15 min)
- `club_local_date(p_club_id uuid)` — MEDIUM
- `tournament_break_all_tables(p_tournament_id uuid)` — MEDIUM
- `reconcile_dealer_states(p_club_id uuid)` — MEDIUM
- `release_dealer_from_table(p_table_id uuid)` — MEDIUM
- `get_swing_metrics(p_club_id uuid)` — MEDIUM
- `force_release_stuck_assignment(p_assignment_id, p_club_id, p_reason)` — MEDIUM
- `cleanup_old_diagnostic_logs()` — LOW
- `disable_stale_audit_flags(p_stale_after_hours)` — LOW (add after `pass1b_circuit_breaker` applied)
- `enable_audit_for_stuck_rows(p_club_id, p_min_overdue_min)` — LOW (add after `pass1b_circuit_breaker` applied)
- `rls_auto_enable()` + event trigger — LOW (event trigger function; needs companion `CREATE EVENT TRIGGER`)

**Dependency order for baseline:** `club_trackers` → `is_club_tracker` + `tracker_club_ids` → `tournament_hand_audit_log` → `audit_tournament_hand` → `payroll_calculation_log` → remaining functions → event trigger.

**What D3a does NOT authorize:**
- Creating the baseline migration file (blocked pending D5e)
- Applying anything to any DB
- Editing the CI workflow

---

### D3b — `20260610000002` Placeholder UUID Update: Removed from migration

**File modified:** `VinPoker/supabase/migrations/20260610000002_revert_keep_last_released_at_set_pre_announce_3min.sql`

**What was removed:** The trailing block:
```sql
-- 3. Set pre_announce_minutes = 3 for club 22222
UPDATE swing_config
SET pre_announce_minutes = 3
WHERE club_id = '22222222-2222-2222-2222-222222222222'
  AND pre_announce_minutes != 3;
```

**Why:** `'22222222-2222-2222-2222-222222222222'` is an all-twos placeholder UUID, almost certainly a dev template value never updated with the real club ID. Auto-applying this UPDATE would be a silent no-op (if no row matches) or would misconfigure the wrong club. The function replacements (`end_expired_breaks`, `transition_dealer_state`) in the same file are legitimate and remain.

**What replaced it:** A comment explaining the removal (D3b decision, 2026-06-11) with instructions for manual application if the real club_id is identified later.

**What was NOT done:**
- No manual `UPDATE swing_config` was run
- No DB command of any kind was run
- The correct club_id has not been determined — decision deferred

---

### D3c — `20260725000001` CONCURRENTLY Fix: Applied

**File modified:** `VinPoker/supabase/migrations/20260725000001_pass1b_circuit_breaker.sql`

**What was changed (Part 2 section, outside BEGIN/COMMIT):**

Before:
```sql
DROP INDEX CONCURRENTLY IF EXISTS idx_dealer_assignments_pass1b_stale;
CREATE INDEX CONCURRENTLY idx_dealer_assignments_pass1b_stale ...
```

After:
```sql
DROP INDEX IF EXISTS idx_dealer_assignments_pass1b_stale;
CREATE INDEX IF NOT EXISTS idx_dealer_assignments_pass1b_stale ...
```

**Why:** `CONCURRENTLY` is forbidden inside a transaction block. Supabase's migration runner wraps every migration file in an outer transaction regardless of the file's own `BEGIN`/`COMMIT`. Both `DROP INDEX CONCURRENTLY` and `CREATE INDEX CONCURRENTLY` would fail with "cannot run inside a transaction block". The `IF NOT EXISTS` / `IF EXISTS` guards preserve idempotency. The functional result (index creation with the correct definition) is unchanged.

**What was NOT changed:** All other content of the file is unchanged. The table creation (`club_processing_locks`), column additions, three function definitions (`try_acquire_club_lock`, `release_club_lock`, `cleanup_expired_club_locks`), cron scheduling, and GRANTs are untouched. The non-CONCURRENTLY index inside the transaction (`idx_club_processing_locks_expires`) was already correct and was not modified.

---

### D3d — `20260609000002_recalculate_june_payroll`: Permanent Repair-Revert Decision

**Migration:** `20260609000002_recalculate_june_payroll.sql`  
**Decision:** Permanent `repair --status reverted`. Never auto-apply in CI.

**What the migration does:**
- Creates a backup table `dealer_payroll_backup_before_june_recalc`
- Recomputes BHXH (8%), BHYT (1.5%), BHTN (1%), PIT (progressive bracket) for all June 2026 dealer payroll rows
- Issues `UPDATE dealer_payroll SET bhxh_deduction_vnd, bhyt_deduction_vnd, bhtn_deduction_vnd, pit_deduction_vnd, net_pay_after_tax_vnd, net_pay_vnd` for all affected rows
- Writes audit records with `changed_by = '6c320d89-0de3-4ad1-9238-3ca475b006cf'` (hardcoded user UUID)

**Why permanent skip:**
- Financial data mutation affecting insurance and tax deductions for all June 2026 payroll records
- Must have explicit business stakeholder sign-off before any application
- Hardcoded `changed_by` UUID ties audit records to a specific user who may not be appropriate for all environments
- Once applied incorrectly it is difficult to reverse (backup table exists but manual restore would be required)
- This is a one-time correction operation, not a repeatable schema migration

**What this decision does NOT yet authorize:**
- The CI workflow has NOT been edited (D4a not approved)
- `supabase migration repair` has NOT been run
- The migration file itself has NOT been modified (no edit needed for a repair-revert — only the CI command needs to be updated, pending D4a)

**When D4a is approved**, the CI repair command will add: `supabase migration repair --status reverted 20260609000002`

---

## Pending Decisions

| ID | Decision | Blocks |
|---|---|---|
| **D4a** | Add 99 remote-only versions + `20260609000002` to CI repair command | Stage 3, Step 3 |
| **D5e** | Approve actual baseline migration file creation | Stage 3, Step 2 |

### D4a: Not Approved
The CI workflow (`.github/workflows/vbackerworkflowmain.yml`) has **not been edited**. The 99 remote-only migration versions have **not been added** to the repair list. `20260609000002` has **not been added** to the repair list. These are blocked pending explicit D4a approval.

### Milestone B: Blocked
Milestone B (live tracker audit log, input hardening, etc.) remains blocked. No Milestone B work has been done in this branch or any other.

---

## What This Branch Contains

This branch (`chore/migration-recovery-preflight`) contains exactly 3 file changes from `origin/main`:

| File | Change |
|---|---|
| `VinPoker/supabase/migrations/20260610000002_revert_keep_last_released_at_set_pre_announce_3min.sql` | Removed placeholder UUID config UPDATE block (D3b) |
| `VinPoker/supabase/migrations/20260725000001_pass1b_circuit_breaker.sql` | Removed `CONCURRENTLY` from both index operations (D3c) |
| `INTEGRATION_REPORTS/migration-recovery-decisions.md` | This file (new) |

**No other files changed.** No DB commands were run. No workflow was edited. No baseline migration was created.

---

## Next Steps (all require explicit approval)

1. **D4a** — Approve CI workflow edit: add 99 repair-reverted versions + `20260609000002` + baseline `--status applied`
2. **D5e** — Approve baseline migration file creation (`20260611000001_remote_only_schema_baseline.sql`)
3. **Stage 3 / Step 4** — Test push on remote dev DB (after steps 1–3 complete)
4. **Stage 7** — Reintroduce Milestone A from `feature/live-tracker-realtime-a-clean` after pipeline confirmed healthy
