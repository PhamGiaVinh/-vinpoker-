# Tracker Unified Ops V2 Contract

Status: source-only contract lock. This document does not apply a migration,
change a live RPC, deploy an Edge Function, or enable a feature flag.

## Authority Boundary

| Domain | Owner | V2 authority |
|---|---|---|
| Entry and payment | Cashier | Creates the financial entry; outside Tracker writes |
| Roster and between-hand stack | Floor | Seats, moves, mode, bust/restore, and narrow correction |
| Hand operation | Tracker | Starts, records, resumes, or explicitly voids a hand |
| Physical chip inventory | ChipMaster | Observes and acknowledges a correction; never edits player stack |
| Pot, winner, settlement | Existing settlement path | Unchanged by Unified Ops V2 |

Projection A is mandatory between hands:

```text
tournament_seats.chip_count
= tournament_chip_counts.chip_count
= tournament_entries.current_stack
```

The browser sends intent only. Server authorization and invariants remain the
security boundary.

## Canonical Identity

The canonical route is:

```text
/tracker/hand-input?t=<tournament_id>&tt=<tournament_tables.id>
```

`tt` is always `tournament_tables.id`. `physical_table_id` is returned for
display and compatibility, but no V2 mutation accepts it.

A legacy identifier may be canonicalized only through the server table list:

1. Exactly one match: replace the URL with canonical `tt`.
2. Zero matches: `table_not_found`.
3. More than one match: `ambiguous_table_identity`.

The client must never choose the first row from an ambiguous result.

## Server Interface

```sql
list_tracker_tables_v2(p_tournament_id uuid) returns jsonb
get_tracker_table_context_v2(
  p_tournament_id uuid,
  p_tournament_table_id uuid
) returns jsonb
start_tracker_hand_v2(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_button_seat integer,
  p_expected_context_version text,
  p_idempotency_key text
) returns jsonb
floor_correct_tracker_stack_between_hands(
  p_tournament_id uuid,
  p_tournament_table_id uuid,
  p_seat_id uuid,
  p_expected_old_stack bigint,
  p_new_stack bigint,
  p_reason_code text,
  p_note text,
  p_expected_context_version text,
  p_idempotency_key text
) returns jsonb
ack_tracker_stack_correction(
  p_correction_id uuid,
  p_idempotency_key text
) returns jsonb
void_tracker_hand_v2(
  p_hand_id uuid,
  p_expected_context_version text,
  p_reason_code text,
  p_note text,
  p_idempotency_key text
) returns jsonb
```

No V2 start intent contains authoritative hand number, hand time, roster,
stack, level, actor, or physical table ID.

## Context Version

`context_version` is a server-generated SHA-256 token over canonical JSONB. The
client stores and returns it without computing, parsing, or weakening it.

Included:

- tournament and canonical table state;
- control mode and revision;
- active entry-backed roster, sorted by seat then stable ID;
- seat, tracker, and entry stack projections;
- active hand identity, owner, and stable `lock_version`;
- next hand number preview;
- level ID/number, SB, BB, BBA (`ante`), break, and clock pause state.

Excluded:

- display name and avatar;
- localized messages;
- ChipMaster warning presentation;
- lock lease timestamps such as `locked_at`;
- UI layout state.

Objects use recursively sorted keys. Arrays are explicitly sorted before JSONB
serialization. `contextHashVectors.ts` is the cross-language fixture for the
future PostgreSQL implementation.

`TrackerActiveHandV2` still returns `locked_at` and `lock_state` for display.
The hash does not contain `locked_at`: a heartbeat that only renews the lease
timestamp must not change `context_version`. Takeover, release, or lock-owner
change increments the server-owned `lock_version`. Lock freshness is computed
from server time during each read or mutation, never from a client clock.

## Idempotency

The server owns idempotency scope and canonical request hashing:

```text
(operation, actor_user_id, tournament_id, idempotency_key)
```

Supported operation names are `start_hand`, `correct_stack`,
`ack_stack_correction`, and `void_hand`.

Every mutation transaction follows this order:

1. Acquire the operation/tournament lock.
2. Look up the idempotency record.
3. Same scope and canonical request hash returns the persisted receipt/result
   with `replayed=true`.
4. Reuse with a different request hash, actor, or operation returns
   `idempotency_mismatch`.
5. Only a new key proceeds to context-version and business validation.
6. Receipt and business mutation commit or roll back together.

Therefore a retry after a successful start returns the original hand receipt;
it must not fail `stale_table_context` merely because the first request changed
the table context. The canonical request hash excludes localized labels and
client timestamps. The browser creates an opaque key, but cannot choose scope
or request hash.

## Locking and Start

Every competing V2 mutation takes the tournament advisory lock first, then:

```text
tournament
-> tournament table
-> active hand
-> seats
-> entries
-> chip counts
-> current level
```

The start RPC recomputes context under lock. It derives hand number, time,
entry-backed roster, stacks, and level on the server.

An active hand is never auto-voided. Start returns `active_hand_exists` with:

```text
hand_id
lock_state = mine | other | stale
allowed_action = resume | request_takeover | explicit_void
```

Void is a separate, audited, idempotent action. It does not delete evidence or
change player stacks.

## Readiness

Readiness is machine-readable:

```ts
{
  state: "ready" | "blocked";
  blockers: TrackerReadinessItemV2[];
  warnings: TrackerReadinessItemV2[];
}
```

Each item contains `code`, `severity`, `owner`, `message_key`, `target`, and
`remediation`. The fixed code lists live in `contracts.ts`.

`clock_paused` is a warning when the current level is otherwise valid.
`tournament_break_active` is always a blocker. ChipMaster conditions remain
warnings in V2.

The server recomputes blockers. It never trusts readiness sent by a client.

A valid current context that still has business blockers returns the dedicated
mutation envelope:

```ts
{
  ok: false;
  error: "readiness_blocked";
  message_key: string;
  context_version: string;
  readiness: TrackerReadinessV2;
}
```

Start, stack correction, and explicit void use this envelope in addition to
their generic mutation failures. Authentication, not-found, stale context, and
idempotency mismatch remain explicit generic failures; readiness codes are not
copied into the generic error union.

## Roles

| Action | Server role |
|---|---|
| Read full context | Tracker, Floor, owner/super-admin in club |
| Start, record, or void hand | `is_club_tracker`, including authorized owner/super-admin |
| Mode, roster, move, correction | Floor or authorized owner/super-admin |
| Edit display name/avatar | Tracker, Floor, or owner |
| View narrow correction projection / ack worklist | ChipMaster or owner |
| Public replay | Separate public contract |

Capabilities returned to the UI control presentation only. Every
`SECURITY DEFINER` function derives the actor from `auth.uid()`, enforces club
scope, and revokes `PUBLIC`, `anon`, and `service_role` execution.

ChipMaster does not have `read_context` and cannot open the full exact-table
Hand Input roster. Its surface is limited to the physical-chip projection and
correction acknowledgement worklist.

## Stack Correction

Allowed reason codes:

```text
physical_recount
operator_entry_correction
post_table_move_reconciliation
```

Correction runs only between hands and CAS-checks the old stack and context.
It atomically updates all three stack projections. `new = old` returns
`unchanged`. `new = 0` does not bust the player.

Correction rows are immutable. Acknowledgement is a separate event meaning
"seen for physical-chip review"; it does not change inventory, hand,
settlement, or stack.

## UI and Rollout Gate

`trackerUnifiedOpsFlow` remains `false` in every mergeable PR before owner UAT.

When false:

- production behavior remains unchanged;
- no V2 RPC is queried;
- legacy writer components remain available as the rollback path.

When true in an owner-approved preview:

- old embedded Hand Input, Seat Setup, and Chip Quick Edit are unmounted;
- the exact-table V2 console is the only hand writer;
- Floor-only users receive a read-only handoff view.

This contract authorizes PR0 and PR1 source-only work only. It does not
authorize PR2A-PR5, DB apply, deploy, flag enablement, or settlement changes.
