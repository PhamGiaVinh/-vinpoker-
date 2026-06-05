# Anchored Summary - VinPoker Production Fix Session

## Goal
Fix all VinPoker production issues: Dealer Control flow (mass assign → auto swing → break → Telegram), CI/CD pipeline, and website performance.

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

### Migrations Created
1. `20260613000001_add_dealer_skills_column.sql` — add `skills text[]` to `dealers`
2. `20260613000002_fix_perform_swing_rpc.sql` — create unique index, fix `ON CONFLICT` syntax
3. `20260721000000_cleanup_stale_attendance.sql` — cleanup RPC + unique index + cron
4. `20260721000001_fix_perform_swing_toctou.sql` — TOCTOU retry wrapper

## Current Production State (2026-06-03 16:30 ICT)
- **Edge Functions**: process-swing v107, assign-dealer, close-table, swing-metrics — all deployed with column fixes
- **All process-swing invocations returning 200** — no 400 errors from invalid columns
- **Cleanup cron active**: Daily stale attendance cleanup via `pg_cron`
- **Cron active**: jobid=8 (`process-swing`, service_role) + jobid=19 (`process-swing-auto`, anon key) — both run `* * * * *`
- **CI/CD**: Run #26 passed. Run #28 (commit `59d7330`) passed all 11 steps ✅ — Edge Function deploy now uses independent retry loops (3 attempts per function) to handle transient failures.

## Key Decisions
- **`user_id = NULL` on dealers** — NOT a problem (edge functions use `service_role`, bypass RLS)
- **`assign_dealer_to_table` RPC** — does NOT need a `swing_due_at` fix, the `BEFORE INSERT` trigger handles it
- **`checked_out` state for zombie cleanup**: `abandoned`/`auto_closed` violate CHECK constraint; `checked_out` is valid for both `current_state` and `status`
- **Scope `dealer_attendance` queries by `dealer_id IN` (club's dealers) instead of `club_id`**: `dealer_attendance` has no `club_id` column; obtain club's dealer IDs from `dealers` table
- **Use `check_in_time` as proxy for stuck detection**: `dealer_attendance` has no `updated_at`; `check_in_time` is the best available timestamp
- **Unique index on `dealer_id` only**: Cannot use `club_id` (not on table); index prevents one active attendance per dealer globally

## Next Steps (Pending User Request)
1. **Monitor process-swing logs** — confirm 400 errors stay at zero
2. **Clean up duplicate cron** (jobid=19 uses hardcoded anon key instead of service_role)
3. **Implement TimerCell safe `onComplete`** — frontend safety guard (`hasFiredRef`, re-check `swing_processed_at`)
4. **Deploy frontend** after all backend fixes verified

## Relevant Files
- `VinPoker/supabase/functions/process-swing/index.ts` — Main edge function (column fixes applied)
- `VinPoker/supabase/functions/_shared/pickNextDealer.ts` — Shared utils (rolling 24h window, column fix)
- `VinPoker/supabase/functions/_shared/evaluateBreakNeed.ts` — Clean (uses valid columns only)
- `VinPoker/supabase/functions/process-swing/passes/pass2-pre-assign.ts` — Clean schema queries
- `VinPoker/supabase/functions/process-swing/passes/pass2.5-initial-assign.ts` — Clean schema queries
- `VinPoker/supabase/migrations/20260613000001_add_dealer_skills_column.sql` — Fix Bug 1
- `VinPoker/supabase/migrations/20260613000002_fix_perform_swing_rpc.sql` — Fix Bug 2
- `VinPoker/supabase/migrations/20260721000000_cleanup_stale_attendance.sql` — Cleanup RPC + unique index + cron
- `VinPoker/supabase/migrations/20260721000001_fix_perform_swing_toctou.sql` — TOCTOU retry wrapper
- `.github/workflows/vbackerworkflowmain.yml` — CI/CD workflow (24 orphaned versions in repair list)
- `VinPoker/src/components/cashier/DealerSwingTab.tsx:2149-2175` — TimerCell (for future onComplete work)

## Active Working Context (For Seamless Continuation)
- **Current State**: All edge functions deployed with column fixes. All process-swing invocations returning 200. CI/CD run #28 passed all 11 steps ✅ (independent retry loops for Edge Function deploy).
- **Known pending**: Cron jobid=21 uses hardcoded anon key — harmless (function uses service_role internally for DB queries).
- **Supabase project**: `https://supabase.com/dashboard/project/orlesggcjamwuknxwcpk`
- **Service role key**: Available via `supabase secrets list`
- **Latest commits on master**: `59d7330` (CI/CD retry fix), `7d62c18` (column fix)
