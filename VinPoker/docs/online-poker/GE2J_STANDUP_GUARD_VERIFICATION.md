# GE-2J — `op_stand_up` mid-hand guard (verification & proofs)

**Status: SOURCE ONLY. Migration NOT applied. Online poker fully DARK.** Closes the
mid-hand folded stand-up over-cashout residual flagged by GE-2I.

- Patch: `supabase/migrations/20260908000000_op_stand_up_block_folded_midhand.sql`
- Rollback: `docs/emergency_rollbacks/PRE_GE2J_20260908000000_*_rollback.sql`
- Phase-D check: `scripts/ge2-drill/sql/06_standup_guard.sql`
- Depends on: GE-2I `20260907000000` (settlement seat writeback)

---

## 1. The bug

`op_stand_up`'s "cannot leave during an active hand" guard blocked only seats with hand
status `IN ('active','allin')`. A **folded** player (`online_poker_hand_seats.status='folded'`)
could stand up **mid-hand** and cash out `v_seat.stack = online_poker_seats.stack` — the
**pre-hand buy-in** (`seats.stack` is set at `op_sit_down` and never decremented during a
hand). So a player could fold (committing chips to the pot), leave immediately, and recover
their **full buy-in** — a chip-conservation / over-cashout leak, distinct from the GE-2I
completion-writeback gap.

---

## 2. The fix — exact change

One line in the guard's status set:

```diff
-      AND hs.seat_no = v_seat.seat_no AND hs.status IN ('active', 'allin')
+      AND hs.seat_no = v_seat.seat_no AND hs.status IN ('active', 'folded', 'allin')
```

Now **any seat dealt into an active hand** (including folded) is blocked from standing up
until the hand completes. It is the **only** change versus the `20260820000000` body;
idempotency, `not_seated`, the wallet cash-out, and the seat clear are reproduced verbatim.

---

## 3. Why this composes with GE-2I (and why it needs it)

- A folded player now **waits** until the hand reaches `complete`.
- At completion, the **GE-2I writeback (`20260907000000`)** has set `online_poker_seats.stack`
  to the correct **final** amount.
- Once `online_poker_hands.status='complete'`, the guard's `h.status IN ('dealing','betting')`
  no longer matches → the player may stand up and cash out the **correct** stack.

**Dependency:** GE-2J alone only closes the mid-hand escape window. Without GE-2I the
post-completion `seats.stack` would still be stale, so a folded player would merely be
*delayed* before cashing out the wrong amount. **Apply both** before any enablement.

---

## 4. No new deadlock / no collateral

- **Sitting-out players are unaffected.** They are never dealt into the active hand, so they
  have no `online_poker_hand_seats` row matching it and the guard does not block them.
- **No new deadlock risk.** `active`/`allin` seats were already blocked this way; `folded`
  now joins them. The hand is guaranteed to terminate (the timeout-sweep forces remaining
  actors; the table runner deals on), so the wait is bounded — same liveness as before.
- **Re-occupation race closed as a bonus.** With folded stand-up no longer possible
  mid-hand, a seat can't be vacated and re-taken by a new player within the same active hand,
  so the prior occupant's settlement can never be misattributed.

---

## 5. Required checks → how each is verified (Phase D, on a disposable table)

| # | Check | Verified by |
|---|---|---|
| 1 | A folded player cannot stand up mid-hand | `06`: as the folded user, `op_stand_up` → `{"outcome":"in_active_hand"}` (pre-GE-2J: a successful cashout) |
| 2 | An `active`/`allin` player still cannot stand up mid-hand | unchanged behaviour; `op_stand_up` → `in_active_hand` |
| 3 | After completion, the (formerly folded) player can stand up and cash out the **final** stack | `op_stand_up` → `{"outcome":"ok","cashed_out":<final>}` equal to the seat's `online_poker_seats.stack` (GE-2I writeback) |
| 4 | A sitting-out player (not in the hand) can still stand up anytime | `op_stand_up` → `ok` while a hand is active for others |
| 5 | Chip conservation across the table holds | no over-cashout path remains; combined with GE-2I, `Σ(seats.stack)+Σ(wallet for table)` is conserved |

**Golden results:** captured at the owner-gated Phase D enablement (runtime dark; this PR
applies nothing).

---

## 6. Alternative considered (not chosen)

**Cash out the in-hand `online_poker_hand_seats.stack` on a mid-hand stand-up** (let folded
players leave immediately with their correct current stack). More user-friendly, but larger
surface area: `op_stand_up` would need to read the active hand, compute the in-hand stack,
mark the seat as left mid-hand, and reconcile with the engine's later settlement. The chosen
block-until-complete fix is minimal, safe, and composes with GE-2I. If the owner prefers the
lenient UX, that is a follow-up that supersedes this guard.

---

## 7. DB safety

Source-only. **Not applied.** Slot `20260908000000` (after GE-2I's de-collided
`20260907000000`). `schema_migrations` untouched (live max `20260820000002`). No
`supabase db push`, no `deploy_db=true`, no Edge deploy, no flag flip. Runtime dark, so
`op_stand_up` does not execute in production and this patch carries no behavioural risk until
the owner-gated apply. Rollback restores the `20260820000000` body verbatim.
