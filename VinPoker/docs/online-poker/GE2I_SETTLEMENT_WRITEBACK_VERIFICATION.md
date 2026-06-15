# GE-2I — Settlement Seat Writeback (verification & proofs)

**Status: SOURCE ONLY. Migration NOT applied. Online poker fully DARK.** This documents the
GE-2H spec finding fix, its idempotency / chip-conservation proofs, and the Phase-D verification
to run after a real completed hand.

- Patch: `supabase/migrations/20260906000000_op_submit_action_settlement_seat_writeback.sql`
- Rollback: `docs/emergency_rollbacks/PRE_GE2I_20260906000000_*_rollback.sql`
- Phase-D check: `scripts/ge2-drill/sql/05_settlement_writeback.sql`

---

## 1. The bug (GE-2H spec finding, P0)

`op_submit_action` persists each action into `online_poker_hand_seats.stack` and, on the
completing action, flips `online_poker_hands.status` to `complete`. It did **not** write the final
per-seat stacks back to `online_poker_seats.stack` — yet:

- `op_start_hand` reads the next hand's buy-in **from `online_poker_seats.stack`**
  (edge `handleStart`, `online-poker-action/index.ts:133`); and
- `op_stand_up` cashes out **from `online_poker_seats.stack`** (`20260820000000:534`).

`op_sit_down` sets `online_poker_seats.stack = buyin` and it is **never decremented during a hand**.
So without writeback: (a) the next hand deals **stale** stacks (the pre-hand buy-in, not the
carried result), and (b) a winner/loser standing up after the hand cashes out their **original
buy-in** — chips created/destroyed at the table↔wallet boundary.

---

## 2. The fix — exact writeback location

In `op_submit_action`, **immediately after** the existing `UPDATE online_poker_hand_seats …`
(the per-seat stack persist) and **before** the event append, a guarded block:

```sql
IF p_new_state->>'status' = 'complete' THEN
  UPDATE public.online_poker_seats s SET
    stack = hs.stack
  FROM public.online_poker_hand_seats hs
  WHERE hs.hand_id = p_hand_id
    AND s.table_id = v_hand.table_id
    AND s.seat_no  = hs.seat_no
    AND s.user_id  = hs.user_id;
END IF;
```

It is the **only** change versus `20260820000002`; every other line of `op_submit_action`
(idempotency guard, `FOR UPDATE`, CAS, seat-ownership, no-secret, no-negative, the N2-filtered
chip-conservation check, all persists) is reproduced verbatim.

---

## 3. Idempotency proof (no double-apply)

Three independent layers guarantee the writeback runs **exactly once** per completed hand:

1. **Top-level idempotency guard** (function lines, unchanged): a replayed `p_idempotency_key`
   returns the **stored response** and never re-enters the body — so the completing action (and
   its writeback) cannot execute twice for the same key.
2. **`hand_not_active` guard** (G4(c)): once the completing action sets `status='complete'`, any
   later `op_submit_action` on that hand returns `hand_not_active` before reaching the writeback.
3. **SET, not increment**: the writeback assigns `seats.stack = hs.stack` (the final value). Even
   a hypothetical re-execution is a no-op because `hs.stack` is fixed once the hand is complete.

The pot is therefore applied to the seats **once**; replays and retries do not mutate twice.

---

## 4. Chip-conservation proof

Let the dealt seats be `D`. At deal time `op_start_hand` seeded each `hand_seats.starting_stack[i]
= seats.stack[i]` for `i ∈ D` (the pre-hand table stack). The pure engine guarantees

```
Σ_{i∈D} hand_seats.final_stack[i]  =  Σ_{i∈D} hand_seats.starting_stack[i]
```

(the pot is fully redistributed; `pot → 0`). The writeback sets `seats.stack[i] =
hand_seats.final_stack[i]` for every still-seated `i ∈ D` (matched by `user_id`). Hence

```
Σ_{i∈D} seats.stack[i]  (after)  =  Σ_{i∈D} seats.stack[i]  (before, = buy-ins)
```

— chips only move **between** seats, never in/out. Wallets and `online_poker_chip_ledger` are
**untouched** by the writeback (only `op_sit_down` / `op_stand_up` cross the table↔wallet
boundary). The in-hand G4(f) conservation backstop is unchanged.

**`user_id` match is load-bearing:** a seat vacated mid-hand (a folded player who stood up → seat
becomes `empty`, `user_id` NULL) or re-occupied by a different player does **not** match and is
**never** overwritten by the prior occupant's stack.

---

## 5. Required checks → how each is verified (Phase D, on a disposable table)

| # | Required check | Verified by |
|---|---|---|
| 1 | Winner stack increases in `hand_seats` **and** `seats` | `05` row: `delta > 0` and `match=true` for the winner |
| 2 | Loser stack decreases in `hand_seats` **and** `seats` | `05` row: `delta < 0` and `match=true` for the loser |
| 3 | Standing up after a completed hand cashes out the **final** stack | run `op_stand_up`; `cashed_out` == the winner/loser's `05` `seat_stack` (= final hand stack), not the buy-in |
| 4 | Replay / idempotency does not mutate twice | §3 (structural); plus re-submitting the completing action's key returns the stored `ok` and leaves `seats.stack` unchanged |
| 5 | Chip conservation holds | `05` DO block: `Σ starting == Σ final`, every dealt seat written back, raises `GE2I-VERIFY PASS` |

**Golden results:** to be captured at the (owner-gated) Phase D enablement, since the runtime is
dark and this PR applies nothing. Run order: GE-2H alpha acceptance §19 plays hand 1 to completion
→ run `05` (expect all `match=true`, PASS) → `op_stand_up` one player (expect `cashed_out` = final
stack).

---

## 6. Documented follow-ups (intentionally OUT of this single-purpose patch)

- **Auto-`sitting_out` of busted seats.** A bust (`stack=0`) is left as `status='sitting'`,
  `stack=0`; `op_start_hand`'s `stack>0` filter already excludes it from the next deal, so this is
  cosmetic. The table runner (GE-2H PR A) or a small follow-up can flip it to `sitting_out`.
- **Mid-hand folded stand-up over-cashout (pre-existing, separate root).** `op_stand_up`'s guard
  only blocks `active`/`allin` seats, so a **folded** player may stand up mid-hand and cash out
  their stale `seats.stack` (= buy-in) rather than their post-fold stack. GE-2I's completion
  writeback does not address this (it fires at hand end, after the player has left). Fix options
  for a follow-up: block stand-up for any seat dealt into an active hand until completion, or have
  `op_stand_up` cash out the in-hand `hand_seats.stack` when a hand is active. Tracked here, not
  fixed in this PR.

---

## 7. DB safety

Source-only. **Not applied.** `schema_migrations` untouched (live max remains `20260820000002`;
this slot `20260906000000` is unapplied like every slot after it). No `supabase db push`, no
`deploy_db=true`, no Edge deploy, no flag flip. The runtime stays dark
(`online_poker_config.enabled=false`), so `op_submit_action` does not execute in production and
this patch carries no behavioural risk until the owner-gated apply. Rollback restores the
`20260820000002` body verbatim.
