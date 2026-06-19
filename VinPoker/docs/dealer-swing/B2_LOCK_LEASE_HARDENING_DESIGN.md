# B2 — Lock-Lease Hardening + Fencing (PREFLIGHT + DESIGN CONTRACT)

> Status: **DESIGN ONLY — no code, no DB, no migration, no RPC, no Edge, no deploy.** This is the
> B2.0 preflight + design contract. Implementation (B2.1, B2.2) is a separate, owner-gated,
> source-only step that follows this doc's approval. Owner Decision 2 (Stage 0, LOCKED) =
> **heartbeat-extend + fencing**. This doc grounds that decision in the exact current model.

## 0. Problem — the "two-brains" risk

`process-swing` runs every **60s** (pg_cron `process-swing-auto`, `* * * * *`,
`migrations/20260530000004_pg_cron_auto_swing.sql`). For each club it takes a **per-club lease lock**
held across **9 mutating passes** (0c/0d/0e/1/1b/R/1.5/2/2.5/3). The lease is **hardcoded 120s**, but a
worst-case single-club run is **80–200s** (Pass 1b circuit-breaker retry loops + Pass 3 sequential
`perform_swing` executions + inline Telegram). When a run overruns 120s, the lease expires and the
next cron tick re-acquires the same club's lock → **two concurrent `process-swing` runners mutating
the same club** → duplicate swings, contradictory state, races the per-club lock was meant to prevent.

## 1. Verified current model (read-only ground-truth)

All in `supabase/migrations/20260725000001_pass1b_circuit_breaker.sql` (the ONLY migration that defines
or touches these — no later migration alters them):

**Table** (`:22-33`):
```sql
CREATE TABLE IF NOT EXISTS club_processing_locks (
  club_id    uuid PRIMARY KEY REFERENCES clubs(id) ON DELETE CASCADE,
  locked_at  timestamptz NOT NULL DEFAULT NOW(),
  locked_by  text NOT NULL DEFAULT 'process-swing',
  expires_at timestamptz NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_club_processing_locks_expires ON club_processing_locks (expires_at);
```
No `lock_token`, no `owner_id`/instance id, no `version`, no heartbeat column. `locked_by` is the
**constant string** `'process-swing'` for every acquirer — it cannot distinguish one run from another.

**Acquire** (`try_acquire_club_lock`, `:40-72`):
```sql
DELETE FROM club_processing_locks WHERE expires_at < v_now;          -- stale reclaim (no buffer)
INSERT INTO club_processing_locks (club_id, locked_by, expires_at)
VALUES (p_club_id, 'process-swing', v_now + (p_timeout_seconds||' seconds')::interval)
ON CONFLICT (club_id) DO NOTHING
RETURNING club_id INTO v_lock_id;                                    -- {acquired: v_lock_id IS NOT NULL}
```
Default `p_timeout_seconds = 120`.

**Release** (`release_club_lock`, `:75-82`) — **UNCONDITIONAL**:
```sql
DELETE FROM club_processing_locks WHERE club_id = p_club_id;         -- deletes WHOEVER holds it now
```

**Cleanup cron** (`cleanup_expired_club_locks`, hourly `cleanup-locks-pass1b`, `:85-121`):
`DELETE FROM club_processing_locks WHERE expires_at < NOW();`

**Caller — process-swing** (`supabase/functions/process-swing/index.ts`):
- Acquire `:499` — `try_acquire_club_lock(p_club_id, p_timeout_seconds: SWING_THRESHOLDS.BASE_LOCK_TIMEOUT_SECONDS)`.
- Constants `:55-57` — `BASE_LOCK_TIMEOUT_SECONDS: 120`, `LOCK_TIMEOUT_PER_TABLE: 10`,
  `MAX_LOCK_TIMEOUT_SECONDS: 300`. **`LOCK_TIMEOUT_PER_TABLE` and `MAX_LOCK_TIMEOUT_SECONDS` are
  defined but UNUSED** — the lease never scales with table count today.
- Per-club loop `:494` — `for (const cid of clubIds)`; the lock is acquired/held/released once per club.
- Release `:3692-3700` — `finally { if (lockAcquired) await release_club_lock(cid) }`.
- 9 mutating passes between acquire and release (0c stuck-fix, 0d reconcile, 0e meal-end, 1 fill,
  1b circuit-breaker, R/1.5 rotation, 2/2.5 pre-assign/initial, 3 swing-exec).

**Blast radius — contained.** Only `process-swing` acquires this lock. Verified: `process-swing-on-dealer-ready`
and `mass-assign` do NOT take it; `run-dealer-ready-backup` uses a *different* advisory cron lock
(`try_acquire_cron_lock`). So fencing touches exactly: the 3 SQL primitives + the one `process-swing`
acquire/hold/release path.

## 2. Failure modes (two, not one)

**FM-1 — Overrun → reclaim → concurrent runners.**
```
t=0    Run A acquires club X lock, expires_at = t+120
t=60   cron tick 2: try_acquire deletes nothing (not expired), INSERT ON CONFLICT → not acquired → tick 2 SKIPS X ✅
t=120  Run A still in Pass 3 (run is 80–200s). Lease EXPIRES.
t=120  cron tick 3: try_acquire DELETEs A's expired row, INSERTs fresh lock → Run C acquires X.
       → Run A and Run C now BOTH mutate club X. ❌ two brains.
```

**FM-2 — Unconditional release deletes the new owner's lock (cascade).**
```
t=125  Run A finishes, finally → release_club_lock(X) → DELETEs the row… which is now RUN C's fresh lock. ❌
t=125  Club X now has NO lock while Run C is still mid-run.
t=180  cron tick: try_acquire succeeds → Run D acquires X → Run C and Run D both mutate. ❌ cascade.
```
FM-2 is why a fix that only scales the lease is insufficient: as long as release is keyed on `club_id`
alone, a late finisher can always delete an active successor's lock. **Release must be token-scoped.**

## 3. Fencing design contract (owner Decision 2: heartbeat-extend + fencing)

**Principle:** a run may only extend/release the lock it actually holds, and may only mutate state
while it still provably holds the lock. Identity is a per-acquisition **fencing token**.

### 3.1 Schema (additive, backward-compatible)
Add to `club_processing_locks` (nullable / defaulted so existing rows + the old code path don't break
mid-deploy):
- `lock_token uuid` — set to `gen_random_uuid()` on each successful acquire; the run's proof of ownership.
- `owner_id text` — the invocation/instance id (e.g. a uuid generated at run start, or a request id) for
  human-readable observability of *which* run holds it. Distinct from `locked_by` (which stays `'process-swing'`).
- (keep `locked_at`, `expires_at`.)

### 3.2 RPC contract
- `try_acquire_club_lock(p_club_id, p_timeout_seconds, p_owner_id)` → `{acquired, lock_token}`.
  Same DELETE-expired + INSERT-ON-CONFLICT, but stamps `lock_token` + `owner_id` and **returns the token**.
  (Keep a backward-compatible overload / default `p_owner_id` so a half-deployed state is safe.)
- **NEW** `extend_club_lock_lease(p_club_id, p_lock_token, p_seconds) → boolean` (heartbeat):
  `UPDATE … SET expires_at = now()+interval WHERE club_id=p_club_id AND lock_token=p_lock_token`;
  return `(rows updated = 1)`. **false ⇒ we no longer own it** (expired+reclaimed, token rotated) ⇒
  the caller MUST stop mutating and exit.
- `release_club_lock(p_club_id, p_lock_token)` → token-scoped delete:
  `DELETE … WHERE club_id=p_club_id AND lock_token=p_lock_token`. A late finisher whose token no longer
  matches deletes 0 rows → cannot clobber the successor (fixes FM-2). (Keep the old unconditional
  signature only if a cleanup path genuinely needs it; otherwise overload with the token form.)

### 3.3 process-swing wiring
- On acquire, capture `lock_token`; thread it through the per-club scope.
- **Per-mutating-pass ownership guard:** before each of the 9 mutating passes, call
  `extend_club_lock_lease(cid, token, leaseSeconds)`. If it returns false → **abort the remaining
  passes for this club** (graceful: log a `lock_reclaimed` event, do not mutate further, move to the
  next club / end). This is the operative meaning of "a state-changing pass acts ONLY while it is still
  the valid owner."
- On finish, `release_club_lock(cid, token)` in the existing `finally`.

### 3.4 Observability
Emit a structured `lock_reclaimed` / `lost_ownership` event (and ideally a row in a small diagnostics
table or the existing audit/metrics channel) whenever an extend returns false or a guard aborts. This is
the data C2 (health strip) and C3 (per-pass metrics) will surface — design the event shape here, persist
it in C3 if not sooner.

## 4. Complementary cheap mitigation — recommend as B2.1 (ship FIRST)

Before the full fencing, **actually use the already-defined-but-unused** `LOCK_TIMEOUT_PER_TABLE` /
`MAX_LOCK_TIMEOUT_SECONDS` to scale the initial lease to realistic run time, e.g.
`leaseSeconds = min(MAX_LOCK_TIMEOUT_SECONDS /*300*/, BASE_LOCK_TIMEOUT_SECONDS /*120*/ + LOCK_TIMEOUT_PER_TABLE /*10*/ × tableCount)`.
- This is a **one-line, near-zero-risk** edge change (pass a larger `p_timeout_seconds`) that immediately
  shrinks the overrun window for big clubs — most FM-1 occurrences vanish because the lease now covers a
  realistic 200s run.
- It does NOT fix FM-2 (unconditional release) or guarantee correctness under a pathological >300s run —
  that's what B2.2 fencing is for. B2.1 buys safety margin cheaply while B2.2 is built/reviewed.

## 5. Staged implementation path (each its own owner-gated PR)

- **B2.1 — Lease scaling (tiny, near-zero risk).** Edge-only: compute `leaseSeconds` from table count
  (using the existing constants) and pass it to `try_acquire_club_lock`. No DB/schema change. Deploys via
  process-swing. Immediately reduces FM-1 frequency.
- **B2.2 — Fencing (source-only migration + process-swing wiring).** Additive columns + token-returning
  acquire + `extend_club_lock_lease` + token-scoped release + per-pass ownership guard + reclaim logging.
  Source-only first → controlled apply (owner-gated, Management-API, snapshot + verify) → deploy edge.
- **B2.3 (optional) — persist reclaim events** if C3 hasn't already; otherwise fold into C3.

## 6. Backward-compatibility & migration safety

- Columns are **additive** (`lock_token`, `owner_id` nullable/defaulted) — existing rows + the old code
  path keep working during a partial deploy.
- RPCs via `CREATE OR REPLACE` (+ overloads so the old signature still resolves until process-swing is
  redeployed) — avoids the overload-bomb history; explicitly drop the old signature only after the new
  edge is live.
- Source-only first; controlled apply via owner-gated `workflow_dispatch` (GitHub Secret token, no chat
  token); NO `db push`, NO `deploy_db`, NO `schema_migrations` write, NO `check_in_time`/payroll change.
- New migration slot re-checked vs live max at author time.

## 7. Rollback strategy (for B2.2)

- **Edge rollback:** revert process-swing to not call `extend`/not thread the token → behaves like today
  (lease only). Instant.
- **RPC rollback:** re-`CREATE OR REPLACE` the prior `try_acquire_club_lock` / `release_club_lock` bodies
  from the pre-apply snapshot; the extend RPC is additive (drop or ignore).
- **Schema rollback:** the added columns are additive and nullable — leaving them is harmless; dropping
  them is a clean `ALTER … DROP COLUMN` (no data dependency). Snapshot kept in `docs/emergency_rollbacks/`.
- B2.1 rollback: change the lease formula back to the constant 120.

## 8. Smoke / acceptance cases (for the future B2.2 code PR)

1. **No double-acquire after scaling (B2.1):** simulate a 150s run on a many-table club; with scaled
   lease (>150s) the next cron tick finds the lock unexpired and SKIPS — no second runner.
2. **Ownership guard aborts on reclaim (B2.2):** force a lease expiry mid-run (shrink lease in a test);
   the next tick reclaims; the original run's next-pass `extend` returns false → it stops mutating and
   logs `lock_reclaimed`; assert no further writes from the original run.
3. **Token-scoped release can't clobber successor (B2.2, FM-2):** run A's token ≠ current row's token →
   `release_club_lock(cid, A_token)` deletes 0 rows; the successor's lock survives.
4. **Extend fails on token mismatch:** `extend_club_lock_lease(cid, stale_token, …)` returns false.
5. **Normal happy path:** acquire → extend across passes → release; single owner throughout; lock row
   gone after release.
6. **No regression** to the normal single-club, fast-run path (lease never needed extending).

## 9. Open questions for owner sign-off (resolve at B2.0 review)

1. **Heartbeat cadence:** extend **per-pass** (recommended — natural boundaries, ≤9 calls/run) vs a timer.
2. **On lost ownership:** **ABORT remaining passes** (recommended) vs attempt re-acquire. Abort is safest
   (the successor already owns the club).
3. **Lease-scaling formula (B2.1):** confirm `min(300, 120 + 10×tableCount)` or another shape.
4. **Reclaim logging target:** dedicated diagnostics row now, or defer persistence to C3 (recommended
   defer; emit structured log immediately).
5. **Ship B2.1 (lease scaling) before B2.2 (fencing)?** Recommended yes — cheap immediate risk reduction.

## 10. Guardrails (this doc + future PRs)

B2.0 is **docs-only**. B2.1/B2.2 are **source-only first → owner-gated controlled apply**. No
`db push` / `deploy_db` / `schema_migrations` write / new swing overload bomb / `check_in_time` /
payroll / pickNextDealer / swingPolicy changes. Blast radius stays the 3 lock primitives + process-swing.
One concern per PR; stop & report; owner gates merge + apply + deploy.
