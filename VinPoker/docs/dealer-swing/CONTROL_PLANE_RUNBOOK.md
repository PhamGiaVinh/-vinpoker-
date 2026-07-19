# Dealer Swing Critical Deployment Control Plane

Status: source-only. This runbook does not authorize a production deployment or database apply.

## Protected environment prerequisite

Create the GitHub environment `dealer-swing-production-critical` and configure at least one
required reviewer. The workflow checks the environment through the GitHub API before entering the
deployment job. A missing environment or an environment without required reviewers fails closed.

Do not place credentials in Repository Variables. Deployment credentials remain GitHub Secrets and
must not be printed by a workflow step.

## Critical Edge deployment

`process-swing`, `mass-assign`, and `checkout-dealer` never deploy on a push to `main`.

1. Merge reviewed source while the production gate remains off.
2. Copy the exact 40-character commit SHA from `main`.
3. Run `Deploy reviewed production source` manually from `main`.
4. Enter that SHA and select every critical function whose full receipt-to-target diff is listed.
5. When frontend is selected, include every critical dependency required by the plan.
6. Approve the protected environment only after target quality and live contract probes pass.

The workflow verifies that the SHA is reachable from `origin/main`, that each selected function
changed since its own last successful deployment receipt, and that the live schema satisfies its
machine-readable contracts. Reviewed tooling is loaded from `control-plane/`; deployable source is
loaded independently from `target-source/`. This permits a reviewed rollback to an older source SHA
without trusting scripts from that older commit.

## Target-aware contract profiles

The operator cannot select or override a contract profile. The reviewed control plane walks the
exact imported graph for `process-swing`, `mass-assign`, and `checkout-dealer`, then includes the
Dealer Swing frontend operation callers from the exact `target-source/` checkout. The deployment
plan records the selected profile, source SHA-256 fingerprint, and marker evidence.

- `dealer_swing_legacy` applies only when the imported graph contains the legacy empty-table path
  and contains no durable mass-open marker. It checks every relation and RPC statically referenced
  by that exact legacy graph, but does not require operation tables, columns, rollout or operation
  RPCs.
- `dealer_mass_open_v1` requires the complete `fillOpenOperation` marker set, operation relations,
  `dealer_open_operation_id`, rollout access and frontend operation RPC callers. It adds the full
  durable-operation contract to the source-derived dependencies.

Partial or contradictory markers stop planning with `UNKNOWN_TARGET_CONTRACT_PROFILE`. A current
mass-open target cannot be forced through the legacy profile. Every preflight and immediate
pre-deploy schema probe recomputes the profile from the same exact target checkout.

The mass-open profile checks exact argument names/types, rejects ambiguous overloads, requires
`authenticated` EXECUTE and `anon` denial for `get_dealer_mass_open_rollout`,
`get_dealer_open_operation` and `operator_open_dealer_tables`, and requires service-role-only access
to `_refresh_dealer_open_operation`. The refresh helper is a transitive server contract for the
frontend operation path; the browser does not call it directly.

Each successful component deployment records a GitHub Deployment receipt under a component-specific
environment. A failed deployment writes no success receipt. A later rollback writes a new successful
receipt pointing to the older exact SHA. Operators never type or choose a baseline SHA.

If a component has no receipt, planning fails closed by treating it as changed. The initial frontend
deployment therefore requires all three critical Dealer Swing functions to be selected and pass,
unless their receipts have already been established by successful manual deployments.

## Push-main behavior

- Critical Edge changes remain dark and are listed in the workflow summary.
- No Edge function auto-deploys from this shared push-main workflow. Noncritical functions require a
  dedicated workflow or a separately reviewed control-plane change.
- A shared Edge dependency is diffed independently from every critical component receipt.
- Frontend deployment runs only when its full frontend receipt-to-target diff changed and all live
  operation contracts pass.
- A frontend with held or missing critical receipts remains dark until a successful manual dispatch.
- Workflow, documentation, migration, and deployment-tooling-only changes do not deploy frontend.

## Pre-approval evidence

Before GitHub requests protected-environment approval, the workflow publishes target SHA, every
component receipt baseline, direct/shared file counts, selected and held functions, JWT posture,
contract count, frontend decision, source scan, Deno check/tests, production build, scoped Vitest and
live schema probe status. Missing source directories, imports, tests or operation contracts stop the
workflow before approval.

The separate `Validate deployment control plane` PR workflow runs actionlint `1.7.7` after verifying
the pinned release archive checksum. It has read-only repository permission, references no
production secret, and has no deploy or database mutation step.

## Database migration policy

The general production workflow does not apply migrations. In particular, it never runs
`supabase db push` or `--include-all`.

Migration `20270102000002_process_swing_cron_dispatch_observer.sql` is
`SUPERSEDED_DO_NOT_APPLY`: keep the historical file unchanged and do not mark it applied. Any
controlled database change must use a dedicated owner-approved runbook with an exact migration
allowlist and must stop on the first failure.

## Local verification

From `VinPoker/`:

```powershell
node --test scripts/deploy/*.test.mjs
node scripts/deploy/validate-control-plane.mjs
npm run check:credential-context
deno test --allow-env --allow-read scripts/deploy/target-source-policy.test.ts
```

For a current mass-open target, the live schema probe intentionally blocks while any operation
object or required ACL is absent. An exact pre-#922 rollback target may pass the legacy profile on a
schema without operation objects, but still fails when any dependency actually imported by that
legacy source is missing. Do not bypass either result.
