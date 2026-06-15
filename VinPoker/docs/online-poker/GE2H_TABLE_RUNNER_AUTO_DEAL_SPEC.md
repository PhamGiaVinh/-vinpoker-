# GE-2H — Table Runner / Auto-deal Loop (design spec, owner-gated)

**Status: SPEC ONLY. Nothing here is built, applied, deployed, or enabled.** Online poker is
fully **DARK**. This document specifies the *table runner* — the server loop that deals the next
hand automatically — so it can be built (source-only) and later wired in a dedicated, owner-gated
Phase D session. No code, migration, edge deploy, flag flip, or DB write accompanies this doc.

- Frontend gate: `FEATURES.onlinePoker = false` (`src/lib/featureFlags.ts`)
- In-shell gate: `RUNTIME_LIVE = false` (`src/lib/onlinePoker/types.ts`)
- Runtime gate: `online_poker_config.enabled = false` (live DB, super_admin only)
- Project ref: `orlesggcjamwuknxwcpk`

Companions: `docs/engine/GE2_ENABLEMENT_RUNBOOK.md`, `docs/online-poker/GE2_PHASE_D_READINESS.md`.

---

## 0. The problem this solves

Today `op_start_hand` is **manual** — a hand is dealt only when something explicitly calls it.
A real cash table must run itself:

> hand ends → **settle** → **write chips back to seats** → **move button** → **drop busted
> players** → **deal the next hand**, or **wait** if fewer than 2 funded players are seated.

Without this loop, a table plays exactly one hand and then freezes. The runner closes that gap.
It is a **between-hands dealer**; it never decides cards, winners, pots, or chips (the engine
does that). It only decides *when a table is ready for the next hand* and asks the engine to deal.

---

## 1. What is already built (the runner reuses all of it)

| Piece | Where | Reused as |
|---|---|---|
| Pure NLH engine `createHand` / `applyAction` / settlement | `_shared/pokerEngine/*` | deals + settles hands |
| Hand-complete signal | engine `state.status==='complete'`, `hand_complete` event | "hand is over" detection |
| One-active-hand guarantee | partial unique index `online_poker_hands(table_id) WHERE status IN ('dealing','betting')` (`20260817000000_online_poker_core.sql`) | hard "never two hands" backstop |
| `op_start_hand(...)` | `20260820000000_online_poker_runtime_rpcs.sql` | persists a newly-dealt hand |
| `op_submit_action(...)` (CAS + idempotency + chip-conservation) | same migration (+ N2 patch `20260820000002`) | applies actions; settles on the completing action |
| Button advance `nextButton()` | `online-poker-action/index.ts:247` | clockwise button move |
| **Timeout-sweep runner** (edge + cron, secret/GUC, deterministic idem key) | `online-poker-timeout-sweep/index.ts`, `20260903000000_*_cron.sql` | **the exact pattern this runner mirrors** |
| Master kill switch | `op_is_enabled()` ← `online_poker_config.enabled` | runner no-ops when disabled |

**Key consequence:** the runner is small. It adds an *eligibility lister* + an *edge dealer loop*
+ a *cron*, all modelled 1:1 on the shipped timeout-sweep. It changes the engine **not at all**.

---

## 2. Table lifecycle states

`online_poker_tables.status` is the only persisted lifecycle column: `open` · `paused` · `closed`
(operator-controlled). The runner layers **derived runtime states** on top (not stored):

| Derived state | Condition | Runner behaviour |
|---|---|---|
| **active** | a hand row exists in `('dealing','betting')` | skip (a hand is in progress) |
| **idle-eligible** | `open` · no active hand · ≥2 funded seated · cooldown elapsed | **deal next hand** |
| **idle-waiting** | `open` · < 2 funded seated, OR cooldown not elapsed | no-op (wait) |
| **paused / closed** | operator set | skip entirely |

The runner **never** changes `status`. `paused`/`closed` are deliberate operator actions; the
runner only *deals into* `open` tables and *waits* otherwise.

---

## 3. Hand lifecycle states

- **DB** (`online_poker_hands.status`): `dealing → betting → complete` (or `voided`).
- **Engine** (`state.street`): `preflop → flop → turn → river → showdown → complete`.
- `toAct === null` means the **betting round** is closed (the engine will advance the street and
  re-open betting) — **not** that the hand is over.
- `state.status === 'complete'` (with `street` `'complete'` for fold-to-one or `'showdown'`) means
  the **hand is fully over**; the final event is `hand_complete {endedBy, potTotal}`.

The runner does not parse hand internals. It treats a table as ready when **no active-hand row
exists** — the unique index guarantees a completed hand has already left `('dealing','betting')`.

---

## 4. When a hand is eligible to auto-start

All of the following must hold (checked by the DB lister, §10):

1. `op_is_enabled()` is true (master switch on).
2. `table.status = 'open'`.
3. **No** `online_poker_hands` row for the table in `('dealing','betting')`.
4. **≥ 2** seats with `status='sitting'` and `stack ≥ bb` (funded enough to post a blind).
5. **Inter-hand cooldown elapsed** — the last hand's `updated_at` is older than the cooldown
   (default **~4s**, tunable) so players can see the result before the next deal.

If any fails, the table is idle-waiting and the runner does nothing for it this tick.

---

## 5. How a completed hand is detected

Detection is **structural, not inferential**: a table is dealable when **no active-hand row
exists**. Because the partial unique index forbids two simultaneous active hands, a finished hand
has necessarily transitioned to `complete`/`voided` and no longer matches `('dealing','betting')`.
The previous hand's `status`/`updated_at` is read **only** to enforce the cooldown (§4.5) — never
to drive correctness.

---

## 6. How the button and blinds advance

- **Button:** reuse `nextButton(prevButtonSeat, seatedSeatNos)` (`online-poker-action/index.ts:247`)
  — clockwise to the next seated seat; first seat if no previous button. The engine never moves
  the button; the edge supplies it in `HandConfig`.
- **Blinds:** `createHand(config, deck, seatInputs)` posts SB/BB per the engine rules; the runner
  passes the advanced button and lets the engine post.
- **Heads-up:** with exactly 2 players the button posts the SB. The engine is expected to handle
  this; it is an explicit **drill check** (§13) before any multi-player widening.

Next-hand recipe (identical to the existing manual `handleStart`, just runner-triggered):
read last `button_seat` + `hand_no` → `nextButton(...)` → `handNo+1` →
`createHand(shuffledDeck(cryptoRng32), seatInputs)` → `op_start_hand(...)`.

---

## 7. Busted players

After settlement writeback (§12), a seat at `stack = 0` is **busted**:

- It is **ineligible** for the next hand (fails §4.4 `stack ≥ bb`).
- **Recommendation:** during writeback, set a busted seat's `status` from `sitting` →
  `sitting_out` (stack stays 0). This keeps it visible at the table but out of the deal until the
  player **rebuys** (future `op_rebuy`, PR E-adjacent) or **stands up** (`op_stand_up`, cashes out 0).
- A busted seat never blocks dealing: it simply isn't counted toward the ≥2 funded quorum.

---

## 8. Pausing when fewer than 2 players are seated

When a table drops below 2 funded seated players, the runner **no-ops** — it does not deal and
does **not** flip `status`. The table stays `open` in the *idle-waiting* derived state. As soon as
a 2nd funded player sits (`op_sit_down`), the next tick finds the table eligible and deals
automatically. Operators may still `paused`/`closed` a table manually; the runner respects that.

---

## 9. Sitting-out, disconnect, and timeout interplay

- **`sitting_out` seats** are excluded from every new hand (the lister counts only `sitting`).
- **Disconnect** does **not** change seat status — state is server-authoritative, so a
  disconnected player is still seated and *will be dealt in* (standard online-poker behaviour) and
  then time out if they don't act.
- **In-hand stalls are the timeout-sweep's job, not the runner's.** The two loops are **disjoint
  by construction**:
  - the **timeout-sweep** acts only on hands with `status='betting'` past `act_deadline`
    (forces check/fold via `op_submit_action`);
  - the **runner** acts only on tables with **no** active hand (deals the next one).
  They can never touch the same hand at the same time. The sweep keeps a hand moving to completion;
  the runner then deals the next one.
- **Out of scope (future):** auto-`sitting_out` after *K* consecutive timeouts. Not in this spec.

---

## 10. Idempotency

Three layers, strongest first:

1. **Hard guarantee — the partial unique index.** Two concurrent deal attempts cannot both insert
   an active hand; the second insert violates the index. `op_start_hand` surfaces this as
   `{outcome:'already_active'}`, which the runner treats as a successful no-op.
2. **Per-table advisory lock** (§11) so only one tick processes a table at a time.
3. **Deterministic tick key** `table_runner_${table_id}_${last_hand_no}` for run-level dedupe and
   observability — re-running a tick for the same `(table, last hand)` is a no-op.

`op_start_hand` itself is safe to call repeatedly: at most one active hand can exist per table.

---

## 11. Race-condition prevention

- The DB lister takes a **per-table advisory lock** — `pg_advisory_xact_lock(hashtext(table_id))`
  (or selects candidate tables `FOR UPDATE … SKIP LOCKED`) — so overlapping cron ticks each get a
  disjoint set of tables and never double-process one table.
- The **partial unique index** is the ultimate backstop even if two edge workers raced past the
  lock: only one `op_start_hand` can win; the loser gets `already_active`.
- `op_start_hand` runs inside the RPC's own transaction with the index enforced — no
  read-modify-write window is exposed to the runner.

---

## 12. Chip conservation (the linchpin — settlement writeback)

**The gap:** the engine settles a hand and `op_submit_action` writes final stacks into
`online_poker_hand_seats.stack` — but **does not** write them back to `online_poker_seats.stack`.
Yet `op_start_hand` reads the next buy-in from `online_poker_seats` and `op_stand_up` cashes out
from `online_poker_seats`. If chips aren't reconciled back, the next hand deals **stale stacks**,
and a winner could `op_stand_up` and cash out their **original buy-in** — a chip-conservation leak.

**Requirement:** when a hand reaches `complete`, each seat's final
`online_poker_hand_seats.stack` must be reconciled into `online_poker_seats.stack` **before** the
`op_stand_up` guard releases (the guard blocks standing up only while a hand is
`('dealing','betting')`).

**Recommended resolution (PR A):** fold the writeback into `op_submit_action`'s completion path —
in the *same atomic action that flips the hand to `complete`*, also `UPDATE online_poker_seats SET
stack = <final hand-seat stack>` per seat and set `sitting_out` at `stack=0`. This is:
- **atomic** — settlement and writeback commit together;
- **exactly-once** — that completing action is idempotent via its idem key;
- **leak-proof** — `online_poker_seats.stack` is correct the instant the hand closes, before any
  stand-up is possible.

**Alternative (rejected as default):** a separate `op_finalize_hand(p_hand_id)` the runner calls
first. Rejected because it leaves a ≤cooldown window where `online_poker_seats.stack` is stale and
a winner standing up could cash out the wrong amount.

**Invariant:** across a completed hand, `Σ(online_poker_seats.stack for that table)` is unchanged
(chips only move *between* seats). Wallets and `online_poker_chip_ledger` are **untouched** by
dealing or settling — only `op_sit_down` (wallet→seat) and `op_stand_up` (seat→wallet) move chips
across the table boundary.

---

## 13. Hole-card secrecy

The runner touches **only** public scheduling and `op_start_hand` (which writes deck/holes/
board-future into the server-only `online_poker_hand_secrets`, deny-all RLS). It **never reads**
hole cards, the deck, or any private view. G1 logging discipline applies: logs carry table_id /
hand_id / counts only — **never** cards, deck, or board-future.

---

## 14. Rollback / kill-switch

| Scope | Action |
|---|---|
| **Master kill** | `UPDATE online_poker_config SET enabled=false` → `op_is_enabled()` false → the runner (and the sweep, and all actions) no-op instantly. No redeploy. |
| **Stop dealing only** | `cron.unschedule('op-table-runner')` — existing hands finish; no new deals. |
| **Neutralise the edge** | remove `OP_TABLE_RUNNER_SECRET` / the `app.op_table_runner_secret` GUC → the runner edge refuses (401) and the cron post is unauthenticated. |
| **Frontend off** | revert `FEATURES.onlinePoker` / `RUNTIME_LIVE` to false, redeploy. |

The runner has **no independent authority**: with the master flag off it does nothing, exactly
like every other `op_*` path.

---

## 15. Observability

- **Per tick (runner edge return + log):** `{tables_scanned, dealt, skipped_no_quorum,
  skipped_cooldown, already_active, errors}` — counts only.
- **Per hand:** the `hand_started` event already lands in `online_poker_hand_events` via
  `op_start_hand`; `hand_complete` lands via the completing `op_submit_action`. Together these give
  a full per-table audit timeline with no extra plumbing.
- **Never logged:** cards, deck, board-future, hole cards, private views, secrets, raw errors
  (G1). On unexpected error the edge logs a tag only.

---

## 16. Architecture options

> A "deal" = `shuffledDeck()` + `createHand()` — **TS engine code that runs only in the Deno Edge.**
> This single fact decides the architecture.

**Option A — Edge does everything.** Cron → edge; the edge queries eligible tables *and* deals
them. Works, but pushes table-scan SQL into the edge and diverges from the proven timeout-sweep
split.

**Option B — Pure DB `op_run_table_tick(table_id)`.** A SQL RPC dealing the hand. **Impossible:**
SQL cannot run the TS shuffle/`createHand`. A pure-DB tick could at most do eligibility + writeback,
never the deal.

**Option C — Hybrid (RECOMMENDED).** Mirror the timeout-sweep exactly:
- **DB RPC lists** dealable tables (behind `op_is_enabled` + advisory locks + cooldown);
- **the edge runs the engine** and deals each listed table.

```
pg_cron ─every ~5s─▶ op_run_table_runner()  (SQL)
                         │  reads app.op_table_runner_secret GUC
                         ▼
                    net.http_post  ──Authorization: Bearer <secret>──▶  edge: online-poker-table-runner
                                                                              │ checks OP_TABLE_RUNNER_SECRET
                                                                              │ rpc op_run_due_table_ticks(limit)  ← eligibility list
                                                                              ▼ for each table:
                                                                                  nextButton → createHand(shuffledDeck) → op_start_hand
```

**Why C:** it reuses every safety primitive already shipped (secret/GUC auth, `op_is_enabled`
gate, advisory locks, deterministic dedupe, counts-only logging) and keeps the engine in the only
place it may run. It is the timeout-sweep with "force action" swapped for "deal next hand."

---

## 17. Proposed RPC / API surface (spec only — NOT implemented here)

> Naming note: the brief's `op_run_table_tick(table_id)` is realised as the **edge** function
> `runTableTick(tableId)` (per-table deal), because the deal must run the TS engine. The DB side is
> the eligibility lister below. This is the same split as `op_timeout_sweep()` (DB lister) vs the
> sweep edge (actor).

**DB (PR A — new migration, source-only, NOT applied):**
- `op_run_due_table_ticks(p_limit int) RETURNS jsonb` — eligibility lister, mirrors
  `op_timeout_sweep()`. Gated by `op_is_enabled()`; advisory-locked / `SKIP LOCKED`;
  cooldown-filtered. Returns
  `{ outcome:'ok'|'disabled', tables:[ { table_id, last_button_seat, last_hand_no, bb,
  seated:[ {seat_no, user_id, stack} ] } ] }` (public scheduling data only — no cards).
- **Settlement writeback** — extend `op_submit_action` per §12 (recommended), or
  `op_finalize_hand(p_hand_id)` (alternative). One of these is mandatory for PR A.
- **No change to `op_start_hand`** — reused as-is.

**Edge (PR B — source-only, NOT deployed):**
- `online-poker-table-runner` — cron-invoked, `Authorization: Bearer OP_TABLE_RUNNER_SECRET`;
  bails out if `op_is_enabled()` is false; calls `op_run_due_table_ticks`, then for each table
  `runTableTick(table)` = `nextButton` → `createHand(shuffledDeck(cryptoRng32))` → `op_start_hand`;
  returns the §15 counts.

**Cron (PR D / Phase D only — controlled apply, NOT via the deploy workflow):**
- `op_run_table_runner()` SQL fn (reads `app.op_table_runner_secret`, `net.http_post` to the edge)
  + `cron.schedule('op-table-runner', '5 seconds', $$SELECT op_run_table_runner();$$)`. Interval
  tunable ~5–15s (5s = snappier next-hand at higher invocation cost; 15s = parity with the sweep).

---

## 18. Safety invariants (always)

1. **Never two hands per table** — partial unique index + advisory lock + `already_active`.
2. **Never mutate a finished hand twice** — idem keys + `status` guard + finalize-once via the
   completing action.
3. **Never deal with < 2 funded seated** — lister filter + `op_start_hand` re-check.
4. **Never reveal another player's hole cards** — the runner reads no secrets.
5. **Never violate chip conservation** — engine settlement + exact seat writeback (§12).
6. **All operations idempotent / retry-safe** — deterministic keys; re-runs are no-ops.
7. **Runner stops when disabled** — `op_is_enabled()=false` ⇒ no-op (same as every `op_*` path).
8. **Play-money only** — zero link to cashier / payroll / staking / real wallet.

---

## 19. Alpha acceptance plan (runs ONLY at Phase D, on a disposable table)

One disposable `open` table + two throwaway logins (never real players):

1. Both `op_claim_daily_chips` + `op_sit_down` (funded). Deal **hand 1** (`op_start_hand` or the
   first runner tick).
2. Play hand 1 to completion (fold-to-one or showdown).
3. **Auto-deal check:** within one cooldown, the runner deals **hand 2** — button advanced one
   seat, stacks carried from hand 1 (verify `online_poker_seats.stack` reflects hand-1 result).
4. **No-freeze check:** disconnect / let one player time out mid-hand → the **timeout-sweep** forces
   check/fold, the hand completes, the runner deals on. The table never freezes.
5. **Quorum check:** stand one player up → table drops to idle-waiting, **no deal**; re-sit a 2nd
   funded player → next tick deals again.
6. **Kill-switch check:** `UPDATE online_poker_config SET enabled=false` → **both** runner and
   sweep no-op on the next tick; no new hand.
7. **Audit check:** `online_poker_hand_events` has `hand_started`/`hand_complete` per hand; runner
   tick logs show counts only — **no cards anywhere**.

If any check fails: master-kill immediately, fix, re-drill. Never widen on a failed drill.

---

## 20. Implementation plan (future PRs — none built in this spec session)

| PR | Scope | Mode |
|---|---|---|
| **A** | DB RPC `op_run_due_table_ticks` + settlement writeback (extend `op_submit_action`). New migration. | source-only, **NOT applied** |
| **B** | Edge `online-poker-table-runner` + `runTableTick` + unit/integration tests. | source-only, **NOT deployed** |
| **C** | Timeout sweep live (already built — wire/apply at Phase D). | controlled apply |
| **D** | Controlled Phase D + one-table drill: enable, wire sweep, deploy runner, set secret/GUC, apply crons, run §19. | owner-gated |
| **E** | Frontend wallet balance + live seat-count reads (lobby/table). | frontend-only |
| **F** | Allowlisted closed alpha — flip `FEATURES.onlinePoker` / `RUNTIME_LIVE` for a known group. | frontend-only, owner-gated |

PRs A and B are pure source authoring and can land dark anytime. PRs C–F are the owner-gated
Phase D sequence and must follow `docs/online-poker/GE2_PHASE_D_READINESS.md` (gate phrase
`Proceed with G4 DB enable drill`).

---

## 21. What NOT to do (until the Phase D gate is satisfied)

- Do **NOT** flip `online_poker_config.enabled`, `FEATURES.onlinePoker`, or `RUNTIME_LIVE`.
- Do **NOT** `supabase db push`, use `deploy_db=true`, or edit `schema_migrations`.
- Do **NOT** apply the runner/sweep cron or create a live cron job.
- Do **NOT** deploy the runner edge or set its secret/GUC.
- Do **NOT** link any `online_poker_*` write to cashier / payroll / staking / real wallet.
- Do **NOT** run the runner against a real player's table — disposable table + throwaway logins only.
- Do **NOT** log or commit cards, decks, hole cards, or secrets.
