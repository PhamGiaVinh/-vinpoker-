# Tracker T4 — Server-Side Poker Action Validation (design + implementation)

Status: **Draft PR — design-first.** Do not merge until owner UAT. No DB apply, no
migration, no production writes. Builds on T3A (`src/lib/tracker-poker/potEngine.ts`).

## Problem

T3A computes side pots **on the client** and the client also computes every
action amount. The server (`record_action` / `record_hand` RPCs via the
`tournament-live-update` Edge function) trusts whatever the operator's browser
sends. An operator misclick — or a tampered payload — can persist an impossible
poker state (act after folding, bet more than the stack, fabricated side_pots).

## Goal

Give the **server** authority over tracker hand rules without rewriting the
tracker or coupling it to the GE-2 online runtime:

1. Validate legal actions (fold/check/call/bet/raise/all-in).
2. Validate turn order and active player.
3. Validate stack / contribution amount.
4. Validate min bet / min raise.
5. Validate street transition (no advancing while action is pending).
6. Recompute side pots server-side; never trust client `side_pots`.
7. Return clear, localized validation errors for the UI.
8. Preserve the existing Edge/RPC contract.

## Where validation lives — the Edge function boundary

```
operator (HandInputPanel)
  → POST tournament-live-update  (Edge, server-trusted)
      → loadHandForValidation(hand_id)   # seeds + prior action stream + button, from DB
      → trackerEngine.validateAction(...) # pure, server-authoritative
      → trackerEngine.reconcileSidePots(...) # recompute, ignore client value
      → existing RPC (record_action / record_hand)  # contract unchanged
  ← { status, data, validation? }  or  422 { error, code }  (enforce mode)
```

The Edge function is the **minimum safe place**: it is already the server trust
boundary, it can read the trusted DB state, and it needs **no migration** (the
RPC signatures are untouched). Pushing validation into plpgsql would have meant
DB migrations + much harder testing for the same guarantee.

## The engine — `supabase/functions/_shared/trackerEngine/`

Pure, dependency-free, Deno-and-vitest importable. **Not** the GE-2 runtime: no
deck, shuffle, wallet, `op_*`, or `online_poker_*`. Plain numbers.

| File | Responsibility |
|---|---|
| `types.ts` | Action vocabulary, runtime types, `ValidationCode` enum |
| `handState.ts` | `reduceHand` (replay seeds + action stream → runtime), `nextToAct`, `isBettingRoundComplete` |
| `validateAction.ts` | `validateAction` (legality verdict), `reconcileSidePots` (recompute + tamper flag) |
| `potEngine.ts` | **Verbatim copy** of the T3A client pot math (server pot authority) |
| `index.ts` | Public surface |

### Reconstruction

`reduceHand(seeds, actions, buttonSeat)` replays the trusted `hand_actions`
stream over the `hand_players` seeds. Action-amount convention matches T3A:
every `action_amount` is **chips added this street**, never a raise-to total, so
`total_bet === Σ contributing amounts` (keeps side-pot math identical to T3A).

It tracks per player: `stack`, `street_bet`, `total_bet`, `is_folded`,
`is_all_in`, `has_acted_this_street`; and per hand: `street`, `highestBet`,
`minRaise` (min raise increment, anchored on the big blind), `bigBlind`.

### Side-pot authority

`reconcileSidePots(actions, clientSidePots)` runs the same `computePotBreakdown`
the client uses (parity-guarded — see below) and returns
`{ serverSidePots, tampered }`. The Edge function **always** persists
`serverSidePots`; `tampered` only decides whether to *also* reject (enforce) or
silently override (warn).

## Rollout safety — fail-open by default

A reconstruction bug must never block a live operator entering a real hand.
Behaviour is env-gated:

| Env | Default | Effect |
|---|---|---|
| `TRACKER_VALIDATION_MODE` | `warn` | `warn`: record anyway, attach advisory `validation` to the response + `console.warn`. `enforce`: reject invalid with HTTP 422. `off`: skip entirely. |
| `TRACKER_ENFORCE_TURN_ORDER` | `false` | Strict clockwise turn order — the likeliest false-reject for live entry (heads-up, straddles, allowed out-of-turn). Off even in enforce mode unless opted in. |

**Recommended rollout:** merge in `warn` → watch `console.warn` rate on real
sessions for false positives → flip to `enforce` (amount/legality only) → later
enable `TRACKER_ENFORCE_TURN_ORDER` once turn-order false-positive rate is ~0.

## Tests — `tests/trackerEngine/` (24, all pass)

Negatives: out-of-turn · bet > stack · raise < min-raise · check facing bet ·
act after fold · act after all-in · tampered side_pots · advance street while
pending · ghost player. Positives: normal preflop round (turn-order on) ·
short-call clamped to stack · sub-min all-in legal · turn-order off is lenient.
Plus reducer stack/commitment reconstruction and a **parity test** asserting the
server pot copy is byte-for-byte equivalent to the client copy (drift guard).

## Known limitations / follow-ups

- **Heads-up preflop** turn order (button = SB acts first) is not modelled —
  left under `TRACKER_ENFORCE_TURN_ORDER=false`.
- **BB option / dead-SB** nuances: `nextToAct` is coarse (owes-action set), good
  enough for the warn-mode advisory and amount/legality enforcement.
- **Optimistic UI rollback**: when `enforce` rejects a `record_action`, the
  client currently toasts the error but does not auto-revert the optimistic row.
  Wire a rollback when enabling enforce in production.
- **`hand_players.side_pots`** (per-player) still defaults `[]`; hand-level
  `tournament_hands.side_pots` is the authority.

## DB safety

```
schema_migrations changed: NO
deploy_db=true used:       NO
supabase db push used:     NO
production writes:         NO
online_poker_* / op_* / GE-2 touched: NO
```

Note: merging redeploys the `tournament-live-update` Edge function (expected per
the deploy rules) — that is a function deploy, **not** a DB migration, and it
ships in fail-open `warn` mode.
