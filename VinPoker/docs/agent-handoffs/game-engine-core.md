# Agent Handoff: Poker Game Engine — GE-1 (Pure NLH Rules Engine)

**Session:** Game Engine GE-1: Pure NLH Rules Engine
**Status:** Implemented + verified. Pure TypeScript; zero Supabase/Godot/UI; not wired to any runtime yet.

## What this is

A server-authoritative, **deterministic** Texas Hold'em No-Limit rules engine. The deck
is **injected** (RNG lives at the server boundary), so every function is a pure reducer
that reproduces exactly from a fixed deck. Chips are `bigint`. It is the single source of
game truth for all later phases (Edge MVP → actor server → audit/replay).

**Location:** `supabase/functions/_shared/pokerEngine/` — a Deno-shared folder, but the
engine has **zero external imports**. Reachable by Deno (Edge), the future actor server,
and Vitest (via the `@engine` alias in `vitest.config.ts` **only**). It is deliberately
**not** importable by the client Vite build (`vite.config.ts` has no `@engine` alias),
enforcing "client sends intent, never decides results" at build level.

## Files this session owns (all NEW)

- `supabase/functions/_shared/pokerEngine/{index,types,deck,shuffle,provableFair,evaluate,betting,pots,hand,showdown,events,views}.ts`
- `tests/pokerEngine/{fixtures,evaluate,pots,showdown,betting,lifecycle,invariants}.test.ts`
- `tsconfig.engine.json` (engine type-check)
- edits: `vitest.config.ts` (+`@engine` alias, vitest-only), `package.json` (+`fast-check` dev dep, +`typecheck:engine` script)

## Files this session must NOT touch (and did not)

Tracker, Dealer Swing, Floor, Payroll, Cashier, Staking, KYC, routes, app UI, `vite.config.ts`,
Supabase migrations / RPC / Edge functions, Godot. No DB deploy, no secrets.

## Public API (`@engine/index.ts`)

`createHand(config, deck, seats)`, `applyAction(state, action)` (re-validating reducer; returns a
new deep-cloned state + events, or `{error}` with the original state unchanged), `legalActions`,
`validateAction`, `nextPlayerToAct`, `isBettingRoundComplete`, `computeSidePots`,
`evaluateShowdown`, `evaluateBest`/`compareHands`, `forcedTimeoutAction`,
`toPublicView`/`toPrivateView`/`serializeForTransport`, `cryptoRng32`/`shuffle`/`shuffledDeck`/`unbiasedIndex`.

## Locked conventions (do not break)

- **Chips are `bigint`.** Future persistence/transport MUST serialize chips as **decimal
  strings** (`amount.toString()`), never as a JS `number`. `serializeForTransport` does this.
- **Pot/committed.** `pot` is the running **gross** pot, already including the current street's
  committed chips. `committed`/`totalCommitted` are accounting metadata. The only conservation
  invariant is **`Σ(seat.stack) + pot === initialTotal`** — never `stack + pot + committed`.
- **Secrecy.** Hole cards (`SeatState.holeCards`) and undealt board (`HandState.deck`) are
  private; `toPublicView` strips both; events never carry unrevealed cards; `revealedCards`
  (showdown only) is public.

## Rules covered (with tests)

Blinds + heads-up button/blind posting, UTG/postflop turn order, BB option, min-raise,
**sub-minimum all-in no-reopen** (per-seat raise rights), all-in + multi-level side pots,
uncalled-bet refund, split pot + odd chip clockwise from button, fold-to-one (no reveal),
all-in runout, showdown ranking incl. wheel / board-plays / kickers / full-house / quads /
straight-flush. Rejections: out-of-turn, duplicate, illegal size, check-into-bet.

## Verification result

- `npm test` → **83 passed** (38 engine + 45 existing; no regressions). Includes a 400-run
  fast-check property suite (chip conservation, no negative stacks, one-to-act, side pots
  partition the pot, folded-never-eligible) with a coverage guard that fails if no real
  side pot is ever produced.
- `npm run typecheck:engine` (`tsc -p tsconfig.engine.json`, strict) → **pass (exit 0)**.
- Guardrail proven: `vite.config.ts` has no `@engine` alias and `grep` finds no `@engine`/
  `pokerEngine` import under `src/` → the client build graph cannot reach the engine.
- `npm run build` (full vite build): could not complete on this machine — the node/SWC
  process crashed with a native access violation (0xC0000005) mid-transform of `src/`,
  reproduced twice (same as the OOM seen running the full vitest pool). This is a local
  memory/native instability, NOT a GE-1 effect: the engine lives outside `src/` and is
  unreferenced by client code. Separately, `tsc -p tsconfig.app.json` reports **pre-existing**
  type drift in `src/pages/Feed.tsx` and `src/pages/NotificationSettings.tsx` (Supabase
  generated-type mismatches: `feed_posts`/`feed_story_views`/`email_notifications_enabled`),
  unrelated to this session.

## Bug fixes folded in (from the v2 review)

- Provable-fair shuffle rewritten (`provableFair.ts`): full-256-bit HMAC-SHA256 keystream +
  client seed + nonce + `verifyShuffle` (was a 32-bit splitmix → ≤2^32 decks, brute-forceable).
  **Optional / Phase-3, NOT on the Phase-1 deal path** (deals use `cryptoRng32`).
- Engine emits events **without** `seq` (persistence layer owns the durable per-hand seq).
- Property-test generator now actually reaches multi-way all-ins (was effectively never).

## Handoff to next session

GE-2 server runtime: Patch A schema (`online_poker_*` base tables + `online_poker_hand_events`
log + play-chip ledger + **durable idempotency-key UNIQUE**), `op_*` SECURITY DEFINER RPCs,
Edge `online-poker-action`, and a **private forensic capture from hand #1** (IP / device
fingerprint / act latency / client seed) so Phase-3 anti-cheat is possible later (append-only
logs cannot be backfilled). Then GE-3 realtime + reconnect, GE-4 minimal table UI, GE-5
audit/replay (+ per-hand `engine_version` pinning for deterministic replay; wire provable-fair).
Phase-2 actor: single-owner lease, atomic persist-before-broadcast, secrets recovery on reload.

**Next recommended patch:** GE-2 Patch A schema — the pure engine is now proven and stable.

---

## GE-1.5 — source-only engine hardening (2026-06-13, branch `agent/game-engine-ge1-source-dev`)

Added on top of GE-1 (all pure TS, no runtime, no DB):

- **`contracts.ts`** — the shared game state contract (project Task 3):
  `ActionRequest` (intent + idempotencyKey) / `ActionResult`, strict `ChipString`
  codec (`parseChip` rejects non-canonical strings), bigint-free wire views
  (`toWirePublicState` / `toWirePrivateState` / `toWireLegalActions`, built on
  views.ts so secrecy holds by construction), `classifyActionError` stable
  rejection codes, `envelopeEvents` (persistence-assigned seq).
- **`invariants.ts`** — `checkInvariants`/`assertInvariants` runtime state
  checker (conservation, card integrity, turn pointer, side-pot partition,
  completion consistency) for the persistence/replay path.
- **`replay.ts`** — `replayHand(HandScript)` deterministic replay +
  `ReplayError`; asserts invariants at every step. Public events are NOT a
  replay source (deltas vs raise-to totals) — persistence stores actions.
- **Engine fix (found by the new checker):** `awardFoldToOne` now closes street
  metadata exactly like `closeRoundAndAdvance` (committed reset, currentBet 0,
  aggressor null). Before, a refunded raiser's completed state carried
  `committed > totalCommitted` onto the wire. Regression test in lifecycle.test.ts.
- **New tests:** `contracts.test.ts`, `replay.test.ts` (incl. 25 seeded random
  hands replayed bit-for-bit), `illegalActions.test.ts` (rejection side-effects
  matrix: same reference, zero events, byte-identical input). Engine suite
  38 → 63 tests.
- **Spec doc:** `docs/engine/GAME_ENGINE_SPEC.md` — the engine behavior contract.

Deliberately NOT added: an Edge Function entrypoint (push-to-main auto-deploys
Edge Functions = runtime enablement; wrapper code waits for the owner-approved
GE-2 Patch C session).

---

## Checkpoint — 2026-06-13 (end of GE-1 + GE-2 Patch A session)

> SUPERSEDED 2026-06-13 (later the same day): all GE-1 files below are now
> COMMITTED on branch `agent/game-engine-ge1-source-dev` together with the
> GE-1.5 additions. Kept for historical record.

**Branch:** `main` (local — 55 commits behind `origin/main`; do NOT pull until owner confirms)

**GE-1 local files (uncommitted — preserve, do NOT delete):**

Engine (12 files, all untracked `??`):
- `supabase/functions/_shared/pokerEngine/types.ts`
- `supabase/functions/_shared/pokerEngine/deck.ts`
- `supabase/functions/_shared/pokerEngine/evaluate.ts`
- `supabase/functions/_shared/pokerEngine/betting.ts`
- `supabase/functions/_shared/pokerEngine/pots.ts`
- `supabase/functions/_shared/pokerEngine/hand.ts`
- `supabase/functions/_shared/pokerEngine/showdown.ts`
- `supabase/functions/_shared/pokerEngine/views.ts`
- `supabase/functions/_shared/pokerEngine/events.ts`
- `supabase/functions/_shared/pokerEngine/shuffle.ts`
- `supabase/functions/_shared/pokerEngine/provableFair.ts`
- `supabase/functions/_shared/pokerEngine/index.ts`

Tests (7 files, all untracked `??`):
- `tests/pokerEngine/fixtures.ts`
- `tests/pokerEngine/evaluate.test.ts`
- `tests/pokerEngine/pots.test.ts`
- `tests/pokerEngine/showdown.test.ts`
- `tests/pokerEngine/betting.test.ts`
- `tests/pokerEngine/lifecycle.test.ts`
- `tests/pokerEngine/invariants.test.ts`

Config (untracked `??`): `tsconfig.engine.json`

Modified (not staged): `package.json` (+fast-check dep, +typecheck:engine script), `package-lock.json`, `vitest.config.ts` (+@engine alias), `public/version.json`, `src/components/Layout.tsx`

**Source-only migrations now in `origin/main` (NOT applied to live DB):**
- `20260817000000_online_poker_core.sql` (merged PR #26, commit b912662)
- `20260817000001_online_poker_realtime.sql` (merged PR #26)
- `20260817000002` (Room Reconcile — PR #27)
- `20260817000003_fix_executor_step9_incoming_credit.sql` (merged PR #30, commit 76ebf24)

**Live DB state:** UNCHANGED — no online_poker_* tables exist in production yet.

**DB/deploy safety confirmed:**
- schema_migrations changed: NO
- deploy_db=true used: NO
- supabase db push used: NO
- pending migrations applied: NO
- secrets exposed: NO

**GE-2 Patch C (RPCs, Edge, frontend):** NOT STARTED. Do not start until owner explicitly opens that session.

**Next global step (owner-approved):** Controlled live apply of `20260817000003_fix_executor_step9_incoming_credit.sql` in a dedicated Supabase/DB session (Dealer Swing executor worked-minutes fairness fix). Then Payroll B5. Then Room Reconcile `20260817000002`. Then HRC Preflop Study S1. GE-2 live apply and Patch C are last.
