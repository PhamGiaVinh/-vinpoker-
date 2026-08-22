# Tracker `start_hand` Authority Hotfix

## Scope

This is a source-only P0 lock-authority patch. It binds the legacy Tracker
`start_hand(uuid, uuid, integer, timestamptz, uuid, integer)` actor to
`auth.uid()` without changing its public signature or its hand-start business
flow. It does not apply any migration, deploy an Edge Function or frontend,
change a feature flag, or change tournament data.

## Canonical caller contract

`tournament-live-update` authenticates the incoming bearer token with
`auth.getUser()` and invokes `start_hand` through a request-scoped client that
forwards that same `Authorization` header. Therefore the database session
identity is the real signed-in operator: `auth.uid() = user.id`.

The frontend does not call `start_hand` directly. `p_created_by` remains only
for caller compatibility:

| Input | Result |
| --- | --- |
| `NULL` | use `auth.uid()` |
| equals `auth.uid()` | accepted |
| differs from `auth.uid()` | `actor_mismatch`, zero writes |

Both `created_by` and `locked_by_user_id` are written from the verified actor.

## Effective lock-writer matrix

The table lists effective writers after normal migration filename order; an
entry that only clears a lock as part of a terminal state is not an ownership
assignment.

| Writer | Effective source | Identity authority | Lock effect | Classification |
| --- | --- | --- | --- | --- |
| `start_hand(uuid,uuid,integer,timestamptz,uuid,integer)` | `20270112000005` | `auth.uid()` with Tracker/owner/super-admin club check | creates hand and assigns owner/fresh timestamp | patched safe |
| `heartbeat_lock(uuid,uuid)` | `20270112000005` fallback or reviewed Voice definition | `auth.uid()`; compatibility UUID must match | refreshes/claims only for authenticated permitted actor | safe |
| `takeover_hand_lock(uuid,boolean,uuid)` | `20261221000000` | `auth.uid()`; compatibility UUID must match | assigns new owner after existing takeover policy | safe |
| `record_action(...,uuid)` | `20270112000004` | `auth.uid()`; compatibility UUID must match | verifies fresh owner, does not transfer it | safe after 12004 |
| `update_community_cards(uuid,jsonb,uuid)` | `20270112000005` | `auth.uid()`; compatibility UUID must match | requires fresh self-owned lock and refreshes timestamp | patched safe |
| `show_hole_cards(uuid,jsonb,uuid)` | `20270112000005` | `auth.uid()`; compatibility UUID must match | requires fresh self-owned lock and refreshes timestamp | patched safe |
| `delete_last_action(uuid,uuid)` | `20270112000005` | `auth.uid()`; compatibility UUID must match | requires fresh self-owned lock and refreshes timestamp | patched safe |
| `record_hand(...)` | `20270110000005` | actor already bound to `auth.uid()` | clears lock only when completing the hand | terminal release, no owner assignment |
| `void_last_hand(uuid)` | `20261225000000` | no client owner parameter | clears lock only while voiding the target hand | terminal release; separate business-policy surface |
| legacy start retries/stale handling | preserved in `start_hand` | verified actor on every new/returned hand | may void a stale active hand under existing policy | pre-existing business policy, not an identity bypass |

No remaining effective writer accepts a client UUID and assigns it to
`locked_by_user_id` without first requiring equality with `auth.uid()`.

## Migration ordering and non-regression

`20270112000003` defines the Voice-aware heartbeat and `20270112000004` patches
the current-production fallback when Voice tables are absent. Neither migration
defines `start_hand`. This hotfix is versioned after both, so its
`start_hand` definition is final in the reviewed source order. Its Voice branch
does not overwrite the Voice heartbeat; it verifies the Voice definition still
contains actor binding and mismatch rejection.

The contract test fails if the effective source definition writes the lock from
`p_created_by`, lacks an `auth.uid()` actor gate, omits mismatch rejection, or
restores `PUBLIC`/`anon` execute access.

## ACL target

The patched functions are `SECURITY INVOKER` except the established heartbeat
implementation, which remains `SECURITY DEFINER` with `search_path = public`.
The migration revokes execute from `PUBLIC`, `anon`, and `service_role`, then
grants only `authenticated` for the protected legacy Tracker RPCs.

## Validation boundary

The disposable PostgreSQL harness covers unauthenticated, same-club
unauthorized, cross-club, forged/self/null actor values, combined 12004 action
authority, stale takeover, concurrent starts, and injected migration rollback.
It is not a production apply. Production rollout remains owner-gated and must
apply `20270112000005` first, read back the function/ACLs, then apply 12004 and
verify the whole lock-authority invariant.
