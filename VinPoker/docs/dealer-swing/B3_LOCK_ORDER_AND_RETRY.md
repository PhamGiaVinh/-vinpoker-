# B3 — Lock-Order Contract + Selective Retry (docs-only)

> Roadmap item 11. **Docs-only**, by design: the roadmap mandates "**no blanket retry wrapper**;
> bounded retry ONLY on paths *proven* to hit serialization/deadlock." A0 froze a healthy baseline
> (no observed deadlocks). So B3 = the canonical lock order + a retry/instrumentation spec gated on
> proof. Standardizing the order + wiring retry are later, owner-gated source-only patches.

## 1. Why
`perform_swing`, `execute_pre_assigned_swing`, and `reconcile_dealer_states` all mutate the same
hot tables — `dealer_assignments`, `dealer_attendance`, `dealer_breaks` — but **not in a consistent
order**. Inconsistent acquisition order across concurrent transactions is the textbook deadlock
(AB-BA) condition. This doc fixes the *order* as a contract and defines where bounded retry belongs.

## 2. Verified current row-touch order (ground-truthed from the latest definitions)

| RPC (latest migration) | First lock | Observed touch order |
|---|---|---|
| `perform_swing` (`20260925000000`) | **`SELECT … dealer_assignments da … FOR UPDATE OF da`** (the outgoing assignment, explicit) | dealer_assignments → dealer_attendance → dealer_breaks |
| `execute_pre_assigned_swing` (`20260817000003`) | implicit (first `UPDATE`) | **dealer_attendance** → dealer_assignments → dealer_attendance → dealer_breaks → dealer_assignments → dealer_attendance |
| `reconcile_dealer_states` (`20260812000001`) | implicit (first `UPDATE`) | **dealer_attendance** → dealer_assignments → dealer_attendance → dealer_assignments |

**The hazard:** `perform_swing` takes `dealer_assignments` **first** (explicit `FOR UPDATE`), while
`execute_pre_assigned_swing` and `reconcile_dealer_states` take `dealer_attendance` **first** in
places. Two transactions that grab these two tables in opposite orders can deadlock.

## 3. Concurrency reality (blast radius)
- Within one club, `process-swing` holds the **per-club lease** (`club_processing_locks`, B2) across
  all passes → its own `perform_swing` / `execute_pre_assigned_swing` / reconcile calls are
  **serialized**, so they do **not** deadlock against each other.
- The residual surface is **cross-entry-point**: manual swing/assign buttons (`assign-dealer`,
  `manage-break`), `process-swing-on-dealer-ready`, and `run-dealer-ready-backup` can invoke these
  RPCs **concurrently with the cron** (and the cron holds the lease but those other entry points do
  not). That is the only place an AB-BA can actually occur today.

## 4. Canonical lock-order contract (the rule)
Every transaction that touches more than one of these tables MUST acquire/write them in this order:

```
club_processing_locks (lease, outermost — process-swing only)
  → dealer_assignments     (anchor entity; SELECT … FOR UPDATE the row(s) first)
    → dealer_attendance
      → dealer_breaks
        → game_tables / tournament_* (read-mostly; last)
```

Rationale: the **assignment** is the anchor of a swing; locking it first (as `perform_swing`
already does) and only then touching attendance/breaks gives a single global order. When multiple
assignment rows are locked in one statement, add a deterministic `ORDER BY id` to the
`SELECT … FOR UPDATE` so row-level acquisition is also consistent.

## 5. The real fix vs the band-aid
1. **Real fix (preferred, deferred):** reorder `execute_pre_assigned_swing` and
   `reconcile_dealer_states` so they lock `dealer_assignments` (FOR UPDATE) **before** any
   `dealer_attendance` write — matching `perform_swing`. This removes the AB-BA surface entirely.
   It is a behavior-adjacent RPC change → its own owner-gated, source-only migration + golden replay
   (NOT in this docs PR).
2. **Band-aid (only if contention is proven):** bounded retry on the *caller* (see §6). Retry treats
   the symptom; the order fix removes the cause. Do the order fix first when scheduled.

## 6. Selective retry spec (NOT wired here)
- **Scope:** ONLY wrap the specific RPC calls that PROOF (§7) shows hit `40001`
  (serialization_failure) or `40P01` (deadlock_detected). No blanket wrapper around all RPC calls.
- **Where:** the edge caller layer (e.g. `assign-dealer`, `process-swing`'s `perform_swing` /
  `execute_pre_assigned_swing` calls), not inside the SQL.
- **Pattern (bounded, jittered):**
  ```ts
  async function withSerializationRetry<T>(fn: () => Promise<T>, label: string): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try { return await fn(); }
      catch (e) {
        const code = (e as { code?: string }).code;
        if ((code === "40001" || code === "40P01") && attempt < 2) {
          await new Promise(r => setTimeout(r, 25 * (attempt + 1) + Math.floor(Math.random() * 25)));
          console.warn(`[retry] ${label} ${code} attempt=${attempt + 1}`);
          continue;
        }
        throw e;
      }
    }
  }
  ```
  Max 2 retries; tiny jittered backoff; logs the SQLSTATE + attempt (feeds C3). Idempotency: these
  RPCs use CAS (`version`) + the executor is restart-safe, so a retried call is safe.

## 7. Instrumentation — how to PROVE contention (the gate for §6)
Wire/observe, then decide:
- **Postgres:** `SELECT deadlocks FROM pg_stat_database WHERE datname = current_database();` over time;
  deadlock detail in the Supabase Postgres logs (`deadlock detected`).
- **Edge:** log the SQLSTATE on every RPC error in `assign-dealer` / `process-swing` (extend the
  existing error logs to include `error.code`), correlated by the **C3 `trace_id`**.
- **Decision rule:** only wire §6 retry on a call site that shows recurring `40001`/`40P01` in logs;
  otherwise leave it — retry on a non-contended path only hides real errors.

## 8. Acceptance (roadmap)
A single documented lock-acquisition order across the three RPCs (this doc); contention hotspots
identified (§3); bounded retry specified for proven paths only, with **no blanket wrapper** (§6);
instrumentation to prove contention defined (§7).

## 9. Guardrails
B3 = docs-only (markdown under `docs/dealer-swing/`). NO code / DB / migration / RPC / edge /
frontend / deploy. The order-standardization (§5.1) and retry wiring (§6) are separate, owner-gated,
source-only follow-ups gated on §7 proof. Draft PR only.
