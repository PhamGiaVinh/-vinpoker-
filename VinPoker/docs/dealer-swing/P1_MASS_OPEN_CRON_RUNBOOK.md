# Dealer Swing P1 Drift Runbook

## Release status

This CRITICAL/RED change remains **NOT_READY** until every production gate has current evidence.

- PR-Drift is source-only. Its author does not apply a migration, deploy Edge, merge, enable a flag, or mutate live data.
- Never apply historical migrations `20270102000002_process_swing_cron_dispatch_observer.sql` or `20270102000003_dealer_open_operations.sql` to production.
- Do not replay `20261223000000_end_breaks_on_demand.sql`; live inventory shows it is also absent, so the exact canonical helper definition is included in the forward migration.
- The only approved DB artifact is the forward migration `20270104000002_dealer_swing_contract_drift.sql` after owner review.
- Durable mass-open stays dark by default: `enabled=false`, `all_clubs_enabled=false`, and an empty allowlist.
- Existing assignments remain untouched. Do not reset the 19 staffed incident tables.

## G0 prerequisites

1. PR-ControlPlane #923 is merged and its production workflow revision is active.
2. Critical Edge deploy remains manual, exact-SHA, function-selective, and protected by the target-aware schema probe.
3. Record the exact reviewed commit SHA and selected contract profile. Current PR-Drift source must resolve to `dealer_mass_open_v1`; an unknown profile stops the release.
4. Confirm no unrelated migration, Edge function, or frontend artifact is included.
5. Take read-only pre-apply definitions and ACL evidence for:
   - `get_process_swing_due_club_ids()`;
   - `run_process_swing_cron()`;
   - current process-swing cron jobs;
   - fenced club-lock functions;
   - `swing_run_metrics` runtime percentiles.

## Controlled DB apply

Owner approval is required for this production mutation.

1. Verify migration inventory and confirm `20270104000002` is absent and unique.
2. Verify historical `20270102000002` and `20270102000003` remain unapplied. Do not mark them applied and do not replay them.
   Also verify `20261223000000` remains unapplied; the forward migration supersedes only its missing function definition and ACL.
3. Run the #923 current-target contract probe before apply; it must fail on the missing operation/dispatch contract. This is the expected negative control.
4. Apply only the exact reviewed file `20270104000002_dealer_swing_contract_drift.sql` in the controlled owner window. Do not use `db push --include-all`.
5. Run the same target-aware contract probe again. It must pass before any Edge deployment is allowed.
6. Verify the forward migration did not execute business work. It may replace cron definitions and schedule the dispatcher/observer jobs, but it must not invoke `process-swing` inside the migration transaction.

Post-apply checks:

- `get_process_swing_due_club_ids()` retains the live work filter.
- `run_process_swing_cron()` contains no `net._http_response` read and no 8-second timeout.
- `process-swing` and `process-swing-observer` are distinct one-minute jobs.
- Dispatcher timeout is 55 seconds; observer deadline is timeout plus 30 seconds.
- Dispatcher sends one correlated body per club: `club_id`, `run_id`, `request_id`, `tick_at`.
- At most ten due clubs are selected per tick and older/not-yet-dispatched clubs are not starved.
- Transport status and business status are stored separately.
- Claim/finalize RPCs are service-role-only; anon/authenticated cannot execute them.
- Operation RPC signatures have no ambiguous overloads and retain reviewed ACLs.
- Operation/dispatch tables have RLS enabled and no direct anon/authenticated access.
- Runtime rollout remains OFF with an empty allowlist.

## Dark Edge deploy

Owner approval is required for each deploy action.

1. Use the PR-ControlPlane manual workflow with the exact reviewed commit SHA.
2. Deploy only `process-swing` first. Preserve its existing `verify_jwt=false` posture and internal-secret authentication.
3. Confirm a correlated TEST request is claimed once; replay returns `duplicate` and does not rerun business logic.
4. Confirm an empty-table dependency failure is recorded as `dependency_unavailable` or `partial`, while later rotation passes still execute.
5. Confirm degraded availability does not trigger shortage/pool-empty Telegram from this tick.
6. Deploy only `mass-assign` after the live operation contract passes. Preserve `verify_jwt=true`.
7. Confirm missing schema/query dependencies return non-2xx or an explicit failed outcome, never `success=true` with empty assignments.
8. Keep durable mass-open rollout OFF. This PR does not enable HSOP or any other club.

## Dark monitoring

Observe at least five normal dispatcher ticks before any later canary decision:

- one run/request correlation per dispatched club;
- no duplicate business execution during overlapping cron ticks;
- observer timeout does not block the next dispatcher tick;
- HTTP timeout changes transport state only;
- Edge completion can record business completion after transport timeout;
- a failure for one club does not prevent unrelated clubs from dispatching;
- structured diagnostics contain no credential, Authorization header, or raw secret;
- rotation metrics continue when empty-table fill is degraded.

Production canary and alert wording are outside PR-Drift. They require later owner-gated PRs in sequence.

## Emergency containment

1. Keep `dealer_mass_open_rollout.enabled=false`; this is the immediate mass-open write stop.
2. If the new Edge bundle is faulty, use PR-ControlPlane to deploy only the affected function from an exact verified artifact/SHA. Do not infer a rollback target from an Edge version number.
3. If observer load is unhealthy, unschedule only `process-swing-observer`. Do not stop business dispatch solely because transport observation is degraded.
4. If dispatcher behavior is unhealthy, restore the exact pre-apply `run_process_swing_cron()` definition and cron schedule captured in G0. Do not restore an 8-second timeout or a response scan inside the dispatcher.
5. Keep additive operation/dispatch history for evidence. Do not delete operation rows, dispatch rows, assignments, or audit records during incident response.

## Local evidence required in PR

- Current production public-schema dump restored to clean PostgreSQL 16 and PostgreSQL 17 disposable databases, with minimum pg_net/Vault/cron stubs.
- Forward migration apply and reapply pass on both versions.
- SQL assertions cover signatures, ACL, RLS, default-OFF rollout, bounded dispatch, missing secret, transport/business separation, claim replay, and cross-club scope.
- Concurrent same-club ticks create no duplicate club/request run; same-run claims yield one `claimed` and one `duplicate`; different clubs claim independently.
- Deno tests/checks, target-aware contract tests, Node/Vitest/build, migration inventory, diff audit, and secret grep pass.

Local/source evidence is not proof that DB, Edge, cron, frontend, or flags are live.
