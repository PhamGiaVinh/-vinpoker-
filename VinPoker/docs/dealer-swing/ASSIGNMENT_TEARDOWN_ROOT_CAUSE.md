# Dealer Swing — Assignment Teardown Root Cause & Fix Contract

> **Status:** docs-only spec. **No DB apply, no migration, no code change in this PR.**
> This document is the "fix contract" for the orphaned-`dealer_assignments` freeze class.
> Implementer must satisfy every item in §5–§7 before any controlled live apply.
>
> **Incident:** 2026-06-17, club `22222222` (Hanoi Royal Poker), dealer `pgv` stuck
> `available` in the pool for 3+ hours; whole-club rotation frozen. Unblocked by a
> manual single-row release (data fix only). This doc explains why it happened and
> how to kill the whole class.
>
> **Audit basis:** 6-dimension read-only audit against **live** RPC definitions
> (pulled via `pg_get_functiondef`, not migrations — migrations have drifted), 34 raw
> findings → 21 adversarially-verified → deduped. Key claims re-verified by hand.

---

## 1. Executive summary

A single `dealer_assignments` row left with `released_at IS NULL` while its dealer is
no longer actually working (checked out, or on a stale break from a prior attendance)
is treated as **"this dealer is busy"** by the rotation engine's candidate filter
(`pickNextDealer` Step 5b). The dealer is then excluded from every table. If that dealer
is the last viable replacement, the Forward Rotation Scheduler (Pass R) reports
`shortage`, the table cannot be filled, and **the club's rotation freezes** until a
human intervenes — because the automatic safety net (`reconcile_ghost_assignments`)
does **not** recognize this orphan class either.

The defect is **not** a single bug — it is the **same missing teardown** replicated
across **four independent paths** (checkout edge fn, checkout RPC, daily stale-cleanup
cron, ghost-reconciler), plus several P1 consistency gaps. Patching one or two paths
will leave the class alive. The fix must be **architectural**: one canonical teardown
function + one shared "busy" predicate, called/used everywhere.

**Severity:** P0 (club-wide freeze, recurs daily via the 6 AM cleanup cron).
**Blast radius:** any dealer who checks out (or is auto-checked-out) while holding an
`on_break`/`pre_assigned` assignment — i.e. routine, not edge-case.

---

## 2. False-positive correction (must stay on record)

The raw audit flagged a **P0-1 "`release_club_lock` RPC does not exist live → lock
leak"**. **This is FALSE.**

- `release_club_lock(p_club_id uuid)` **exists** in the live database (confirmed via
  `pg_proc` / `pg_get_function_identity_arguments`).
- It **is** called by `process-swing` in the per-club `finally` block at
  `VinPoker/supabase/functions/process-swing/index.ts:3863`
  (`await admin.rpc("release_club_lock", { p_club_id: cid })`).
- The false "missing" conclusion came from an **incomplete diagnostic dump pattern**
  (the dump script searched names like `%release_dealer%` / `%check_out%` but not
  `%release_club%`), so the function was simply absent **from the dump file**, not from
  the database.

**There is no club-lock leak.** Do not "fix" `release_club_lock`. Do not apply
migration `20260725000001` on the basis of this claim. This correction is recorded so
the false lead is not re-chased.

---

## 3. Root cause chain

```
teardown path forgets to stamp released_at
        │
        ▼
dealer_assignments row persists: released_at IS NULL, status ∈ {assigned, on_break, pre_assigned}
        │   (row is tied to an OLD/checked-out attendance, but matches the dealer's dealer_id)
        ▼
pickNextDealer "Step 5b" cross-check  (_shared/pickNextDealer.ts, ~L498)
   SELECT dealer_id FROM dealer_assignments
   WHERE dealer_id = <pool dealer>           -- matches by DEALER_ID, not attendance_id
     AND status IN ('assigned','pre_assigned','on_break')
     AND released_at IS NULL
        │
        ▼
dealer added to busyDealerIds → excluded from EVERY table
        │
        ▼
if that dealer is the only/last viable replacement:
   Pass R (passR-rotation-planner) → shortage=N
   fillEmptyTables → "Could not assign dealer after 3 attempts"
   assign_dealer_to_table(table the orphan points at) → 'table_occupied'
        │
        ▼
CLUB ROTATION FREEZES (overdue swings never execute; empty tables never fill)
        │
        ▼
reconcile_ghost_assignments (15-min cron, the safety net) DOES NOT MATCH this orphan
   → freeze persists indefinitely until a human releases the row
```

**The pivotal property:** Step 5b matches by **`dealer_id`**, so an orphan tied to an
**old/checked-out attendance** still poisons the dealer's **new** attendance. The "busy"
signal is derived purely from assignment status, never cross-checked against whether the
linked attendance is actually `checked_in`.

---

## 4. Confirmed affected paths (evidence)

Statuses of interest: an assignment is "active/holding a dealer" if
`released_at IS NULL AND status IN ('assigned','on_break','pre_assigned')`.

### A. `checkout-dealer` edge function — misses `on_break`
- **File:** `VinPoker/supabase/functions/checkout-dealer/index.ts` (~L279–296).
- **Evidence:** release query filters `.eq("status","assigned").is("released_at",null)`
  only. A dealer holding an `on_break` assignment row at checkout leaves it orphaned.
- **Result:** orphan `on_break` row, `released_at IS NULL`.

### B. `dealer_check_out` RPC — does not touch `dealer_assignments` at all
- **Object:** live RPC `dealer_check_out(...)`.
- **Evidence:** the live function body closes `dealer_shift_assignments` (the planner
  table) but contains **no reference** to `dealer_assignments` (confirmed by scanning the
  live `pg_get_functiondef` body — zero matches for `dealer_assignments`/`on_break`/
  `released_at`).
- **Result:** any active assignment (assigned **or** on_break) survives checkout via the
  RPC path. This is the exact path that produced the `pgv` incident.

### C. `cleanup_stale_attendance` cron — misses `on_break` (recurs daily)
- **Object:** live RPC `cleanup_stale_attendance(p_club_id, p_hours)`; cron job
  `cleanup-stale-attendance`, schedule `0 6 * * *` (daily 06:00), calls
  `cleanup_stale_attendance(NULL, 24)` (auto-checks-out dealers checked-in > 24h).
- **Evidence:** the `released_assignments` CTE filters `AND da2.status = 'assigned'`
  (live body ~L42). `on_break` rows are detected elsewhere in the function but **not**
  released here.
- **Result:** every long shift that ends on a break leaves an `on_break` orphan, **every
  day**, even if no human ever touches checkout.

### D. `reconcile_ghost_assignments` safety net — cannot see this orphan class
- **Object:** live RPC `reconcile_ghost_assignments(p_club_id)`; cron job
  `reconcile-ghost-assignments`, schedule `*/15 * * * *` (every 15 min).
- **Evidence (live `WHERE`):**
  ```sql
  WHERE da.status = 'assigned'                         -- (1) on_break orphans excluded
    AND da.released_at IS NULL
    AND da.swing_processed_at IS NOT NULL              -- (2) never-swung orphans excluded
    AND da.swing_due_at < NOW() - INTERVAL '60 minutes'
  ```
  It also **never** joins `dealer_attendance` to check `status = 'checked_out'`. Its
  notion of "ghost" is "an *assigned* table whose swing is 60 min overdue and already
  processed" — a **different** class than "assignment whose dealer left".
- **Result:** the `pgv` orphan (status `on_break`, `swing_processed_at IS NULL`,
  attendance `checked_out`) survived **~48 reconcile runs over 12 hours**. This is *why
  the safety net failed*.

### Related P1 consistency gaps (must be addressed in the same program, see §5)
- **P1-a — `perform_swing` race rollback is incomplete.** On a lost INSERT race, the
  `perform_swing` v2 rollback restores `status/version/overtime_minutes` but **omits**
  `last_released_at` and `pool_entered_at` (which the release step already overwrote to
  `NOW()`). `execute_pre_assigned_swing` captures `v_prev_*` and restores these fields —
  proving the omission in `perform_swing` is an unintended regression, not by design.
  Effect: stale `pool_entered_at` makes the pool-cooldown guard wrongly filter the dealer
  for ~1 min, and leaves an `assignment='assigned'` vs `attendance='available'`
  contradiction.
- **P1-b — stale `pre_assigned` survives checkout.** `reconcile_dealer_states` clears
  `pre_assigned_attendance_id` only when `NOT EXISTS(... current_state='pre_assigned')`.
  A dealer who checks out keeps `current_state='pre_assigned'` (no checkout trigger
  resets it), so the stale reference is never cleared and the assignment lingers
  `status='assigned', released_at IS NULL` against a checked-out attendance.
- **P1-c — time-anchor bugs.** `bridge_shift_checkins_to_pool` sets
  `pool_entered_at = GREATEST(scheduled_start_at, checked_in_at)` → a **future**
  timestamp for early check-ins, which floors the cooldown to 0 (guard ineffective) and
  can drive a duplicate-assign UNIQUE collision. Additionally,
  `dealer_attendance.check_in_time` is **never written** by any function, so cooldown
  cannot anchor on true arrival.

---

## 5. Required fix strategy (architecture, not patches)

The class dies only if teardown and the "busy" definition are **centralized**.

### 5.1 One canonical teardown function
Create a single SECURITY DEFINER function, e.g.:

```
release_dealer_assignments(p_dealer_id uuid, p_attendance_id uuid DEFAULT NULL, p_reason text DEFAULT NULL)
```

Behaviour:
- Releases **all** active assignment rows for the dealer:
  `status IN ('assigned','on_break','pre_assigned') AND released_at IS NULL`.
- Matches by **`dealer_id`** (so orphans from old attendances are caught), optionally
  scoped to a specific `attendance_id` when the caller knows it.
- Stamps `released_at = NOW()`, `status = 'completed'`, `release_reason = p_reason`,
  and clears `pre_assigned_attendance_id` / `pre_assigned_at`.
- Idempotent (re-running on an already-released dealer is a no-op).
- Returns a JSON summary `{ released_count, assignment_ids }` for logging.
- **Does not** set `released_at` to a value that inflates payroll — see §5.4.

Call it from **every** teardown path:
- `checkout-dealer` edge function (path A)
- `dealer_check_out` RPC (path B)
- `cleanup_stale_attendance` cron (path C)
- `reconcile_ghost_assignments` / reconcile-repair (path D)
- `perform_swing` / `execute_pre_assigned_swing` rollback branches (where a dealer must
  be released as part of a failed/rolled-back swing)

This collapses A, B, C, D, and P1-b into **one** correct implementation; future teardown
sites reuse it instead of re-deriving (and re-breaking) the release logic.

### 5.2 One shared "busy" predicate
Today `pickNextDealer` Step 5b derives "busy" purely from assignment status. Add a single
source-of-truth rule:

> An assignment counts as **busy/holding a dealer** only if its linked
> `dealer_attendance` is **currently `checked_in`** (i.e. `check_out_time IS NULL` /
> `status = 'checked_in'`).

- Express this as a **shared definition** used by **both** `pickNextDealer` Step 5b and
  `reconcile_ghost_assignments` (e.g. a SQL view `v_active_dealer_assignments`, or a
  shared predicate constant + a DB-side helper). The selection logic and the reconciler
  must agree by construction, so a checked-out dealer can never be "busy" in one and
  "ghost" in the other.
- Widen `reconcile_ghost_assignments` to release any
  `released_at IS NULL AND status IN ('assigned','on_break','pre_assigned')` whose
  attendance is `checked_out` (gate on checked-out so live swings are never disturbed).

### 5.3 Full snapshot/rollback for `perform_swing` race branch (P1-a)
Snapshot the pre-swing attendance markers
(`pool_entered_at`, `last_released_at`, `current_state`, `overtime_minutes`,
`worked_minutes_since_last_break`) into locals at entry, and restore the **full**
snapshot on any race-lost/rollback path — via one shared subroutine shared with
`execute_pre_assigned_swing` so the two cannot diverge again.

### 5.4 Time anchors (P1-c)
- Never set `pool_entered_at` to a future value — use actual arrival
  (`checked_in_at`) or clamp `LEAST(NOW(), …)`.
- Write `dealer_attendance.check_in_time` on check-in (in `_dealer_record_checkin` /
  the pool bridge) so cooldown can anchor on true arrival.
- Inter-swing rest / cooldown must anchor on `GREATEST(last_released_at, pool_entered_at)`
  and must skip a dealer whose anchor is in the future.
- Payroll safety: when the teardown function (§5.1) closes an assignment for an
  already-checked-out attendance, `released_at` should reflect the **checkout time**, not
  `NOW()`, so worked-minutes are not inflated. (The `pgv` manual fix used the checkout
  timestamp `04:57:35`, not `NOW()`, for this reason.)

---

## 6. Fix order & controlled-ops protocol

All DB changes are **source-only first**, then **controlled live apply** with a
before/after snapshot, per the Dealer Swing production-patch protocol
(`VinPoker/.claude/skills/supabase-ops/SKILL.md` + project CLAUDE.md §4.3).

1. **Controlled orphan cleanup (data, snapshot-first).** One-time sweep of existing
   orphans across all clubs:
   `UPDATE dealer_assignments SET status='completed', released_at = <attendance.check_out_time>`
   `WHERE released_at IS NULL AND status IN ('assigned','on_break','pre_assigned')`
   `AND attendance_id IN (SELECT id FROM dealer_attendance WHERE status='checked_out');`
   Snapshot the matched rows first; verify before/after counts. (The live consistency
   scan currently reports **0** such orphans, because the `pgv` row was already released —
   re-run the scan immediately before any sweep.)
2. **Source-only migration / function PR** — the canonical `release_dealer_assignments`
   function (§5.1) + the shared busy predicate / view (§5.2), authored but **not applied**.
   Re-check the migration slot vs live max before choosing a filename; **never** edit old
   migrations; **no** `supabase db push` / `deploy_db=true`.
3. **Call-site updates** — edge `checkout-dealer`, RPC `dealer_check_out`,
   `cleanup_stale_attendance`, swing rollback paths — all routed through the canonical
   function.
4. **Reconcile predicate update** — `reconcile_ghost_assignments` (and
   `reconcile_dealer_states` Step 5 for the stale `pre_assigned` ref) to the shared
   predicate.
5. **Tests / invariants** — §7, against a seeded fixture DB, in CI.
6. **Controlled apply only after review** — snapshot live function bodies → apply the
   approved object(s) → verify live body + grants + `schema_migrations` untouched →
   focused post-apply verification → rollback note. One concern per apply.

**Suggested PR split (separate session, after this doc is reviewed):**
- **PR 1:** canonical teardown function + shared busy predicate/view + reconcile/cleanup
  predicate (source-only).
- **PR 2:** call-site updates (edge / RPC / cron) + tests/invariants.
- **PR 3:** `perform_swing` rollback snapshot + bridge time-anchor fixes.
(PR 1 may absorb call-sites if kept small, but still source-only/dark first, with a
separate controlled apply.)

---

## 7. Verification matrix / CI invariants

Each row is a test against a seeded fixture DB. All must pass before controlled apply.

| # | Scenario | Expected result |
|---|----------|-----------------|
| V1 | Dealer checks out while holding `status='assigned'` assignment | 0 active assignments remain for that dealer (`released_at` stamped) |
| V2 | Dealer checks out while holding `status='on_break'` assignment | 0 active assignments remain (the `pgv` case) |
| V3 | Dealer checks out while `pre_assigned` | 0 active assignments; `pre_assigned_attendance_id`/`current_state` cleared |
| V4 | `cleanup_stale_attendance` runs on a >24h dealer with an `on_break` assignment | both `assigned` and `on_break` assignments released |
| V5 | `reconcile_ghost_assignments` runs with a checked-out dealer holding `assigned`/`on_break`/`pre_assigned` orphan | orphan released within one run (regression test for the "48 runs" gap) |
| V6 | `pickNextDealer` evaluated for a dealer whose only active assignment is tied to a **checked-out** attendance | dealer is **not** treated as busy (eligible) |
| V7 | Early check-in before scheduled start | no `dealer_attendance.pool_entered_at > NOW()` row exists |
| V8 | Full `process-swing` tick (success **and** forced-exception paths) | `club_processing_locks` empty afterwards (lock released) |
| V9 | Forced `perform_swing` race-loss | attendance markers byte-identical to pre-swing snapshot (rollback identity) |
| V10 | Cross-attendance invariant | at most one `released_at IS NULL` active assignment per **`dealer_id`** (not per attendance) |

**Standing CI invariants (assert continuously against fixtures):**
- **INV-1 (no orphans):** after any teardown path, `0 rows` where
  `released_at IS NULL AND linked attendance.status='checked_out'`.
- **INV-2 (busy ⇔ reality):** for every dealer, Step-5b "busy" ⇔
  `EXISTS(active assignment with checked_in attendance)`.
- **INV-3 (rollback identity):** swing race-loss leaves attendance markers unchanged.
- **INV-4 (one active per dealer_id):** ≤ 1 active assignment per dealer_id.
- **INV-5 (lock released):** `club_processing_locks` empty after a full tick.
- **INV-6 (time anchors):** no `pool_entered_at > NOW()`; cooldown never picks a dealer
  whose `GREATEST(last_released_at, pool_entered_at) > NOW() - minRest`.
- **INV-7 (reconcile completeness):** seeded `on_break` orphan on a checked-out dealer is
  released in one `reconcile_ghost_assignments` run.

---

## 8. Explicit non-goals (this docs PR)

- ❌ No DB apply, no `supabase db push`, no `deploy_db=true`.
- ❌ No migration authored or applied in this PR.
- ❌ No production data cleanup executed in this PR.
- ❌ No behaviour change — **docs only**.
- ❌ No edit to `pickNextDealer`, `perform_swing`, `dealer_check_out`,
  `cleanup_stale_attendance`, `reconcile_*`, `process-swing`, or any Edge/RPC/cron object.

The implementing work happens in a **separate, owner-gated session** following §6.

---

### Appendix — incident reference
- Dealer: `pgv` (`dealer_id 50d6ef59-…`, tier C), club `22222222`.
- Orphan row: `dealer_assignments.id = 894ebe08-…`, table Bàn 5 (`1091dee1-…`),
  `status='on_break'`, `released_at=NULL`, tied to checked-out attendance
  `10ffed95-…` (checkout `2026-06-17 04:57:35+07`).
- Manual data fix applied 2026-06-17 16:58 (+07): set `released_at = '2026-06-17 04:57:35+07'`,
  `status='completed'`, guarded `WHERE id=… AND released_at IS NULL AND status='on_break'`.
  Next cron tick auto-assigned `pgv`. No schema/migration change; payroll unaffected
  (released_at = checkout time, not NOW()).
- Live cross-club consistency scan after the fix: **0** orphans, **0** duplicate active
  attendance, **0** multi-assignment tables — confirming the single orphan was the only
  live instance at that time. The **code paths** that create orphans remain until §5 is
  implemented.
