# VinPoker Game Engine — Behavior Specification (GE-1.x)

**Module:** `supabase/functions/_shared/pokerEngine/`
**Status:** Pure rules engine, implemented + tested. NOT wired to any runtime (no DB, no RPC, no Edge entrypoint, no frontend).
**Game:** Texas Hold'em No-Limit, PLAY CHIPS ONLY.

This document is the behavior contract for the engine. The companion handoff
doc is `docs/agent-handoffs/game-engine-core.md`; the persistence schema
(source-only, not applied) is `supabase/migrations/20260817000000/01`.

---

## 1. Authority model (locked)

- The engine is the single source of game truth. It runs ONLY on the server
  (Deno Edge / future actor server) and in tests.
- Clients send **intent only** (`ActionRequest`): fold / check / call / bet /
  raise / allin. The server re-validates every intent against authoritative
  state before applying.
- The client never decides cards, winner, pot, or chip balance.
- Build-level guardrail: the `@engine` alias exists in `vitest.config.ts`
  ONLY. `vite.config.ts` has no such alias, so client code cannot import the
  engine without failing the build.

## 2. Core data model

| Concept | Shape | Notes |
|---|---|---|
| Chips | `bigint` | Never `number`. Wire/persistence form is a **decimal string** (`ChipString`). |
| Card | `"As"`, `"Td"`, `"2c"` | Rank-first, lowercase suit (`CARD_RE`). |
| Hand state | `HandState` | AUTHORITATIVE; contains private `deck` + `holeCards`. |
| Public view | `PublicHandState` / `WirePublicHandState` | No deck, no hole cards — by construction. |
| Private view | `PrivateHandState` / `WirePrivateHandState` | Adds ONLY the requesting seat's own cards. |
| Events | `HandEvent` (no seq) → `GameEventEnvelope` (seq) | Engine emits without `seq`; persistence assigns the durable per-hand seq. |

### Pot / committed convention (locked)

`pot` is the running **gross** pot: chips are swept into `pot` the instant they
leave a stack. `committed` (this street) and `totalCommitted` (whole hand) are
accounting metadata for legal-action sizing and side-pot math.

> The ONE conservation invariant: `Σ(seat.stack) + pot === initialTotal`.
> Never `stack + pot + committed` — that double-counts.

Both completion paths (fold-to-one and showdown) close street metadata
identically: `committed` is reset to `0`, `currentBet` to `0`, `aggressor` to
`null`. A completed state never carries stale street accounting.

## 3. Hand lifecycle state machine

```
createHand(config, deck, seatInputs)        deck is INJECTED (RNG at server boundary)
  └─ post blinds (short blinds = all-in for less)
  └─ deal 2 hole cards each, clockwise from SB
  └─ street: preflop, toAct = UTG (heads-up: button/SB)

betting round (street = preflop|flop|turn|river, status = 'betting')
  ├─ applyAction(state, action) — pure reducer, re-validates everything
  ├─ fold-to-one  → refund uncalled → award pot → status 'complete' (endedBy 'fold')
  ├─ round closes → reset street metadata → advance street
  │     ├─ ≥2 seats can still bet → next street, toAct = first active after button
  │     └─ ≤1 seat can bet (all-in runout) → reveal remaining streets → showdown
  └─ showdown → refund uncalled → side pots → evaluate per pot → status 'complete'
```

- Heads-up: button posts SB and acts first preflop; BB acts first postflop.
- `street` ends at `'showdown'` (showdown path) or `'complete'` (fold path);
  `status === 'complete'` is the authoritative end-of-hand signal either way.
- Edge case: everyone all-in from the blinds → immediate runout from `createHand`.

## 4. Betting rules

- **Bet sizes are "raise to" totals**, not deltas (`Action.amount`).
- **Min bet** = big blind. **Min raise** = `currentBet + lastFullRaiseSize`.
- **NL cap**: `maxRaiseTo = committed + stack`.
- **BB option**: limped pots return to the BB, who may check or raise.
- **Sub-minimum all-in (no-reopen rule)**: an all-in that raises by LESS than
  the last full raise does not reopen betting — seats that already acted must
  respond (call/fold) but lose the right to re-raise (`canRaise = false`,
  including all-in re-shoves). Not-yet-acted seats keep full rights.
- **Uncalled bet refund**: the unmatched top of the last bet returns to its
  owner before any award (both completion paths).
- **Forced timeout** (`forcedTimeoutAction`): check if free, else fold.
  Disconnect/grace policy is a Phase-2 runtime concern, not engine logic.

## 5. Pots, showdown, settlement

- Side pots are layered by `totalCommitted` level; folded seats' chips stay in
  the pots (dead money) but folded seats are never eligible.
- Each pot is evaluated independently over its eligible seats (7→best-5
  evaluator: straight flush > quads > full house > flush > straight > trips >
  two pair > pair > high card; wheel A-2-3-4-5 supported; kicker-exact).
- Ties split; odd chips go to winners nearest clockwise from the button.
- `HandResult` records `endedBy`, `potTotal`, per-pot `potAwards`, per-seat
  `payouts`. `Σ payouts === potTotal`.

## 6. Secrecy model (locked)

- Private data in `HandState`: `deck` (undealt cards) and every seat's
  `holeCards`. `revealedCards` (showdown contestants only) is public.
- `toPublicView` strips both; `toPrivateView(state, seat)` adds back ONLY that
  seat's own cards. Wire shapes (`contracts.ts`) are built ON TOP of these, so
  leakage is structurally impossible — `WirePublicSeat` has no hole-card field.
- Events are PUBLIC ONLY: `hole_cards_dealt` announces dealing without cards;
  `board_revealed` carries only just-opened cards; `showdown` carries only
  contesting seats' reveals. Fold-to-one reveals nothing.
- Persistence rule (Patch A schema): private data lives ONLY in
  `online_poker_hand_secrets` (FORCE RLS, deny-all, never in realtime).

## 7. Determinism & replay

- Every reducer is pure: `applyAction` deep-clones, never mutates its input,
  and returns `{ state: prev, events: [], error }` unchanged on rejection.
- A hand is fully determined by `HandScript = (config, deck, seats, actions)`.
  `replayHand(script)` reproduces the exact state and event stream and asserts
  every invariant after every step; a rejected stored action throws
  `ReplayError{actionIndex, reason}` (the log is corrupt — never "fix it up").
- Public events are NOT a replay source (`action` events carry deltas, engine
  actions carry "raise to" totals) — persistence must store validated actions.
- `engine_version` must be pinned per hand at the persistence layer so old
  hands replay under the engine that produced them.

## 8. Error model (stable contract)

`validateAction` / `ApplyResult.error` strings are part of the tested contract;
`classifyActionError` maps them to stable codes for the RPC layer:

| Engine string | Code |
|---|---|
| `hand is not in a betting round` | `not_in_betting` |
| `not your turn` (also unknown seat, duplicate action) | `not_your_turn` |
| `seat cannot act` (internal safety; unreachable via public API) | `seat_cannot_act` |
| `action not legal: <type>` | `action_not_legal` |
| `<type> requires an amount` | `amount_required` |
| `illegal bet/raise size: <n> (legal <min>..<max>)` | `illegal_amount` |
| (malformed request — assigned by RPC layer) | `bad_request` |

Rejection side-effects contract (tested): same state reference returned, zero
events, input byte-identical.

## 9. Invariants (`checkInvariants` / `assertInvariants`)

Checked by the engine's own property suite (400-run fast-check) and re-checkable
at runtime by the persistence layer / replay path:

1. `Σ(seat.stack) + pot === initialTotal` (with `initialTotal` provided).
2. No negative stack / committed / totalCommitted / pot; `committed ≤ totalCommitted`.
3. During betting: an `allin` seat has stack 0; `toAct` points at an active
   seat; `Σ totalCommitted === pot`; side pots partition the pot exactly.
4. Card integrity: no duplicate card across board + hole cards + deck;
   hole cards are exactly 0 or 2.
5. Side pots: positive amounts, non-empty eligibility, folded never eligible.
6. Complete: `toAct === null`, `pot === 0`, result present, `Σ payouts === potTotal`.

## 10. Module map

| File | Responsibility |
|---|---|
| `types.ts` | Core types + locked conventions (chips, pot/committed, secrecy) |
| `deck.ts` | Card constants, parsing, deck construction, duplicate guard |
| `shuffle.ts` | CSPRNG Fisher-Yates (`cryptoRng32`, rejection-sampled index) — production deal path |
| `provableFair.ts` | Optional Phase-3 commit-reveal shuffle (HMAC-SHA256 keystream); NOT on the deal path, NOT in the barrel |
| `betting.ts` | Turn order, legal actions, validation, chip movement, no-reopen rule |
| `pots.ts` | Side pots, uncalled refund, odd-chip distribution |
| `evaluate.ts` | 5/6/7-card hand evaluator |
| `showdown.ts` | Per-pot resolution, reveals, result |
| `hand.ts` | `createHand` / `applyAction` reducer, street advance, runout, fold-to-one, timeout |
| `events.ts` | PUBLIC event builders (no seq) |
| `views.ts` | Public/private projections + bigint-safe serialization |
| `contracts.ts` | Wire shapes: `ActionRequest`/`ActionResult`, `ChipString` codec, wire views, error codes, event envelopes |
| `invariants.ts` | Runtime state checker (defense-in-depth for persistence/replay) |
| `replay.ts` | `replayHand` deterministic replay + `ReplayError` |
| `index.ts` | Barrel (everything except `provableFair`) |

Tests: `tests/pokerEngine/` — evaluate, pots, showdown, betting, lifecycle,
invariants (property-based), contracts, replay (incl. 25 seeded random hands
replayed bit-for-bit), illegalActions (rejection side-effects matrix).

## 11. Non-goals of the pure engine

Deliberately OUTSIDE this module (server-runtime concerns, GE-2+):

- RNG persistence / seed custody (deck is injected)
- Idempotency-key dedupe (durable UNIQUE in `online_poker_actions`)
- Event seq assignment, snapshots, CAS/state_version concurrency
- Seat/table lifecycle (sit, stand, buy-in, rebuy), chip ledger
- Timers/clocks, disconnect grace, anti-cheat forensics
- Rake (play chips), tournament structures, run-it-twice
