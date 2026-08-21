# Tracker `record_action` authority hotfix

## Scope

This source-only P0 patch closes a same-club operator-lock bypass in the
canonical action path:

```text
handleAction -> tournament-live-update -> record_action
```

No production migration, Edge deployment, frontend deployment, feature flag,
secret, tournament data, or hand result was changed while preparing this PR.

## Security contract

- `auth.uid()` is the only action and lock authority.
- The legacy `p_user_id` parameter remains ABI-compatible: `NULL` uses
  `auth.uid()`, an exact match is accepted, and a mismatch returns
  `actor_mismatch` without writing.
- `record_action` locks the canonical hand row and requires a non-null, fresh
  lock held by the authenticated actor. It never claims, refreshes, takes over,
  clears, or attributes a lock.
- `heartbeat_lock` is the only claim/refresh/takeover path. It is
  `SECURITY DEFINER`, has a fixed `search_path`, derives club scope from the
  hand, and writes `auth.uid()` only.
- Both exact overloads revoke `PUBLIC`, `anon`, and `service_role`; only
  `authenticated` receives `EXECUTE`.
- The Edge caller preserves the operator JWT when calling the RPC and turns a
  JSONB action denial into HTTP `409` instead of a successful envelope.

## Future migration safety

`20270112000003_tracker_voice_player_analytics_v0.sql` is not present in the
production ledger. Its future `record_action` and `heartbeat_lock` definitions
now preserve the same actor and strict-lock invariants, so a later Voice apply
cannot restore the old implicit lock claim.

Voice state versions now exclude lock owner, lock timestamp, and lock revision.
Those fields are authorization metadata and are checked independently by the
canonical writer. Including them made a valid Voice proposal stale when its
authenticated Dealer claimed the required lock before committing it.

## Local evidence

All database execution used a standalone disposable PostgreSQL 17 container.
The local Supabase stack and every remote environment were excluded.

- Current-schema hotfix harness: `PASS`.
  It covers unauthenticated, cross-club, Floor, missing/fresh/stale/ambiguous
  locks, actor mismatch, idempotency conflict, and two concurrent callbacks.
- Final future chain: `PASS`.
  `baseline -> 080 -> Voice dependencies -> 12003 -> 12004 -> Voice suite`
  covers canonical Voice action/retry, correction pending, alert concurrency,
  immutable events, RLS, analytics authorization, and injected Voice rollback.
- Exact migration transaction rollback: `PASS`.
  An injected `division by zero` exited non-zero and neither newly-created
  function remained after the transaction rolled back.
- Contract/client tests: `16/16 PASS`; Deno Edge check, migration catalog,
  credential-context guard, and `git diff --check` passed.

## Apply gate

Production remains owner-gated. Before an owner-controlled apply, capture the
exact live definitions, owner, `prosecdef`, `proconfig`, ACL, overload count,
and grants for `record_action(uuid,uuid,text,integer,integer,text,integer,text,text,uuid)`
and `heartbeat_lock(uuid,uuid)`. Apply only
`20270112000004_tracker_record_action_authority_binding.sql` inside the
approved transaction runbook, then re-check those same invariants. Do not use
`supabase db push`, migration repair, Edge deployment, or a feature-flag change
as part of this hotfix apply.
