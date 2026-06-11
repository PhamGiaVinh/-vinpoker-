# Remote Schema Baseline — Draft Review

**Migration file:** `VinPoker/supabase/migrations/20260611000001_remote_only_schema_baseline.sql`  
**Status:** DRAFT — not applied to any DB  
**Created:** 2026-06-11  
**Source metadata:** `D:\vinpoker-prod-audit-20260611-051112\`

---

## Why This Migration Must Not Be Applied Yet

1. **D4a not approved.** The 99 remote-only migration versions have not been added to the CI repair list. Until they are, `supabase db push` will refuse to run because it sees those versions in `schema_migrations` but finds no local file for them.

2. **Baseline must be marked `--status applied` on remote dev DB before push.** All objects in this file already exist on the remote dev DB. If this migration runs without being pre-marked as applied, it will attempt to re-create them. `CREATE TABLE IF NOT EXISTS` and `CREATE OR REPLACE FUNCTION` are safe, but RLS policies wrapped in `duplicate_object` guards will silently skip — the trigger recreation (`DROP TRIGGER IF EXISTS` + `CREATE TRIGGER`) is idempotent. However, pushing this migration before marking it applied means the migration runner will try to "apply" it on an already-populated DB, which wastes a migration slot and risks partial failures on FK constraint re-additions.

3. **Migration ordering relative to `pass1b_circuit_breaker.sql`.** `force_release_stuck_assignment()` and the deferred `disable_stale_audit_flags()` / `enable_audit_for_stuck_rows()` reference `dealer_assignments.should_audit_version`. That column is added by `20260725000001_pass1b_circuit_breaker.sql`. This baseline must apply before or at the same time as that migration on a fresh build. On the remote dev DB both already exist.

4. **Permanent skip: `20260609000002_recalculate_june_payroll.sql`.** This migration recalculates all June 2026 dealer payroll records. It must be added to the CI repair list as `--status reverted` (D3d decision, 2026-06-11). It is NOT included in this baseline and must never be auto-applied. See `migration-recovery-decisions.md`.

---

## Objects Included

### Tables

| Table | Source | Criticality | Notes |
|---|---|---|---|
| `club_trackers` | `11_columns.json`, `13_constraints_simple.json`, `06_indexes.json`, `03_rls_policies.json` | CRITICAL | Composite PK `(club_id, user_id)` — no surrogate id |
| `tournament_hand_audit_log` | `11_columns.json`, `13_constraints_simple.json`, `06_indexes.json`, `03_rls_policies.json` | CRITICAL | action CHECK constraint with 6 allowed values |
| `payroll_calculation_log` | `11_columns.json`, `13_constraints_simple.json`, `03_rls_policies.json` | MEDIUM | 4 columns; no index on payroll_id (pre-existing gap) |

### Indexes

| Index | Table | Source |
|---|---|---|
| `idx_club_trackers_club` | `club_trackers` | `06_indexes.json` |
| `idx_club_trackers_user` | `club_trackers` | `06_indexes.json` |
| `idx_hand_audit_log_hand_id` | `tournament_hand_audit_log` | `06_indexes.json` |
| `idx_hand_audit_log_created_at` | `tournament_hand_audit_log` | `06_indexes.json` |

### Functions

| Function | Source | Criticality | Params |
|---|---|---|---|
| `is_club_tracker` | `19_function_definitions.json` | CRITICAL | `(_user_id uuid, _club_id uuid)` — 2 params |
| `tracker_club_ids` | `19_function_definitions.json` | CRITICAL | `(_user_id uuid)` |
| `audit_tournament_hand` | `19_function_definitions.json` | CRITICAL | `()` trigger function |
| `get_escalation_config` | `19_function_definitions.json` | HIGH | `(p_club_id uuid)` |
| `reconcile_ghost_assignments` | `19_function_definitions.json` | HIGH | `(p_club_id uuid DEFAULT NULL)` |
| `club_local_date` | `19_function_definitions.json` | MEDIUM | `(p_club_id uuid)` |
| `tournament_break_all_tables` | `19_function_definitions.json` | MEDIUM | `(p_club_id uuid, p_duration_minutes int DEFAULT 20, p_reason text DEFAULT 'tournament_break')` |
| `reconcile_dealer_states` | `19_function_definitions.json` | MEDIUM | `(p_club_id uuid)` |
| `release_dealer_from_table` | `19_function_definitions.json` | MEDIUM | `(p_table_id uuid, p_released_by uuid DEFAULT NULL)` |
| `get_swing_metrics` | `19_function_definitions.json` | MEDIUM | `()` — no p_club_id, global snapshot |
| `force_release_stuck_assignment` | `19_function_definitions.json` | MEDIUM | `(p_assignment_id uuid, p_club_id uuid, p_reason text DEFAULT 'force_release_overdue')` |
| `cleanup_old_diagnostic_logs` | `19_function_definitions.json` | LOW | `()` |
| `rls_auto_enable` | `19_function_definitions.json` | LOW | `()` event trigger function |

### RLS Policies

| Policy | Table | Cmd | Source |
|---|---|---|---|
| `club_trackers_select_self` | `club_trackers` | SELECT | `03_rls_policies.json` |
| `club_trackers_select_club_owner` | `club_trackers` | SELECT | `03_rls_policies.json` |
| `club_trackers_select_super` | `club_trackers` | SELECT | `03_rls_policies.json` |
| `club_trackers_insert_super_owner` | `club_trackers` | INSERT | `03_rls_policies.json` |
| `club_trackers_delete_super_owner` | `club_trackers` | DELETE | `03_rls_policies.json` |
| `Hand audit log insertable by authenticated users` | `tournament_hand_audit_log` | INSERT | `03_rls_policies.json` |
| `Hand audit log selectable by admins` | `tournament_hand_audit_log` | SELECT | `03_rls_policies.json` |
| `Club members can view calc log` | `payroll_calculation_log` | SELECT | `03_rls_policies.json` |
| `Service role full access calc log` | `payroll_calculation_log` | ALL | `03_rls_policies.json` |

### Triggers

| Trigger | On Table | Timing | Events | Function | Source |
|---|---|---|---|---|---|
| `trg_audit_tournament_hand` | `tournament_hands` | AFTER | INSERT OR UPDATE | `audit_tournament_hand()` | `20_trigger_definitions.json` |

### Event Trigger

| Event Trigger | On | Function |
|---|---|---|
| `rls_auto_enable_trigger` | `ddl_command_end` | `rls_auto_enable()` |

---

## Objects Intentionally Excluded

| Object | Reason |
|---|---|
| `disable_stale_audit_flags()` | Runtime dependency on `dealer_assignments.should_audit_version` (added by `pass1b_circuit_breaker.sql`, a pending local migration). Function creates fine but fails at runtime. Deferred until `pass1b_circuit_breaker` is confirmed applied. |
| `enable_audit_for_stuck_rows()` | Same dependency as above. |
| `dealer_state_health` (view) | Full view DDL not reconstructable without `pg_dump` (Docker banned). Monitoring-only; no functional app dependency. |
| `ghost_assignments_health` (view) | Same as above. |
| `v_stuck_assignment_version_history` (view) | Same as above. |
| `20260609000002_recalculate_june_payroll.sql` | **Permanent repair-revert** (D3d). One-time financial data mutation. Must never auto-apply. See `migration-recovery-decisions.md`. |

---

## Dependency Order (within this migration)

```
1. club_trackers table
      ↓
2. tournament_hand_audit_log table
      ↓
3. payroll_calculation_log table
      ↓
4. Indexes (no cross-dependencies)
      ↓
5. ALTER TABLE ENABLE ROW LEVEL SECURITY (idempotent DDL)
      ↓
6. is_club_tracker(_user_id, _club_id)   ← depends on club_trackers
   tracker_club_ids(_user_id)            ← depends on club_trackers
      ↓
7. RLS policies on club_trackers         ← depend on has_role() [local migrations]
   RLS policies on tournament_hand_audit_log  ← SELECT policy JOINs club_trackers
   RLS policies on payroll_calculation_log
      ↓
8. audit_tournament_hand()               ← depends on tournament_hand_audit_log
   get_escalation_config()               ← depends on swing_escalation_config [local]
   reconcile_ghost_assignments()         ← depends on transition_dealer_state() [local]
   club_local_date()                     ← depends on club_settings [local]
   tournament_break_all_tables()         ← depends on game_tables, dealer_breaks [local]
   reconcile_dealer_states()             ← depends on dealers, dealer_assignments [local]
   release_dealer_from_table()           ← depends on dealer_assignments [local]
   get_swing_metrics()                   ← depends on swing_audit_logs, dealer_breaks [local]
   force_release_stuck_assignment()      ← depends on swing_escalation_config [local]
   cleanup_old_diagnostic_logs()         ← depends on diagnostic_logs [local]
      ↓
9. trg_audit_tournament_hand trigger     ← depends on audit_tournament_hand() (step 8)
      ↓
10. rls_auto_enable() function + event trigger
```

External dependencies (must exist before this migration runs on a fresh build):

- `public.clubs` — FK target for `club_trackers.club_id`
- `auth.users` — FK target for `club_trackers.granted_by` and `tournament_hand_audit_log.actor_id`
- `public.tournament_hands` — FK target for `tournament_hand_audit_log.hand_id` and trigger source
- `public.dealer_payroll` — FK target for `payroll_calculation_log.payroll_id`
- `public.has_role()` — used in `club_trackers` RLS policies and `is_club_tracker()`/`tracker_club_ids()`
- `public.swing_escalation_config` — used by `get_escalation_config()` and `force_release_stuck_assignment()`
- `public.transition_dealer_state()` — used by `reconcile_ghost_assignments()`
- `public.club_settings` — used by `club_local_date()`
- `public.dealer_assignments`, `public.dealer_attendance`, `public.dealers`, `public.game_tables`, `public.dealer_breaks`, `public.audit_logs`, `public.swing_audit_logs`, `public.diagnostic_logs` — used by various functions

All of the above are created by existing local migration files. This baseline migration should run after all prior local migrations on a fresh build.

---

## Risks

| Risk | Severity | Mitigation |
|---|---|---|
| `granted_by` FK target in `club_trackers` assumed to be `auth.users(id)` — not confirmed from metadata | LOW | Verify before applying to a fresh DB. On remote dev DB the table already exists; this migration skips creation via IF NOT EXISTS. |
| `tournament_hand_audit_log` actor_id FK assumed `auth.users(id)` — not confirmed | LOW | Same mitigation. |
| ON DELETE clauses for FKs (CASCADE / SET NULL) inferred from naming convention and standard Supabase patterns, not extracted from metadata directly | MEDIUM | Run `SELECT conname, confdeltype FROM pg_constraint WHERE conrelid = 'club_trackers'::regclass` to verify before applying to production. |
| `reconcile_dealer_states` Step 3 contains `Dass.status` (capital D) — case inconsistency | LOW | Copied as-is from live DB for fidelity. PostgreSQL folds identifiers to lowercase so `Dass` = `dass` at parse time; no runtime error expected. Noted for review. |
| `tournament_break_all_tables` inserts into `dealer_breaks` using columns `started_at`, `duration_minutes`, `reason` | MEDIUM | `get_swing_metrics()` references `dealer_breaks.break_start` and `dealer_breaks.expected_duration_minutes`. Column naming inconsistency between the two functions copied from live DB. Verify actual `dealer_breaks` column names before calling `tournament_break_all_tables` in production. |
| `force_release_stuck_assignment` sets `should_audit_version = false` — column added by `pass1b_circuit_breaker.sql` | LOW | Function creates fine; fails at runtime only if `pass1b_circuit_breaker` not yet applied. On remote dev DB both exist. |
| `reconcile_ghost_assignments` checks `result->>'success'` but `transition_dealer_state` returns key `'ok'` | LOW | Latent logic bug: `v_current_ok` always resolves to `FALSE` even on successful transition, causing ghost assignments to be skipped rather than fixed. Copied from live DB as-is. Requires a separate bugfix migration to correct the key name. |
| Broad RLS on `payroll_calculation_log` (SELECT and ALL with `qual = true` for `public` role) | MEDIUM | Pre-existing design; not changed in this baseline. Any authenticated user can read all payroll calculation logs. Flag for future tightening. |
| `tournament_hand_audit_log` INSERT policy uses `with_check = true` — any authenticated user can write audit rows regardless of club membership | LOW | Pre-existing design; consistent with trigger-driven audit pattern where the audit writer is the trigger (SECURITY DEFINER). Not changed here. |

---

## Assumptions

1. `club_trackers.granted_by` references `auth.users(id)` (standard Supabase user pattern).
2. `tournament_hand_audit_log.actor_id` references `auth.users(id)`.
3. FK ON DELETE clauses: CASCADE for child→parent (club_trackers→clubs, tournament_hand_audit_log→tournament_hands, payroll_calculation_log→dealer_payroll); SET NULL for user references (granted_by, actor_id).
4. `diagnostic_logs` exists in local migrations (not in remote-only list from Stage 2A).
5. All functions copied verbatim from live DB definitions in `19_function_definitions.json` — no logic changes made.
6. `rls_auto_enable_trigger` event trigger name not confirmed from metadata — name assumed from standard convention; may already exist under a different name. Duplicate-object guard prevents failure if so.

---

## Unresolved Questions

| ID | Question | Blocks |
|---|---|---|
| Q1 | What is the exact ON DELETE action for `club_trackers_club_id_fkey`, `club_trackers_granted_by_fkey`, `tournament_hand_audit_log_hand_id_fkey`? | Verify before applying to a fresh DB |
| Q2 | Does `dealer_breaks` use `break_start`/`expected_duration_minutes` or `started_at`/`duration_minutes`? `tournament_break_all_tables` uses the latter; `get_swing_metrics` uses the former. | Verify before calling `tournament_break_all_tables` in production |
| Q3 | What is the exact event trigger name already on remote dev DB (from the 99 remote-only versions)? | Duplicate-object guard handles it, but the name is assumed |
| Q4 | Should `disable_stale_audit_flags` and `enable_audit_for_stuck_rows` be included with a runtime-only risk note, or deferred to a second baseline migration after `pass1b_circuit_breaker` is confirmed? | Low priority; does not block D4a/D5e |
| Q5 | `reconcile_ghost_assignments` result key bug: fix here or in a separate migration? | Low urgency; ghost assignments still visible via direct query |

---

## Static Verification (pre-commit)

- No `INSERT INTO` with production data: confirmed absent
- No `UPDATE dealer_payroll`: confirmed absent
- No placeholder UUID `22222222-2222-2222-2222-222222222222`: confirmed absent
- No CI workflow file changed: confirmed
- All functions sourced verbatim from `19_function_definitions.json`
- All table DDL sourced from `11_columns.json` + `13_constraints_simple.json`
- All RLS policies sourced from `03_rls_policies.json`
- Trigger DDL reconstructed from `20_trigger_definitions.json` metadata

---

## Next Steps (all require explicit approval)

| Step | Action | Decision |
|---|---|---|
| D4a | Add 99 remote-only versions + `20260609000002` to CI repair list in `.github/workflows/vbackerworkflowmain.yml` | Pending |
| D5a | Mark `20260611000001` as `--status applied` on remote dev DB (objects already exist) | After D4a |
| Stage 3, Step 4 | Test push on remote dev DB | After D4a + D5a |
| Stage 7 | Reintroduce Milestone A (`20260808000000`) from `feature/live-tracker-realtime-a-clean` | After pipeline confirmed healthy |
