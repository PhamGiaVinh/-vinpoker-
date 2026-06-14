# GE-2 Online Poker — Enablement Runbook (owner-gated)

**Status:** prepared, **NOT executed.** This is the plan for a future **owner-approved, dedicated enablement session.** Nothing here runs until the owner explicitly opens that session. Online poker is **play-money, closed alpha.**

**Project ref:** `orlesggcjamwuknxwcpk` (Supabase, VinPoker prod).

---

## 0. Where we are now (all prep is DONE; runtime is DARK)

| Piece | State |
|---|---|
| GE-2B schema (10 `online_poker_*` tables, RLS, realtime) | **LIVE** |
| GE-2C runtime RPCs (`20260820000000`, 9 `op_*`) | **LIVE**, dark |
| N2/P2 chip-conservation filter (`20260820000002`) | **LIVE**, dark |
| `Database` types regenerated (adds `online_poker_*`) | **MERGED** (#102) |
| GE-2D UI shell (#93) + client data spine (#95) | **MERGED**, dark |
| **Edge fn `online-poker-action`** | **DEPLOYED DARK** 2026-06-14 (`--no-verify-jwt`, v1; unauth→401, with-JWT→403 `disabled`) |
| `online_poker_config.enabled` | **`false`** |
| `FEATURES.onlinePoker` | **`false`** |
| `RUNTIME_LIVE` (`src/lib/onlinePoker/types.ts`) | **`false`** |
| G4 drill harness (`scripts/ge2-online-poker-drill.mjs` + `scripts/ge2-drill/sql/`) | **AUTHORED** (PR #113) |

**Double dark gate now:** the Edge is live but `op_is_enabled()=false` → every op returns `disabled`; the UI shows `PokerComingSoon` (flags false). Enablement lifts these in a **safe order** so there is never a window where users can reach a half-live runtime.

---

## 1. Preconditions to re-verify at the start of the enablement session

```sql
-- 9 op_* RPCs present, flag still false
SELECT count(*) FROM pg_proc p JOIN pg_namespace n ON n.oid=p.pronamespace
WHERE n.nspname='public' AND proname LIKE 'op\_%';            -- expect 9
SELECT enabled FROM public.online_poker_config;               -- expect false

-- N2 fix present (post-sum filtered): status-filter must appear TWICE in the body
SELECT (length(b) - length(replace(b, q, ''))) / length(q) AS occurrences
FROM (SELECT pg_get_functiondef('public.op_submit_action(uuid,uuid,jsonb,jsonb,jsonb,jsonb,int,timestamptz,text)'::regprocedure) AS b,
             '(s->>''status'') IN (''active'', ''folded'', ''allin'')' AS q) t;  -- expect 2
```

- Edge secrets present in the project (standard): `SUPABASE_URL`, `SUPABASE_ANON_KEY`, `SUPABASE_SERVICE_ROLE_KEY`.
- A **disposable test club + table** and **two test auth users** for the G4 drill (never a real player's hand).
- `origin/main` is the build base; no stale worktree.

---

## 2. Enablement order (the safe sequence)

> The DB flag can be ON while the **frontend** flags stay OFF — that is the intended drill window: the runtime is live and directly callable (for the drill), but no real user can reach `/poker` because the UI is still dark. Expose the UI **only after** the drill passes.

```
A. Deploy the Edge function DARK  ✅ DONE 2026-06-14 (v1)
   (cd VinPoker &&) supabase functions deploy online-poker-action --no-verify-jwt
   verified: unauthenticated → 401 {"error":"unauthorized"} (function G2 gate)

B. Verify Edge reachable + still dark  (the 403-with-JWT proof — needs a test login)
   call online-poker-action with a valid Bearer JWT, op:"claim_daily_chips"
   → expect 403 {"error":"online poker is disabled"}  (op_is_enabled=false)
   (or: scripts/ge2-online-poker-drill.mjs disabled-check)

C. Flip the DB flag ON  (runtime live; UI still dark — only direct Edge calls work)
   UPDATE public.online_poker_config SET enabled = true;   -- super_admin only
   SELECT public.op_is_enabled();                          -- expect true

D. Run the G4 LIVE DRILL on a disposable table  (§3)  — via direct Edge calls

E. If the drill PASSES → expose the UI (separate frontend PR):
     FEATURES.onlinePoker = true   AND   RUNTIME_LIVE = true
   build + deploy. The client's live hooks (useLobby/useTableHand) activate; the
   untyped `rails()` cast in src/lib/onlinePoker/client.ts can be dropped (types now exist).

F. Kill switch at any time:  UPDATE public.online_poker_config SET enabled=false;
   (instant, server-side — Edge returns 403; no redeploy needed)
```

**Do not** flip the frontend flags before the drill passes. **Do not** link any `online_poker_*` write to cashier/payroll/staking/real-wallet — play chips only.

---

## 3. G4 live drill (on a disposable table only)

Goal: prove the required server backstops behave on a real hand before any user touches it. **Tooling:** `scripts/ge2-online-poker-drill.mjs` (Edge-path, 2 disposable logins) + `scripts/ge2-drill/sql/*.sql` (service-role, via the keyring helper). See `scripts/ge2-drill/README.md`.

**Setup** (after `enabled=true`, frontend flags still OFF)
1. `scripts/ge2-drill/sql/01_setup_disposable_table.sql` → a disposable `online_poker_tables` row (`name='GE2-DRILL-DISPOSABLE'`, `club_id NULL` = global lobby — **no real club**, sb=25 bb=50, max_seats=6). Copy the returned id into `scripts/.env.ge2-drill.local` `TABLE_ID`.
2. `node --env-file=scripts/.env.ge2-drill.local scripts/ge2-online-poker-drill.mjs setup` → P1/P2 `claim_daily_chips` + `sit_down`, then `start_hand` → a hand exists.

**Checks** — `submit_action` carries client INTENT only; the engine recomputes state, so the two adversarial cases (4, 3) require a **direct service-role** call with a crafted/stale state (clients can't reach that RPC):

| # | Check | Path / file | Expected |
|---|---|---|---|

| # | Check | How | Expected |
|---|---|---|---|
| 1 | **Idempotency replay** | Edge (`drill`): same `idempotencyKey` twice | 1st `ok`; 2nd returns the **stored** response; one `online_poker_actions` row for K; version advances once |
| 2 | **Forbidden seat** | Edge (`drill`): P1 acts on P2's seat | `{"outcome":"forbidden"}` (no write) |
| 3 | **Race lost** | SQL `03_race_lost.sql` (service-role, stale `p_expected_state_version`) | `{"outcome":"race_lost"}` (no write) |
| 4 | **Chip conservation FAIL** | SQL `02_chip_conservation_fail.sql` (service-role, tampered `p_new_state`) | `{"outcome":"rejected","detail":"chip conservation violated"}` — exercises the N2-filtered post-sum |
| 4b | **Chip conservation PASS** | Edge (`drill`): a legal action is accepted | `{"ok":true,...}` (conservation holds; state advances) |
| 5 | **Secrecy** | Edge `get_my_hole_cards` (`drill`) + SQL `04_secrecy_read.sql` | public state has **no** `deck`/`holeCards`; each seat sees **only** its own cards; cross-seat denied |

**Teardown**
- `scripts/ge2-online-poker-drill.mjs teardown` (stand up) + `scripts/ge2-drill/sql/99_teardown.sql` — deletes the disposable hand + table + ledger scoped to `GE2-DRILL-DISPOSABLE` ONLY. Touches **only** `online_poker_*` play tables — no real money, no business-ops tables.

> If any check fails: `UPDATE online_poker_config SET enabled=false;` immediately, fix, re-drill. Never expose the UI on a failed drill.

---

## 4. Rollback / kill

| Scope | Action |
|---|---|
| **Instant off** (master) | `UPDATE public.online_poker_config SET enabled=false;` — Edge returns 403, RPCs refuse |
| **Frontend off** | revert `FEATURES.onlinePoker`/`RUNTIME_LIVE` to false, redeploy |
| **Edge off** | `supabase functions delete online-poker-action` (optional; flag-off already neutralises it) |
| **Full runtime rollback** | `docs/emergency_rollbacks/PRE_GE2C_20260820000000_*` then re-apply nothing — or revert the N2 fix via `PRE_GE2C_N2_20260820000002_*` |

---

## 5. Final report template (fill at the end of the enablement session)

```
Operation name:            enable_ge2_online_poker_closed_alpha
Edge deployed:             online-poker-action (--no-verify-jwt) [YES/NO + version]
online_poker_config.enabled: true/false
FEATURES.onlinePoker:      true/false
RUNTIME_LIVE:              true/false
G4 drill (1 idempotency / 2 forbidden / 3 race_lost / 4 chip-conservation / 5 secrecy): PASS/FAIL each
Disposable table cleaned:  YES/NO
Play-money boundary intact (no cashier/payroll/staking link): YES
schema_migrations changed: NO (enablement is a flag flip + edge deploy, not a migration)
Secrets exposed:           NO
Kill switch verified:      enabled=false → 403
Rollback plan:             §4
Next step:                 monitor closed-alpha; widen access only on owner approval
```

---

## 6. Invariants (unchanged, always)

- **Play-money only.** `online_poker_chip_ledger` is play chips; zero links to cashier/payroll/staking/real wallet/club money.
- **Server-authoritative.** The client sends intent; the engine (in the Edge) decides cards/winner/pot/chips.
- **Hole-card secrecy.** Public `hands.state` never carries `deck`/`holeCards`; a seat sees only its own cards until showdown.
- **Closed alpha.** Expose to a small, known group first; widen only on explicit owner approval.
