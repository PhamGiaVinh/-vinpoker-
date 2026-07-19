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

The live schema probe is intentionally expected to block `process-swing` and `mass-assign` while
their operation-table contract is absent. Do not bypass that result.
