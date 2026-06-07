# Anchored Summary - VinPoker Production Fix Session

## Goal
Fix all VinPoker production issues: Dealer Control flow (mass assign → auto swing → break → Telegram), CI/CD pipeline, website performance, **and 5 swing bugs from latest code review (NOTIFY/race/shortage/hybrid/release)**.

## Constraints & Preferences
- User communicates in Vietnamese
- Edge functions use `service_role` → `user_id = NULL` on dealers is NOT a problem (RLS bypassed)
- Tier is for table assignment ranking ONLY, NOT pay differentiation — all dealers same salary
- Dark theme (#0A0A0A), emerald accent (#10B981)
- i18n Vietnamese
- Code compatible with Supabase, Edge Functions, React frontend
- `dealer_attendance` has NO `club_id`, `updated_at`, or `current_table_id` columns
- `dealer_attendance.current_state` CHECK only allows: `available`, `assigned`, `on_break`, `checked_out`, `pre_assigned`
- `pg_cron` extension available (v1.6.4)
- Rolling 24h window for `busyDealerIds` (NOT `startOfToday`) — poker shifts cross midnight
- 4 partial unique indexes on `dealer_assignments` (after migration 7): `idx_one_active_per_dealer`, `idx_unique_active_attendance`, `idx_unique_active_dealer`, `idx_unique_active_assignment`
- `dealer_assignments_pkey` on `id` (real PK)
- `idx_unique_active_attendance` REQUIRED for ON CONFLICT inference — 30 SQL functions depend on it
- `dealer_attendance` state transition columns: `current_state` (state machine), `released_at` (rest calc baseline), `check_in_time` (fallback), `updated_at` (fallback)
- `bump_dealer_assignment_version()` trigger: only one remains (`trg_dealer_assignments_version`)
- `force_release_stuck_assignment(p_assignment_id, p_club_id, p_reason)` RPC
- `swing_escalation_config` table: tier thresholds + `force_release_at_overdue_min=30` + audit flags
- `should_audit_version` BOOLEAN on `dealer_assignments`
- `dealer_assignment_version_audit` table
- Telegram bot: existing bot, format for pre-announce with multiple tables TBD
- Migration apply order is HARDCODED, verify with `schema_migrations` query
- NEVER deploy 3+ PRs to prod simultaneously — must isolate via canary
- 5 PRs with sequential dependency chain, 3 required + 2 optional

## Progress
### Phase 1 — Initial Swing Bugs
- **Bug 1: `skills` column missing on `dealers` table** → `no_dealer` on all swings. Fixed via migration `20260613000001`.
- **Bug 2: `idx_unique_active_attendance` unique index missing + wrong `ON CONFLICT` syntax in `perform_swing` RPC** → `failed` on all swings. Fixed via migration `20260613000002`.

### Phase 2 — Stuck Dealers & TOCTOU
- **Root cause (stuck dealers) confirmed**: 17 stale attendance records (11 `assigned` + 6 `pre_assigned`) with `check_out_time IS NULL` from 1.8–3.8 days ago poisoned `busyDealerIds` in `pickNextDealer.ts`, making pool appear empty → infinite retry → 590+ min OT on Bàn 100.
- **Migration `20260721000000`**: `cleanup_stale_attendance` RPC, unique index on `dealer_id`, daily cron schedule.
- **Migration `20260721000001`**: TOCTOU retry wrapper — retries 3× via `FOR UPDATE SKIP LOCKED` pool query.
- **Live cleanup executed**: 17 stale dealers cleaned, 10 dangling assignments released, including Bàn 100.
- **pickNextDealer.ts**: Rolling 24h window + zero-candidate logging added.
- **process-swing/index.ts**: Circuit breaker at >60min overdue + enhanced `no_dealer` logging.

### Phase 3 — CI/CD Pipeline
- **Step 9 fix**: `supabase db push --linked --include-all` failed because remote `schema_migrations` had versions without local migration files.
- **3 orphaned versions added to repair list**: `20260603143139`, `20260603143207`, `20260603152443` — systematic comparison found all missing versions in one pass.
- **CI/CD run #26 fully succeeded**: All 11 steps passed (repair ✅, db push ✅, edge functions ✅, Vercel ✅).

### Phase 4 — Website Lag (Column Fixes)
- **Root cause (website lag) identified**: 5× 400 errors per swing tick from `dealer_attendance` queries using non-existent columns (`club_id`, `updated_at`, `current_table_id`).
- **Fix applied in 2 files**: `process-swing/index.ts` (4 locations) + `_shared/pickNextDealer.ts` (1 location) — replaced invalid columns with valid alternatives or removed the filter entirely.
- **Deployed manually to production**: All 4 edge functions (process-swing v107, assign-dealer, close-table, swing-metrics) deployed locally since CI/CD Step 10 was flaky.
- **Verified**: All process-swing invocations returning **200** — zero 400 errors.

### Phase 5 — 5 BUGS + 8 GAPS from Code Review (NOT YET IMPLEMENTED)
**5 bugs identified by user after deep analysis:**
- **BUG #1**: NOTIFY trigger chỉ fires on INSERT, không catch state transition (on_break/assigned → available)
- **BUG #2**: Pre-announce duplicate khi cùng dealer assigned multiple tables trong cycle
- **BUG #3**: Shortage count stale — `availableDealerCount` snapshot tại start, không update realtime
- **BUG #4**: OT gap khi no replacement — cần hybrid (force-release + skip perform_swing, KHÔNG continue silently)
- **BUG #5**: Rest deficit không pass vào `perform_swing` RPC (chỉ pre-assign path có, direct swing path thiếu)

**8 gaps identified:**
- **Gap #1**: Missing DB indexes cho `pre_announce_jobs` table (cleanup, by_table, by_club_dealer)
- **Gap #2**: Missing `pg_net` extension creation (required for `net.http_post()`)
- **Gap #3**: No timeout/retry/circuit breaker cho Telegram (cron có thể block 30s)
- **Gap #4**: BUG #4 hybrid thiếu state validation (race: already released, force_release failure)
- **Gap #5**: Race condition giữa job fire + cancel (cần atomic check trước update)
- **Gap #6**: Off-by-one shortage calc (time-based recount + end-of-loop recount > batch-based)
- **Gap #7**: Missing integration tests (end-to-end, concurrent, chaos, performance)
- **Gap #8**: No monitoring metrics (cron_duration, queue_depth, failure_rate, alerts)

### Migrations Created (Phase 1-4)
1. `20260613000001_add_dealer_skills_column.sql` — add `skills text[]` to `dealers`
2. `20260613000002_fix_perform_swing_rpc.sql` — create unique index, fix `ON CONFLICT` syntax
3. `20260721000000_cleanup_stale_attendance.sql` — cleanup RPC + unique index + cron
4. `20260721000001_fix_perform_swing_toctou.sql` — TOCTOU retry wrapper

### Phase 5 Migrations (PENDING, ordered):
- `20260609000007_enable_pg_net.sql` (Gap #2)
- `20260609000008_atomic_dealer_ready_check.sql` (BUG #1)
- `20260609000009_modify_pre_announce_jobs_add_indexes.sql` (BUG #2 + Gap #1)
- `20260609000010_count_available_dealers.sql` (BUG #3)
- `20260609000011_perform_swing_rest_deficit.sql` (BUG #5)
- `20260609000012_notify_dealer_ready_v2.sql` (BUG #1 trigger)
- `20260609000013_cron_advisory_lock_rpcs.sql` (Gap #5 cron race)

### Phase 6 Migrations (OPTIONAL, defer):
- `20260609000014_create_cron_metrics_table.sql` (Gap #8)

## Current Production State (2026-06-09 ~09:00 ICT)
- **Edge Functions**: process-swing v156/v157 (graduated picker + force-release), v25 close-table (idempotent)
- **v156 regression ROOT CAUSE + FIXED**: Migration 1 dropped `idx_unique_active_attendance` broke 30 SQL functions. Migration 7 RECREATED it. EXPLAIN ANALYZE shows `Index Scan using idx_unique_active_attendance` (0.087ms). 4 stuck swings processed at 08:52:04 in 1 cron tick.
- **Bàn 100 NEW ROTATION**: Row `f94d3797-3d5d-421d-a114-a59d8d8d3c12` at swing_due_at 09:25:03, dl 1 as current
- **Bàn 10 HEALTHY**: Row `ee137504-6d5e-49fa-9c23-636f22a477c6` (table 7d200ce7), swing_due_at 09:22:04, pre_assigned=NULL, version=1, current_dl=dl 13
- **All process-swing invocations returning 200**
- **Cron jobs active**: process-swing (* * * * *), reconcile-ghost-assignments (*/15 * * * *), cleanup-diagnostic-logs (0 3 * * *), enforce-break-balance (*/5 * * * *)
- **CI/CD**: Last run succeeded; `main` at `f1360d7`

## Key Decisions
- **`user_id = NULL` on dealers** — NOT a problem (edge functions use service_role, bypass RLS)
- **`assign_dealer_to_table` RPC** — does NOT need a `swing_due_at` fix, the `BEFORE INSERT` trigger handles it
- **`checked_out` state for zombie cleanup**: `abandoned`/`auto_closed` violate CHECK constraint; `checked_out` is valid for both `current_state` and `status`
- **Scope `dealer_attendance` queries by `dealer_id IN` (club's dealers) instead of `club_id`**: `dealer_attendance` has no `club_id` column; obtain club's dealer IDs from `dealers` table
- **Use `check_in_time` as proxy for stuck detection**: `dealer_attendance` has no `updated_at`; `check_in_time` is the best available timestamp
- **Unique index on `dealer_id` only**: Cannot use `club_id` (not on table); index prevents one active attendance per dealer globally
- **PostgreSQL ON CONFLICT inference requires index WHERE to be IMPLIED BY ON CONFLICT WHERE (not the reverse)**
- **The "subset" test for index consolidation must include the ON CONFLICT direction, not just query predicates**
- **Both indexes must coexist**: `idx_one_active_per_dealer` + `idx_unique_active_attendance`
- **NEVER auto-close tables** — cashier closes manually
- **Force-release should chain pick immediately** (try pick FIRST, force-release only if replacement available)
- **BUG #4 hybrid**: Call `force_release_stuck_assignment` to reset state, skip `perform_swing` (bàn trống 30-60s)
- **Pre-announce timing aware of dealer break status** — not fixed window
- **Bypass fatigue hard cap in shortage** when `activeTableCount > availableDealerCount`
- **Window expanded to [T+0, T+15]** for shortage pre-announce (was [T+(preAnnounce-2), T+(preAnnounce+2)])
- **pre_announce_jobs table = delayed job queue** (cron 30s processes)
- **Schedule pre-announce based on `ready_at - preAnnounceMinutes`** where `ready_at = max(effective_swing_due, break_end)`
- **NOTIFY trigger state transition**: detect `OLD.current_state != 'available' AND NEW.current_state = 'available'`
- **Idempotency**: use PostgreSQL `xmin` (transaction ID) as unique dedup key
- **State transition not in same transaction**: xmin changes → new notification
- **CRON race protection**: `pg_try_advisory_lock(hashtext('process_swing_' || club_id))` — only 1 tick wins
- **Backup cron: 60s** (NOT 15s, NOT 30s) — enough for NOTIFY miss recovery
- **Smart gate for backup cron**: only trigger if `has_recent_dealer_ready()` returns true (avoid no-op DB calls)
- **pre_announce_jobs queue is SINGLE source of truth** (no inline `sendTelegram` in pass2-pre-assign)
- **All pre-announce through queue**: `scheduled_at = now()` for immediate, cron 30s processes
- **Unique constraint on `pre_announce_jobs`**: `(club_id, attendance_id, table_id) WHERE status='pending'` — DB-level dedup
- **Aggregate additional tables into payload**: `payload.additional_tables = [T1, T2, T3]`
- **Cleanup soft-delete + daily hard delete**: status='fired'/'cancelled' → 7 days → DELETE
- **Job cancellation atomic**: `.update({status: 'cancelled'}).eq('table_id', X).eq('status', 'pending')`
- **Re-check status before marking 'fired'**: `select('status')` then compare
- **Telegram defensive**: timeout 5s, max 3 retries, exponential backoff (1s, 2s, 4s), circuit breaker 10 consecutive fails
- **Rest deficit semantics**: `restDeficitMin = max(0, ceil((breakEnd - now) / 60000))`. Pass to `perform_swing(p_rest_deficit_minutes)`. RPC delays `swing_due_at` by this many minutes
- **Null rest baseline fallback**: `released_at ?? check_in_time ?? updated_at ?? null`. If all null → `restDeficitMin = 0` (safe)
- **Shortage recalc strategy**: time-based (5s interval) + end-of-loop recount (not batch-based)
- **Count function**: `count_available_dealers(p_club_id)` — uses LEFT JOIN to exclude currently assigned
- **5 PRs sequential, not parallel**: 3 REQUIRED (PR #1-3) + 2 OPTIONAL (PR #4-5, defer)
- **Canary first, prod after**: Each PR tested 5-10 min on canary, then +10 min gaps on prod
- **Git workflow**: 1 feature branch `feature/all-bugs-fix` with 3 separate commits (PR #1, #2, #3) merged sequentially

## Next Steps
### Immediate (Phase 5 - REQUIRED)
1. **PR #1: BUG #1 + BUG #5 + Gap #2 + Gap #3 (partial)**
   - Branch: `fix/critical-notify-and-rest-deficit`
   - Migrations: #7, #8, #11, #12
   - New EF: `process-swing-on-dealer-ready/index.ts`
   - Cron: backup 60s with advisory lock + smart gate
   - Tests: state transition, xmin idempotency, atomic check, rest deficit validation, null baseline
   - Rollback: DROP TRIGGER + DROP FUNCTION + DROP EXTENSION
2. **PR #2: BUG #2 + Gap #1 + Gap #3 + Gap #5**
   - Branch: `fix/pre-announce-no-duplicate`
   - Migration: #9 (indexes + unique constraint)
   - Edit: `pass2-pre-assign.ts` (queue-only, no inline sendTelegram)
   - New cron: `process-pre-announce-jobs` 30s with timeout/retry/circuit breaker
   - Tests: unique constraint, concurrent race, retry, timeout, cancel-during-fire
   - Rollback: DROP INDEX, revert pass2-pre-assign.ts
3. **PR #3: BUG #3 + BUG #4 + Gap #4 + Gap #5 + Gap #6**
   - Branch: `fix/shortage-realtime-and-ot-skip`
   - Migrations: #10, #13
   - Edit: `process-swing/index.ts` Pass 3 (state validation + time-based recount)
   - New crons: `cleanup-pre-announce-jobs` 3 AM, main cron with advisory lock
   - Tests: shortage real-time, force-release state validation, already-released race, no-replacement hybrid, with-replacement chain, cleanup expiry, concurrent cron locks
   - Rollback: DROP FUNCTION, revert Pass 3 EF

### Defer (Phase 6 - OPTIONAL)
4. **PR #4**: Gap #7 integration tests (defer to next sprint)
   - End-to-end: dealer-ready → EF → pick
   - Concurrent crons: advisory locks
   - Shortage + concurrent picks
   - Job cancel during fire race
   - Load test: 50 tables
   - Chaos: random updates
5. **PR #5**: Gap #8 monitoring (defer to next sprint)
   - `cron_metrics` table
   - All EFs: log duration + status
   - Daily digest: queue depth, failure rate
   - Alerts: ALL_DEALERS_EXHAUSTED >60s, CRON_STUCK >2min

### Deployment Workflow
```
1. Create feature branch `feature/all-bugs-fix` from main
2. Commit PR #1 (BUG #1, #5) → merge to canary
3. Apply migrations #7, #8, #11, #12 to canary
4. Deploy backup cron EF to canary
5. Test 5-10 min: NOTIFY fires, rest deficit, atomic check ✅
6. Merge PR #1 to main → deploy to prod (low traffic window)
7. Wait 10 min, then commit PR #2 (BUG #2) → merge to canary
8. Apply migration #9 → deploy pre-announce cron
9. Test 5 min: no duplicates, queue works ✅
10. Merge PR #2 to main → deploy to prod
11. Wait 20 min, then commit PR #3 (BUG #3, #4) → merge to canary
12. Apply migrations #10, #13 → deploy Pass 3 EF + cleanup cron
13. Test 10 min soak: shortage, force-release, OT hybrid ✅
14. Merge PR #3 to main → deploy to prod
15. Monitor 30 min, declare DONE
```

### Pending User Decisions (5 Open Questions) — RESOLVED 2026-06-09
1. **Git workflow**: ✅ **1 feature branch `feature/all-bugs-fix` + 3 commits** (PR #1, #2, #3). 1x CI/CD run per commit, atomic rollback via `git revert HEAD`. Create branch → commit PR #1 → commit PR #2 → commit PR #3 → push → open 1 PR → merge to main (keep 3 commits or squash).
2. **Staging DB**: ✅ **Use canary club `22222222-2222-2222-2222-222222222222` (Hanoi Royal Poker) in prod DB** — same schema, no extra cost, isolated via `club_id` filter. Already set up with 10 dealers + 5 tables. No fixtures needed.
3. **Rollback**: ✅ **Manual per PR** (drop functions + revert commit). DB migrations not idempotent → manual safer. Have `scripts/rollback-phase-5.sh` ready before deploy. Runbook per PR with specific SQL drops.
4. **Monitoring**: ✅ **Setup BEFORE PR #1** (Day 0, 1-2 days before). Create `cron_metrics` table + add log fields to EFs. Phase A: create table + baseline test. Phase B: integrate in PR #1-3 EFs. Phase C: alerts (CRON_STUCK, ALL_DEALERS_EXHAUSTED, HIGH_TELEGRAM_FAILURE) via Telegram.
5. **Stakeholder comms**: ✅ **5 touches** — (1) Day 0 briefing email, (2) Day 1 morning-of heads up, (3) Live updates thread in #vinpoker-engineering every 5-10 min, (4) Post-deploy summary 1h after, (5) 24h metrics review next day.

### Day 0 Checklist (BEFORE deploy, 1-2 days)
- [ ] Create `feature/all-bugs-fix` branch
- [ ] Prepare 3 PRs (commits ready, not merged)
- [ ] Set up `cron_metrics` table (Phase A monitoring)
- [ ] Verify canary club still has 10 dealers + 5 tables
- [ ] Test manual swing on canary (baseline metrics)
- [ ] Brief stakeholders (Touch #1 email)
- [ ] Verify rollback script works
- [ ] Test pg_net extension enablement on canary

### Day 1 Checklist (Deploy day, low traffic window 06:00-08:00 ICT)
- [ ] Morning standup: review timeline
- [ ] Send Touch #2 (morning-of heads up)
- [ ] Deploy PR #1 → canary (test 5 min)
- [ ] Deploy PR #1 → prod (verify 10 min)
- [ ] Deploy PR #2 → canary (test 5 min)
- [ ] Deploy PR #2 → prod (verify 10 min)
- [ ] Deploy PR #3 → canary (test 10 min)
- [ ] Deploy PR #3 → prod (verify 10 min)
- [ ] Send Touch #3 (live updates thread)
- [ ] Send Touch #4 (post-deploy summary)

### Day 2+ Checklist
- [ ] Monitor metrics in #vinpoker-engineering
- [ ] Send Touch #5 (24h review)
- [ ] Plan PR #4-5 (integration tests + monitoring dashboard) for follow-up sprint

### Backlog (from earlier)
- TimerCell safe `onComplete` — frontend safety guard (`hasFiredRef`, re-check `swing_processed_at`)
- Deploy frontend after all backend fixes verified
- P2: Move `STANDARD_SHIFT_MINUTES = 480` to `club_settings`
- P3: 996 pre-existing lint `any` errors

## Relevant Files
### Phase 1-4 (existing)
- `VinPoker/supabase/functions/process-swing/index.ts` — Main edge function (column fixes + graduated picker)
- `VinPoker/supabase/functions/_shared/pickNextDealer.ts` — Shared utils (rolling 24h, minRestMinutes options)
- `VinPoker/supabase/functions/_shared/evaluateBreakNeed.ts` — Clean (uses valid columns only)
- `VinPoker/supabase/functions/process-swing/passes/pass2-pre-assign.ts` — Clean schema queries
- `VinPoker/supabase/functions/process-swing/passes/pass2.5-initial-assign.ts` — Clean schema queries
- `VinPoker/supabase/migrations/20260613000001_add_dealer_skills_column.sql` — Fix Bug 1
- `VinPoker/supabase/migrations/20260613000002_fix_perform_swing_rpc.sql` — Fix Bug 2
- `VinPoker/supabase/migrations/20260721000000_cleanup_stale_attendance.sql` — Cleanup RPC + unique index + cron
- `VinPoker/supabase/migrations/20260721000001_fix_perform_swing_toctou.sql` — TOCTOU retry wrapper
- `.github/workflows/vbackerworkflowmain.yml` — CI/CD workflow
- `VinPoker/src/components/cashier/DealerSwingTab.tsx:2149-2175` — TimerCell (for future onComplete work)
- `VinPoker/src/components/cashier/DealerSwingTab.tsx:264-282` — hoisted `payrollDateBounds` useMemo (Tt fix)
- `VinPoker/src/components/cashier/DealerSwingTab.tsx:607-610` — `r?.already_inactive` info-toast branch
- `VinPoker/src/components/cashier/DealerSwingTab.tsx:2607-2613` — `filteredTables` filters `t.status === "active"`
- `VinPoker/src/components/cashier/DealerSwingTab.tsx:593-628` — closeTable() with idempotent handling
- `VinPoker/supabase/functions/close-table/index.ts:47-52` — idempotent return 200 + `already_inactive:true`
- `VinPoker/supabase/migrations/20260608000005_backfill_released_at_from_swing_processed.sql` — Bàn 10 backfill
- `VinPoker/supabase/migrations/20260608000006_patch_execute_pre_assigned_swing_released_at.sql` — Bàn 10 function patch
- `VinPoker/supabase/migrations/20260801000003_rpc_pre_assign_cleanup.sql` — Bàn 10 root cause migration
- `VinPoker/supabase/migrations/20260608000001_soft_min_rest.sql` — original Bàn 10 rest calc
- `VinPoker/supabase/migrations/20260608000004_drift_compensation.sql` — drift compensation
- `VinPoker/tests/ban10_smoke_test.sql` — 5-phase smoke test
- `VinPoker/.github/workflows/vbackerworkflowmain.yml` — CI/CD

### Phase 5 (Phase 5 migrations already applied, NEW ones PENDING)
- `VinPoker/supabase/migrations/20260609000001_drop_redundant_partial_unique_index.sql` — DROP `idx_unique_active_attendance` (REGRESSION ROOT CAUSE)
- `VinPoker/supabase/migrations/20260609000002_create_swing_escalation_config_and_seed.sql` — escalation config table + seed
- `VinPoker/supabase/migrations/20260609000003_audit_trail_and_stuck_view.sql` — audit + view
- `VinPoker/supabase/migrations/20260609000004_rpcs_force_release_escalation_audit.sql` — 4 RPCs
- `VinPoker/supabase/migrations/20260609000005_fix_force_release_no_view_delete.sql` — fix DELETE on view
- `VinPoker/supabase/migrations/20260609000006_drop_duplicate_bump_trigger.sql` — drop duplicate trigger
- `VinPoker/supabase/migrations/20260609000007_recreate_attendance_unique_index_for_on_conflict.sql` — **FIX v156 regression**
- **PENDING NEW migrations (Phase 5)**:
  - `VinPoker/supabase/migrations/20260609000007_enable_pg_net.sql` (Gap #2)
  - `VinPoker/supabase/migrations/20260609000008_atomic_dealer_ready_check.sql` (BUG #1)
  - `VinPoker/supabase/migrations/20260609000009_modify_pre_announce_jobs_add_indexes.sql` (BUG #2 + Gap #1)
  - `VinPoker/supabase/migrations/20260609000010_count_available_dealers.sql` (BUG #3)
  - `VinPoker/supabase/migrations/20260609000011_perform_swing_rest_deficit.sql` (BUG #5)
  - `VinPoker/supabase/migrations/20260609000012_notify_dealer_ready_v2.sql` (BUG #1 trigger)
  - `VinPoker/supabase/migrations/20260609000013_cron_advisory_lock_rpcs.sql` (Gap #5 cron race)
- **PENDING NEW edge functions (Phase 5)**:
  - `VinPoker/supabase/functions/process-swing-on-dealer-ready/index.ts` (BUG #1 + new NOTIFY handler)
  - `VinPoker/supabase/functions/cron-tick/run-dealer-ready-backup.ts` (backup cron)
  - `VinPoker/supabase/functions/cron-tick/run-pre-announce-processor.ts` (PR #2)
  - `VinPoker/supabase/functions/cron-tick/run-pre-announce-cleanup.ts` (PR #3)
  - `VinPoker/supabase/functions/cron-tick/run-daily-metrics-digest.ts` (PR #5)
- **EDIT (Phase 5)**:
  - `VinPoker/supabase/functions/process-swing/index.ts:805-836` — Pass 0c (force-release integration)
  - `VinPoker/supabase/functions/process-swing/index.ts:1643-1665` — Pass 3 entry
  - `VinPoker/supabase/functions/process-swing/index.ts:1701-2234` — Pass 3 main loop
  - `VinPoker/supabase/functions/process-swing/index.ts:1764-1801` — CURRENT force-release block (BUG #4 hybrid)
  - `VinPoker/supabase/functions/process-swing/index.ts:1979-2010` — CURRENT graduated tier picker
  - `VinPoker/supabase/functions/process-swing/passes/pass2-pre-assign.ts:76-89` — pre-announce window (BUG #2 queue-only)
  - `VinPoker/supabase/functions/process-swing/passes/pass2-pre-assign.ts:208-211` — picker call (BUG #3 shortage)
  - `VinPoker/supabase/functions/process-swing/passes/pass2-pre-assign.ts:255-322` — Telegram send (REMOVED, queue-only)

## Active Working Context (For Seamless Continuation)
- **Current State**: All Phase 1-4 fixes deployed. v156 regression FIXED via migration 7. Process-swing returning 200. CI/CD passing.
- **Phase 5 ready to start**: 5 bugs + 8 gaps identified, 3-PR sequential plan finalized with rollback strategies.
- **Supabase project**: `https://supabase.com/dashboard/project/orlesggcjamwuknxwcpk`
- **Service role key**: Available via `supabase secrets list`
- **Latest commits on main**: `f1360d7` (idx_unique_active_attendance fix), `c4482aa` (Bàn 100 fix)
- **Canary club**: `22222222-2222-2222-2222-222222222222` (Hanoi Royal Poker)
- **Canary swing_config**: `swing_duration_minutes: 30, break_duration_minutes: 10, pre_announce_minutes: 5, overtime_threshold_minutes: 60, rotation_planner_enabled: true`
- **Canary club_settings**: `auto_swing_enabled: true, shortage_auto_close_enabled: false, timezone: 'Asia/Ho_Chi_Minh'`
- **Known pending**: Cron jobid=21 uses hardcoded anon key — harmless (function uses service_role internally)
- **30 SQL files** use `ON CONFLICT (attendance_id) WHERE (status = 'assigned')` — depend on `idx_unique_active_attendance`
