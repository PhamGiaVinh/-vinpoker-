# GE-2 Runtime Plan — Online Poker Closed Alpha (play-money)

**Status:** PLAN (GE-2A). Nothing in this document is applied or enabled by merging it.
**Module:** Online Poker Game Engine only. Isolated from all business-ops modules.
**Audited:** 2026-06-13 — source on `origin/main`, live DB via read-only `supabase migration list --linked` (project `orlesggcjamwuknxwcpk`).

The owner's framing: the Game Engine continues **in parallel** as a player-retention
feature, but stays sandbox / **play-money** / **closed-alpha** — never real-money
production, and never coupled to business-ops modules.

Companion docs: `GAME_ENGINE_SPEC.md` (engine behavior contract),
`../agent-handoffs/game-engine-core.md` (session history GE-1 → GE-1.6).

---

## 1. Current source ↔ live DB gap (verified)

| Layer | Source (`origin/main`) | Live DB |
|---|---|---|
| Pure NLH engine `supabase/functions/_shared/pokerEngine/` (15 files, 83 tests, settlement-hardened GE-1.6) | ✅ merged (`defdf14`) | n/a — pure TS, no runtime |
| `20260817000000_online_poker_core.sql` — 10 tables + RLS | ✅ on main | ❌ NOT applied |
| `20260817000001_online_poker_realtime.sql` — guarded publication | ✅ on main | ❌ NOT applied |
| `op_*` RPCs | ❌ do not exist | ❌ none |
| Online-poker Edge Function entrypoint | ❌ does not exist (only `_shared/`) | ❌ none deployed |
| Frontend table UI | ❌ none (zero `@engine`/`pokerEngine` refs under `src/`) | ❌ none |

The runtime is fully dark. The gap is exactly two source-only migrations plus the
not-yet-written Patch C runtime layer.

## 2. Exact migrations involved (audited 2026-06-13)

### `20260817000000_online_poker_core.sql` — risk: LOW
Additive + idempotent (`CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS` →
`CREATE POLICY` everywhere); touches ONLY `public.online_poker_*`. Ten tables:
`tables, player_accounts, seats, hands, hand_seats, hand_events, actions,
hand_secrets, hand_snapshots, chip_ledger`. Already authored with the right
backstops:

- ONE active hand per table (partial unique index), ONE seat per user per table.
- Non-negative chip CHECKs everywhere; `bb > sb`; signed ledger deltas (`amount <> 0`,
  `balance_after >= 0`); **NOT NULL** UNIQUE `idempotency_key` on actions AND ledger.
- `engine_version` per hand (deterministic replay pinning), `state_version`
  (optimistic CAS), `act_deadline` (timeout sweep), `shuffle_commit/reveal`
  (provable-fair, Phase-3).
- Secrecy: `online_poker_hand_secrets` is ENABLE + **FORCE** RLS with **no policy**
  (deny-all; readable only by SECURITY DEFINER / service_role). Public rail tables
  carry public state only, SELECT-only policies. **Zero write policies** — all writes
  arrive only with Patch C's SECURITY DEFINER RPCs.
- Table/column COMMENTs document every secrecy and play-chip boundary in the DB itself.

Rollback: drop 10 empty tables. Blast radius before Patch C: zero (nothing reads them).

### `20260817000001_online_poker_realtime.sql` — risk: LOW (depends on 000000)
`REPLICA IDENTITY FULL` + `ALTER PUBLICATION supabase_realtime ADD TABLE` for exactly
`online_poker_hands`, `online_poker_hand_seats`, `online_poker_seats` — each ADD
guarded via `pg_publication_tables`, publication-existence guarded, re-runnable.
Secrets and snapshots are deliberately NOT published.

**GE-2B verify item:** rail policies are `FOR SELECT USING (true)` — confirm whether
the `anon` role holds table grants (Supabase default grants may allow anonymous rail
reads). Closed alpha likely wants authenticated-only; if so, a tiny follow-up policy
migration rides with GE-2C.

## 3. ⚠️ Migration lineage collision — `20260818000001` (flagged, NOT engine's to fix)

`origin/main` contains **two files sharing one version slot**:

```
20260818000001_payroll_b5_saved_net_recombine.sql
20260818000001_tv_displays_pairing.sql
```

Live `schema_migrations` already records version `20260818000001` — only ONE of those
two bodies can be live under it, and version-based tooling will never apply the other.
Same class of issue as the collisions fixed by PR #10. **Resolution belongs to a
dedicated migration-lineage session** (verify which body is live via object checks,
renumber the other source file). Engine work is not blocked, but:

> **RULE for all GE-2 work: new migration files use slot `20260819000000` or later**
> until the `20260818000001` collision is resolved. Always re-verify the latest slot
> against `origin/main` AND live `schema_migrations` before creating a file.

## 4. Closed-alpha scope (hard boundaries)

- **Play chips only.** `bigint` play chips, explicitly NOT real money (the schema's
  own COMMENTs say so). Chips enter via daily claim / admin grant only.
- **No real wallet. No payout. No cashout to money.** `chip_ledger.type='cashout'`
  only returns table chips to the play wallet.
- **No staking, no bankroll, no cashier, no receipts linkage.** The schema references
  only `public.clubs` and `auth.users` — zero FKs into business-ops tables, and it
  stays that way for the whole closed alpha.
- **No production real-money tables.** Tables are admin-created, global-lobby
  (`club_id NULL`) only in v1.
- **Access:** closed-alpha allowlist (see §5/§6); everything behind a feature flag
  that defaults OFF.
- **Isolation:** new routes under `/poker/*`; no shared components with
  Tracker/Floor/Cashier; the client bundle keeps zero engine imports (wire JSON only).

## 5. Security architecture

| Risk | Mitigation |
|---|---|
| Spoofed actor | Every RPC binds the actor to `auth.uid()` — never to a payload field (the Seat-Assignment P0-guard lesson). Seat ownership is checked against `online_poker_seats` inside the same transaction. |
| Client deciding outcomes | Engine re-validates every intent server-side (`validateAction` / `applyAction`); the client sends `ActionRequest` intent only. The vite build still has no `@engine` alias — the client *cannot* embed the rules. |
| Hole-card leakage | Deny-all FORCE-RLS `hand_secrets`; never in realtime; public projections are hole-card-free by construction (GE-1.5 wire views + secrecy tests). Own cards only via `op_get_my_hole_cards`. |
| Double-submit / retries | Durable UNIQUE `idempotency_key` (replayed key ⇒ stored response returned, never re-applied) + `state_version` CAS + the one-active-hand index as a last-resort backstop. |
| Replay / disputes | Append-only `online_poker_actions` + `hand_events`, `engine_version` pinned per hand; GE-1.5/1.6 `replayHand` + 17 golden fixtures prove bit-for-bit determinism. |
| Stalling / disconnects | `act_deadline` + service-only `op_timeout_sweep` → engine `forcedTimeoutAction` (check if free, else fold). |
| Anonymous rail reads | Verify anon grants at GE-2B; tighten to authenticated-only if needed. |
| Accidental runtime enablement | Feature flag (`online_poker_config.enabled`) defaults **false** in the schema itself; every RPC and the Edge function check it FIRST and refuse. Flipping it is an owner-approved controlled operation with its own report. |

## 6. Runtime architecture (Patch C / GE-2C design)

```
client (web UI now, Godot later)
   │  intent only: ActionRequest {handId, seat, type, amount?, idempotencyKey}
   ▼
Edge Function `online-poker-action` (THIN — the only place engine TS executes)
   │  flag check → auth → calls op_submit_action RPC
   ▼
op_* SECURITY DEFINER RPCs — ONE Postgres transaction per action:
   1. feature flag check (enabled=false ⇒ refuse, runtime stays dark)
   2. actor = auth.uid(); seat-ownership check
   3. idempotency: INSERT online_poker_actions ON CONFLICT(key) ⇒ return stored response
   4. lock the hand row (FOR UPDATE) + state_version CAS
   5. rebuild authoritative HandState = public projection ⊕ secrets (deck, holes)
   6. engine adapter: applyAction → {state', events} | rejection (classifyActionError)
   7. persist: hands (CAS bump), hand_seats, hand_events (seq continues), snapshot every N
   8. commit → realtime emits postgres_changes on the 3 published rail tables
   ▼
clients re-render public state; private cards ONLY via op_get_my_hole_cards
```

- **Engine adapter** (new pure-TS module beside `pokerEngine/`): state
  serialize/deserialize through the GE-1.5 contracts (`ChipString` ⇄ `bigint`,
  `toWirePublicState`, `envelopeEvents`). SQL never re-implements poker rules — the
  TS engine is the single rules authority.
- **RPC surface v1:** `op_sit_down`, `op_stand_up`, `op_start_hand`,
  `op_submit_action`, `op_get_my_hole_cards`, `op_claim_daily_chips`,
  `op_timeout_sweep` (service-only). All SECURITY DEFINER with pinned `search_path`.
- **Deal path:** server shuffles with `cryptoRng32` at `op_start_hand`; secrets row
  stores full deck + per-seat holes; `engine_version` pinned. Provable-fair
  commit-reveal (`provableFair.ts`) stays optional Phase-3.
- **Deploy coupling (important):** merging GE-2C auto-deploys the Edge Function
  (normal push-to-main behavior). That is acceptable ONLY because it ships **dark**:
  flag OFF ⇒ every entry refuses. DB migrations remain manually gated as always.

## 7. PR sequence

| PR | Content | Mode | Gate |
|---|---|---|---|
| **GE-2A** (this) | Runtime plan docs | docs-only | — |
| **GE-2B** | Controlled live apply of `20260817000000` + `000001`: rehearsal ×2 on shadow/branch DB (idempotency proof), preflight (versions absent, no `online_poker_*` objects live), apply file-by-file (never `db push`), schema_migrations bookkeeping +2 rows, post-verify (tables/indexes/RLS, FORCE-RLS deny on secrets as anon AND authenticated, publication = exactly 3 rail tables), rollback note | controlled DB session | GE-2A merged; collision resolved or explicitly accepted by owner |
| **GE-2C** | `op_*` RPC migration (slot ≥ `20260819000000`) + engine adapter (unit-tested against mocked persistence + golden hands) + thin dark Edge Function + flag table default OFF | source-only → controlled apply | GE-2B live |
| **GE-2D** | Closed-alpha UI under `/poker/*`: lobby, table view, realtime rail subscription, action buttons, private cards via RPC; allowlist-gated route; UIUX phase declared per protocol | frontend-only | GE-2C live + flag still OFF until owner smoke |
| **GE-2E** | Retention loop: daily chip claim, hand-history viewer (replay from stored actions), basic leaderboard | frontend + 1 small RPC | GE-2D stable |

Strict order A → B → C → D → E. Never merge frontend that calls a missing RPC;
never apply an RPC migration whose tables don't exist live.

## 8. What GE-2 explicitly does NOT do

- No real-money wallet logic, no payout, no staking/bankroll/cashier integration.
- No changes to Dealer Swing, Payroll, Tracker, Seat/Floor/Cashier, TV Clock, HRC.
- No `supabase db push`, no `deploy_db=true` — ever; applies are file-scoped
  controlled operations.
- No runtime enablement by merge: the flag flip is its own owner-approved operation.
- No Godot integration yet (web UI first; Godot consumes the same wire contract later).

## 9. Next step

**GE-2B controlled apply** — only after this PR is reviewed AND the
`20260818000001` collision is resolved (or explicitly accepted) in its own
migration-lineage session.
