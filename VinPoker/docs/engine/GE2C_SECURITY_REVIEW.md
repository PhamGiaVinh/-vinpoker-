# GE-2C Security Review — `20260820000000_online_poker_runtime_rpcs.sql`

**Scope:** static review of the online-poker runtime RPC migration (source-only, **not yet applied**).
**Reviewer mode:** SOLO (no multi-agent), read-only static analysis.
**Subject commit:** `9b0fdd1` (PR #74, merged to `origin/main`).
**Companion runtime:** `supabase/functions/online-poker-action/index.ts` (dark Edge fn), `_shared/pokerAdapter/*`.
**Date:** 2026-06-14.

**Verdict: PASS — ready for the owner-approved apply session.** No P0/P1 blockers. Four notes (1×P2, 3×P3/info) below; all are latent or hardening-only and do not block apply. The migration is dark-by-default and every privileged surface is closed to clients.

Line numbers cite `supabase/migrations/20260820000000_online_poker_runtime_rpcs.sql` unless noted.

---

## 1. `enabled = false` gate (dark switch)

**PASS.** `op_is_enabled()` (L61-69) reads the singleton `online_poker_config.enabled` (default `false`, L37) and is the first statement in **every** state-touching RPC:

| RPC | gate line |
|---|---|
| `op_load_action_context` | L88 |
| `op_start_hand` | L139 |
| `op_submit_action` | L223 |
| `op_timeout_sweep` | L344 + L349 (both the outcome and the row filter) |
| `op_get_my_hole_cards` | L376 |
| `op_sit_down` | L415 |
| `op_stand_up` | L496 |
| `op_claim_daily_chips` | L559 |

`op_is_enabled()` itself is the gate, so it is correctly *not* self-gated. Until the migration is applied, the function + table do not exist, so the Edge `isEnabled()` catches the missing-object error and returns `false` ([index.ts:101-108](../../supabase/functions/online-poker-action/index.ts)) — **double gate** (object-absent → dark; object-present + flag false → dark). Flipping `enabled` is itself RLS-restricted to `super_admin` (L48-50). ✓

## 2. Service-role-only write RPCs

**PASS.** The four engine/write RPCs are revoked from every client role and granted only to `service_role`:

- `REVOKE EXECUTE … FROM PUBLIC, anon, authenticated` — `op_load_action_context` (L587), `op_start_hand` (L588), `op_submit_action` (L589), `op_timeout_sweep` (L590).
- `GRANT EXECUTE … TO service_role` only — L597-600.

Because Postgres grants `PUBLIC EXECUTE` by default on first `CREATE FUNCTION`, the explicit `REVOKE … FROM PUBLIC` (run after the `CREATE`s, before the `GRANT`s, all in one `BEGIN…COMMIT`) is required and present. `op_is_enabled` is intentionally granted to `authenticated` too (L596) — it only returns the public flag (the config table itself has a `USING (true)` SELECT policy, L46), so this is not a leak. The Edge calls these with the **service-role** client only; self/client RPCs use the **user** client ([index.ts:81, 87-92](../../supabase/functions/online-poker-action/index.ts)). ✓

> **G3 live proof is deferred to the apply session** (this PR does not apply). Exact queries are in `GE2C_APPLY_RUNBOOK.md` §7 — they must demonstrate `anon = denied`, `authenticated = denied`, `service_role = allowed` for all four write RPCs, not merely "revoked from PUBLIC".

## 3. `auth.uid()` ownership

**PASS.** Two enforcement models, both correct:

- **Self/client RPCs** bind to `auth.uid()` directly and reject `NULL`: `op_get_my_hole_cards` (L369, L373-375), `op_sit_down` (L406, L412-414), `op_stand_up` (L488, L493-495), `op_claim_daily_chips` (L550, L556-558). The actor is **never** read from a parameter — the Seat-Assignment P0-guard idiom.
- **Write RPCs** receive `p_actor_user_id` from the Edge, which derives it *only* from a JWT-verified `auth.getUser(token)` ([index.ts:62-75](../../supabase/functions/online-poker-action/index.ts)) — never from the request body. `op_submit_action` then enforces seat ownership against it: the action's seat must exist in the hand (L252-256) **and** its `user_id` must equal `p_actor_user_id` (L257-259, `forbidden` otherwise). Since the write surface is service-role-only, a client cannot forge `p_actor_user_id`. ✓

## 4. No hole-card / deck leakage

**PASS.** Secrecy holds by construction and by backstop:

- **Public state never carries secrets.** Both write paths reject a public state containing `deck` or any seat `holeCards` *before* persisting: `op_start_hand` (L144-147), `op_submit_action` (L262-265). The Edge builds the public projection only via the engine's `toWirePublicState` (adapter `publicProjection`/`privateView`, [index.ts:22](../../supabase/functions/_shared/pokerAdapter/index.ts)), which has no `holeCards` field at all.
- **Secrets are siloed.** Deck / live-deck / per-seat holes go only to `online_poker_hand_secrets` (L178-183, L320-322), which is deny-all `FORCE` RLS with no policy ([20260817000000:234-235](../../supabase/migrations/20260817000000_online_poker_core.sql)).
- **`op_load_action_context` returns all holes** (L104-109) but is **service-role only** (L587/L597) — unreachable by clients. The Edge consumes it to rebuild state and returns only the caller's `privateView` ([index.ts:242](../../supabase/functions/online-poker-action/index.ts)).
- **`op_get_my_hole_cards`** derives the seat strictly from `WHERE hand_id = … AND user_id = auth.uid()` (L380-381) and reads only that seat's hole secret (L386-387) — a caller can never request another seat's cards. ✓
- Adapter secrecy is unit-proven (`tests/pokerAdapter/secrecy.test.ts`, checks 1-4) and extended here (see item 4 of the session).

## 5. Idempotency

**PASS** (one P2 sharpening, §Notes/N1).

- `op_submit_action`: replayed key returns the stored response without re-applying (L228-232); the durable backstop is the `online_poker_actions.idempotency_key` `UNIQUE` constraint ([core:134](../../supabase/migrations/20260817000000_online_poker_core.sql)) + the response stored in the same row (L327-328).
- `op_sit_down` / `op_stand_up`: dedupe on `online_poker_chip_ledger.idempotency_key` (L423, L500), backed by that column's `UNIQUE` (core:181).
- `op_claim_daily_chips`: deterministic per-UTC-day key `grant_<uid>_<YYYYMMDD>` (L563-564) → at most one grant per user per day.

## 6. `race_lost` (optimistic concurrency)

**PASS.** `op_submit_action` locks the hand `FOR UPDATE` (L235), then guards with a state-version CAS twice: the explicit pre-check (L246-249 → `race_lost`) **and** the `UPDATE … WHERE state_version = p_expected_state_version` (L296), which returns `race_lost` if zero rows matched (L297-299). The Edge retries the load→apply→submit loop ≤ 3× then surfaces `race_lost` without ever double-writing ([index.ts:190-244](../../supabase/functions/online-poker-action/index.ts)). ✓

## 7. Chip conservation

**PASS for the current Edge orchestration; one latent asymmetry — see N2 (P2).** `op_submit_action` requires Σ(seat stacks) + pot to be unchanged across the action (L274-282), with `v_pre_total` taken from the locked `hand_seats` + `v_hand.pot` snapshot and `v_post_total` from the new wire state. It also blocks negative stack/pot (L267-272). The DB `CHECK` constraints (stack/pot/balance ≥ 0) are independent backstops (core schema). Correct **as called today**, because the Edge only ever deals actively-sitting players with chips into a hand.

## 8. No secret logging (G1)

**PASS.** The migration contains **zero** `RAISE NOTICE/LOG/WARNING/EXCEPTION` statements that emit card/deck/hole data — there are no `RAISE` statements at all; all outcomes are returned as structured `jsonb`. The Edge G1 scan was already clean (only the static string `"[online-poker-action] unexpected error"`, [index.ts:96](../../supabase/functions/online-poker-action/index.ts)). ✓

---

## Notes (non-blocking)

### N1 — `op_submit_action` idempotency SELECT is pre-lock (P2, self-healing)
The idempotency `SELECT response` (L228) runs *before* the `FOR UPDATE` (L235). Under a **concurrent** replay of the *same* key, both callers can pass the SELECT (neither sees the other's uncommitted row), then serialize on the hand lock. The first commits (`state_version+1`, action row inserted); the second resumes, re-reads the bumped version, fails the CAS at L246 → returns `race_lost` **before** reaching the `INSERT` at L327 (so no unique-violation abort). The Edge then reloads and the idempotency SELECT now returns the stored response. **Net: safe and self-healing — no double-apply, no unhandled exception.** Sequential replay (the common case: a network-retry) hits the stored response immediately. No change required; documented so a future reader doesn't "fix" it into a real regression.

### N2 — chip-conservation / hand_seats sum is asymmetric vs. the wire seat set (P2, latent; masked by the Edge filter)
`v_pre_total` sums `online_poker_hand_seats` (populated only with `status IN ('active','folded','allin')`, L166-175), while `v_post_total` sums **every** seat in `p_new_state->'seats'` **unfiltered** (L277-278). The `hand_seats` `UPDATE` *is* filtered to `('active','folded','allin')` (L308-309), so the two sums are over **different seat sets** whenever the wire state carries a `sitting_out`/`empty` seat with a non-zero stack.

- **Why it is not a live bug:** the engine's `createHand` keeps `sitting_out` seats in `state.seats` ([hand.ts:78-85](../../supabase/functions/_shared/pokerEngine/hand.ts)), **but** the Edge `handleStart` deals only `status === "sitting" && stack > 0` players ([index.ts:139-141](../../supabase/functions/online-poker-action/index.ts)), so no `sitting_out`/`empty` seat ever reaches a hand today. Pre/post sets coincide → conservation holds.
- **Why it is worth fixing before any Edge change that passes a fuller seat list** (mid-hand sit-out, spectators in state, future multi-table fan-in): such a seat would inflate `v_post_total` and **false-reject every action**.
- **Exact one-line fix** (makes the post-sum symmetric with the pre-sum and the seat UPDATE), to fold into the migration source *before* apply (the file is unapplied) — note it is `CREATE OR REPLACE`, so it can equally ship as a tiny follow-up `20260820000001_*` if the owner prefers not to touch the merged file:

  ```sql
  -- L277-278, add the same status filter the pre-sum and the seat UPDATE use:
  SELECT COALESCE(SUM((s->>'stack')::bigint), 0) + (p_new_state->>'pot')::bigint INTO v_post_total
  FROM jsonb_array_elements(p_new_state->'seats') AS s
  WHERE (s->>'status') IN ('active', 'folded', 'allin');
  ```

  Recommendation: apply the fix at the source before the GE-2C apply session, since the migration has never been applied. Tracked in `GE2C_APPLY_RUNBOOK.md` §3 as a pre-apply checklist item. **Not a blocker** — apply-as-is is safe given the current Edge filter.

### N3 — `op_start_hand` has no durable idempotency key (P3, safe by uniqueness)
Unlike the action/ledger paths, `op_start_hand` takes no idempotency key. A retried start is made safe by the **one-active-hand** guard (L150-153 → `already_active`) plus the `UNIQUE (table_id, hand_no)` and partial-unique active-hand index (core schema): a concurrent/duplicate start either returns `already_active` or aborts on a unique violation — never a second live hand. The only downside is a retry returns an error rather than the original success envelope. Acceptable for system/operator-triggered starts in closed alpha. Consider a `p_idempotency_key` if start ever becomes client-triggered.

### N4 — feature flag is intentionally world-readable (info, by design)
`op_is_enabled` is granted to `authenticated` and `online_poker_config` has a `USING (true)` SELECT policy — the *enabled* boolean is public on purpose (the client needs to know whether to show the lobby). It carries no secret. Writes remain `super_admin`-only. No action.

---

## Cross-cutting confirmations

- All functions are `SECURITY DEFINER SET search_path = public` (L66, L83, L130, L211, L341, L366, L403, L485, L547) — no search-path hijack surface.
- Read-only RPCs are `STABLE` (`op_is_enabled`, `op_load_action_context`, `op_timeout_sweep`, `op_get_my_hole_cards`); write RPCs are (correctly) default `VOLATILE`.
- `op_sit_down` claims the seat atomically via `INSERT … ON CONFLICT (table_id, seat_no) DO UPDATE … WHERE status = 'empty' AND user_id IS NULL` (L455-463) → concurrent claimants: one wins, the other gets `seat_taken`. Wallet is locked `FOR UPDATE` first (L445), so same-user concurrency serializes without deadlock.
- Play-money boundary intact: `op_sit_down`/`op_stand_up`/`op_claim_daily_chips` touch only `online_poker_player_accounts` + `online_poker_chip_ledger` (L455-470, L522-536, L568-576). **Zero** references to cashier / payroll / staking / payout / real-wallet / club-money tables anywhere in the migration. Grant amount is a fixed play-chip constant (L554).

## What this review did NOT cover (out of scope / deferred)
- **Live grant behaviour** (G3) and **live idempotency/forbidden/race** proofs — require the DB; specified in the runbook for the apply session.
- **Realtime payload secrecy** — covered by GE-2B (`hand_secrets` not published; only 3 rail tables in `supabase_realtime`); unchanged here.
- **Load/perf** — out of scope for closed alpha.
