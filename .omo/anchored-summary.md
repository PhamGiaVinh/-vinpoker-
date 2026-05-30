# Anchored Summary - VinPoker Production Fix Session

## Goal
Fix all VinPoker bugs and complete the Dealer Control operational flow (mass assign → auto swing → break → Telegram)

## Constraints & Preferences
- User communicates in Vietnamese
- Edge functions use `service_role` → `user_id = NULL` on dealers is NOT a problem (RLS bypassed)
- Tier is for table assignment ranking ONLY, NOT pay differentiation — all dealers same salary
- Dark theme (#0A0A0A), emerald accent (#10B981)
- i18n Vietnamese
- Code compatible with Supabase, Edge Functions, React frontend

## Progress
### Done
- **Mass-assign function redeployed** (v16→v17) with latest shared utils ✅
- **Assign-dealer function deployed** with latest shared utils ✅
- **process-swing fix — two root causes diagnosed and resolved** ✅

### Root Cause Analysis (Critical)
The process-swing function had **two independent bugs** that blocked ALL swing processing:

**Bug 1: `skills` column missing on `dealers` table** → `no_dealer` on all swings
- `buildDealerCandidates()` selects `skills` inside `dealers!inner(full_name, ..., skills)` 
- The `dealers` table had NO `skills` column → PostgREST query returns 400 error → `pickNextDealer` returns null → `perform_swing` gets `p_next_attendance_id = null` → **returns `no_dealer`** for ALL swings
- Fix: Added `skills text[] NOT NULL DEFAULT '{}'` to `dealers` table (migration `20260613000001`)
- Detected at trigger 1-2

**Bug 2: `idx_unique_active_attendance` unique index missing + wrong `ON CONFLICT` syntax in `perform_swing` RPC** → `failed` on all swings
- Migration `20260605000000_unique_active_assignment.sql` was supposed to create `idx_unique_active_attendance` as a `UNIQUE INDEX` (partial on `status = 'assigned'`) but the index was NOT present in the DB
- The `perform_swing` RPC used `ON CONFLICT ON CONSTRAINT` — which ONLY works with table constraints, NOT unique indexes. PostgreSQL returns 42704 error → RPC aborts → `data = null` → **outcome = "failed"**
- Fix: Created the unique index + rewrote RPC to use `ON CONFLICT (attendance_id) WHERE status = 'assigned' DO NOTHING` (migration `20260613000002`)
- Detected at trigger 3 (after Bug 1 was fixed)

**Bonus discovery**: The `BEFORE INSERT` trigger `trg_dealer_assignment_due_at` (function `trg_calc_swing_due_at()`) auto-sets `swing_due_at` when it's NULL. This means the `assign_dealer_to_table` RPC's default `NULL` for `p_swing_due_at` is handled correctly — no separate fix needed.

### Verification (Process-Swing Manual Trigger Results)
| Trigger | Skills Column | Unique Index + RPC Fix | total | success | no_dealer | failed | Status |
|---------|:---:|:---:|:---:|:---:|:---:|:---:|:---:|
| 1st (14:35) | ❌ | ❌ | 3 | 0 | 3 | 0 | Bug 1 (no_dealer) |
| 2nd (14:36) | ❌ | ❌ | 3 | 0 | 3 | 0 | Bug 1 (retry) |
| 3rd (14:36) | ✅ | ❌ | 3 | 0 | 0 | 3 | Bug 2 (failed) |
| **4th (14:45)** | ✅ | ✅ | **3** | **3** | **0** | **0** | **ALL SWUNG** |

### Migrations Created
1. `20260613000001_add_dealer_skills_column.sql` — add `skills text[]` to `dealers`
2. `20260613000002_fix_perform_swing_rpc.sql` — create unique index, fix `ON CONFLICT` syntax

## Current Production State (2026-05-28 14:47 UTC)
- **15 active assignments** with `swing_due_at` set (15:31-15:53 UTC)
- **35 available dealers** remaining
- **0 past-due swings** — no swings currently need processing
- **Cron active**: jobid=8 (`process-swing`, service_role) + jobid=19 (`process-swing-auto`, anon key) — both run `* * * * *`
- All 15 tables in Club 2222 are covered by dealers

## Key Decisions
- **`user_id = NULL` on dealers** — NOT the root cause (edge functions use `service_role`, bypass RLS)
- **`assign_dealer_to_table` RPC** — does NOT need a `swing_due_at` fix, the `BEFORE INSERT` trigger handles it
- Source of truth is `VinPoker/supabase/functions/` — `deploy-package/` has been cleaned up per README

## Next Steps (Pending User Request)
1. **Monitor cron** — verify it auto-processes future swings as `swing_due_at` triggers
2. **Implement TimerCell safe `onComplete`** — frontend safety guard (`hasFiredRef`, re-check `swing_processed_at`) — only if backend swing doesn't cover the use case
3. **Deploy frontend** after all backend fixes verified
4. **Clean up duplicate cron** (jobid=19 uses hardcoded anon key instead of service_role)

## Relevant Files
- `D:\Quy trình\VinPoker\supabase\functions\process-swing\index.ts` — Main edge function
- `D:\Quy trình\VinPoker\supabase\functions\_shared\dealer-utils.ts` — Shared utils (buildDealerCandidates, fillEmptyTables, pickNextDealer)
- `D:\Quy trình\VinPoker\supabase\migrations\20260613000001_add_dealer_skills_column.sql` — Fix Bug 1
- `D:\Quy trình\VinPoker\supabase\migrations\20260613000002_fix_perform_swing_rpc.sql` — Fix Bug 2
- `D:\Quy trình\VinPoker\src\components\cashier\DealerSwingTab.tsx:2149-2175` — TimerCell (for future onComplete work)

## Active Working Context (For Seamless Continuation)
- **Current State**: All 15 active tables have assigned dealers. Cron runs every minute. No past-due swings.
- **Known pending**: Cron jobid=19 (`process-swing-auto`) uses a hardcoded anon key instead of the service_role key — redundant with jobid=8 but harmless. Could clean up.
- **Supabase project**: `https://supabase.com/dashboard/project/orlesggcjamwuknxwcpk`
- **Service role key**: Available via `supabase secrets list`
