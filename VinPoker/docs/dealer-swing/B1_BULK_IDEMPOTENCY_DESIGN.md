# B1 — Bulk-Path Idempotency Design Contract (B1.0, docs-only)

> Roadmap item 8. **B1.0 = design contract only** (no code). Implementation (B1.1+) is a later,
> owner-gated, source-only step. Locked decisions go to memory + this doc's §9 after owner review.
> Riskiest paths here mutate live dealer assignments/breaks — design first, like B2.0.

## 1. Context

`mass-assign` and `manage-break` are bulk / multi-write edge paths with **no request-level
idempotency**. A double-click, an aggressive client retry, or a network retry firing twice can
produce **double assignments**, **duplicate break rows**, or an **unintended break extension**.
The roadmap is explicit: do **not** mechanically copy `assign_dealer_to_table`'s Step-0 dedup —
define a *bulk* contract that answers key scope, TTL, cached-result semantics, and request-hash
composition.

## 2. Verified current model (ground-truthed, read-only)

### 2.1 `mass-assign` (123 lines)
- Auth: `decodeJWT` → `uid`; `is_club_dealer_control(uid, club_id)` gate (403 otherwise).
- Body: `{ club_id, shift_id? }`.
- Computes a batch-consistent `swing_due_at`, then delegates to
  `fillEmptyTables(admin, club_id, shift_id, …, swingDueAt)` (`_shared/dealer-utils.ts`).
- Writes: `dealer_assignments` (via `fillEmptyTables`), one `audit_logs` row per assignment,
  Telegram (fire-and-forget side-effect).
- **Idempotency today: NONE.**
  - *Sequential retry* → `fillEmptyTables` finds no empty tables → returns **0 assigned** — which
    reads to the operator as a failure, even though the first call succeeded.
  - *Concurrent duplicate* (two requests before either commits) → both see the same empty tables →
    **double-assign race**.

### 2.2 `manage-break` (461 lines, multi-action) — per-action idempotency audit
| action | writes | natural idempotency | gap |
|---|---|---|---|
| `start` | `dealer_breaks` insert + `dealer_assignments` CAS (`version`) + `transition_dealer_state` | CAS guards the concurrent assignment flip; if an **open break** exists it **EXTENDS** instead of inserting | **NOT idempotent**: a *sequential retry* adds `duration_minutes` again (unintended extension); a *concurrent* double-start before commit → both see no open break → **two break rows** |
| `end` / `return_from_break` | `complete_dealer_break` RPC | completing a non-existent open break is a no-op | low risk |
| `tournament_break` | `tournament_break_all_tables` RPC (bulk, all tables) | depends on the RPC | **bulk** — a double-submit may re-break every table → medium risk |
| `meal_break` | `startMealBreak` (guarded by `current_state = 'available'`) | second submit → state ≠ available → 400 | partial natural idempotency |
| `end_meal_break` | `endMealBreak` (returns `already_ended`) | idempotency-aware already | low risk |

### 2.3 The single-path pattern we must NOT mechanically copy — `assign_dealer_to_table` v2 (mig `20260801000005`)
- Signature carries `p_idempotency_key TEXT DEFAULT NULL` (**client-supplied, optional**).
- STEP 0: if the key is present and a `dealer_assignments` row already has it → `RETURN` that row
  with `idempotent: true`, before any side effect.
- The key is stored **on the single effect row** (`dealer_assignments.idempotency_key`); the cached
  result **is** that one row.
- **Why it does not transfer to bulk:**
  1. There is **no single target row** for a bulk op (mass-assign creates N rows) or for a
     break-`start` (the effect spans `dealer_breaks` + `dealer_assignments` + a state transition).
  2. The cached result must be the **aggregate response** (N assignments / the break summary),
     not one row.
  3. The concurrent-claim must live in a store **separate from the (multi-row) effect** so the
     "first one wins" decision is a single atomic insert.

> Confirmed: **no dedicated idempotency-store table exists** (only per-RPC `idempotency_key`
> columns like on `dealer_assignments`). B1 introduces one for aggregate bulk responses.

## 3. Design contract — decisions

1. **Client-supplied idempotency key (primary).** Reuse the *proven* `assign_dealer_to_table`
   approach: the frontend generates ONE fresh UUID per logical user action (one mass-assign click,
   one break-start click) and **resends the same key on retry**. The key is **optional** (absent →
   the edge behaves exactly as today). A server-derived content hash is used only as a *secondary
   safety fingerprint* (decision 5), never as the dedup identity (time-bucketed hashes are fragile:
   too coarse collides distinct actions, too fine fails to dedup a retry).
2. **Action-instance scope — NOT club scope.** The key identifies ONE user action; two legitimately
   distinct mass-assigns for the same club must not collide. A `scope` label column
   (`mass-assign` / `manage-break:start` / `manage-break:tournament_break`) is recorded for
   observability + cleanup only — never used to *group* dedup.
3. **Dedicated store `edge_idempotency_keys`** (separate from the effect rows), caching the whole
   aggregate response:
   `key text PRIMARY KEY, scope text, club_id uuid, actor_id uuid, request_fingerprint text,
    status text CHECK in ('in_progress','completed'), response jsonb, created_at timestamptz,
    expires_at timestamptz`.
   Atomic claim = `INSERT … ON CONFLICT (key) DO NOTHING` (the inserter wins and proceeds; a loser
   reads the existing row).
4. **Flow (per request that carries a key):**
   - **claim:** `INSERT (status='in_progress', expires_at=now+TTL) ON CONFLICT (key) DO NOTHING`.
   - **won** → execute the real work → `UPDATE SET status='completed', response=<result>` → return result.
   - **lost + completed** → return the **cached `response`** (idempotent replay — bulk shows the
     ORIGINAL "N assigned", not "0"; break shows "started", not a second extension). ✓
   - **lost + in_progress** → `409` (or `425 Too Early`) "đang xử lý, thử lại sau"; the client must
     **not** re-execute → this is what kills the concurrent double-assign race.
5. **Fingerprint (key-reuse safety).** `request_fingerprint` = a hash of the **normalized** payload
   (`action`, `club_id`, `shift_id`, **sorted** `table_ids`/`dealer_ids` if present,
   `duration_minutes`, `attendance_id`). On a key-hit whose fingerprint **differs** → `422`
   (the same key was reused with a different body = a client bug). Arrays are **sorted** so request
   order does not change the fingerprint. *(This is where "include sorted table/dealer IDs in the
   hash" belongs — the safety check, not the dedup identity.)*
6. **TTL = 24h** (comfortably covers any client/network retry window) + **lazy delete-expired** on
   each claim (`DELETE WHERE expires_at < now()`, mirroring `try_acquire_club_lock`'s self-cleanup);
   an hourly cleanup cron is optional. No unbounded growth.
7. **Security:** `edge_idempotency_keys` is **service_role-only** (`REVOKE … FROM PUBLIC, anon,
   authenticated; GRANT … TO service_role`). Edge functions already use the service-role key. It
   stores `actor_id` + cached `response` → strictly internal.
8. **Backward-compatible + staged.** The key is optional; the **edge ships first** (accepts the key,
   no-ops when absent) → the **frontend adds keys later** → dedup activates. Mirrors B2's
   DB-first / edge-second / frontend-last.

### Scope (first cut)
- **In scope** (write-heavy, not naturally idempotent): `mass-assign`, `manage-break:start`,
  `manage-break:tournament_break`.
- **Deferred** (already naturally idempotent — document, don't over-engineer): `end` /
  `return_from_break` (no-op `complete_dealer_break`), `meal_break` (state guard), `end_meal_break`
  (`already_ended`). Add keys later only if duplicates are actually observed.

## 4. Backward-compat + migration safety
Additive: a **new table only**; no existing object altered. Edge accepts an **optional** key. The
migration is idempotent (`CREATE TABLE IF NOT EXISTS`, idempotent grants). Source-only; controlled
apply; **no `schema_migrations` write, no `db push`, no `deploy_db`**.

## 5. Rollback
- B1.1 (DB): `DROP TABLE IF EXISTS public.edge_idempotency_keys;` (purely additive → safe). Snapshot
  in `docs/emergency_rollbacks/`.
- B1.2 (edge): redeploy the current key-less edge functions.
- B1.3 (frontend): key-send is additive — harmless even if the table/param is absent (edge no-ops).

## 6. Test cases (golden, for B1.1+)
- `mass-assign`: first call assigns N → immediate retry **same key** returns cached **N** (not 0);
  **concurrent** duplicate → one assigns, the other `409`, total assigned **== N** (no double-assign);
  **different key** → independent assign.
- `manage-break:start`: first "started" → retry **same key** → cached "started" (no second extension,
  no second `dealer_breaks` row); concurrent dup → one row, the other `409`.
- `tournament_break`: retry **same key** → cached `affected_tables` (no second all-table break).
- **fingerprint mismatch** (same key, different club/payload) → `422`.
- **no key** (old client) → behaves exactly as today (zero regression).
- **TTL expiry** → the key becomes reclaimable.

## 7. Staged path (each its own owner-gated PR)
- **B1.1 — DB foundation (source-only):** `edge_idempotency_keys` table + a small helper pair
  `idem_begin(p_key, p_scope, p_club, p_actor, p_fingerprint, p_ttl_seconds) → jsonb
  {claimed, status, response, fingerprint_match}` and `idem_complete(p_key, p_response) → boolean`
  (SECURITY DEFINER, service_role-only, search_path=public, self-cleaning) + rollback. Controlled
  apply (owner-gated, Management-API pattern).
- **B1.2 — edge wiring:** `mass-assign` + `manage-break` accept an optional
  `idempotency_key` (+ compute the fingerprint server-side); `idem_begin` → on claim execute then
  `idem_complete`; on completed-replay return the cached body; on in-progress return `409`; on
  fingerprint mismatch `422`. Deploys via the fixed edge list on merge (owner-gated).
- **B1.3 — frontend:** generate + resend a per-action UUID key for the mass-assign button, the
  break-start action, and the tournament-break action. Dedup goes live.

## 8. Acceptance (mirrors the roadmap)
Bulk-path key contract documented (this doc); a retried request returns the **cached aggregate
result**; no double-assign / duplicate break row under concurrent duplicates; old (key-less) clients
unaffected.

## 9. Open questions for owner sign-off (lock at B1.0 review)
1. **Key source:** client-supplied UUID (recommended — reuses the `assign_dealer_to_table` pattern)
   vs a server-derived content hash?
2. **TTL = 24h?** Cleanup lazy-on-claim only, or also an hourly cron?
3. **Concurrent in-progress duplicate →** `409` "thử lại sau" (recommended) vs block-and-wait then
   return the cached result?
4. **First-cut scope** = `{mass-assign, manage-break:start, manage-break:tournament_break}`, defer the
   naturally-idempotent actions — OK?
5. **Storage shape:** a dedicated table + helper RPC pair (recommended) vs inline SQL inside each
   edge function?
6. **Staged order** B1.1 (DB) → B1.2 (edge) → B1.3 (frontend), DB-first like B2 — OK?

## 10. Guardrails
B1.0 = **docs-only** (markdown under `docs/dealer-swing/`). NO code / DB / migration / RPC / edge /
frontend / deploy / `pickNextDealer` / `swingPolicy` / lock changes. Draft PR only. Stage the explicit
path; revert `public/version.json` if touched. Branch `agent/dealer-swing-b1-0-idempotency-design` off
latest `origin/main`.
