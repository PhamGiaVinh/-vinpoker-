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
4. Enter that SHA and select only functions changed by that exact commit.
5. Approve the protected environment after reviewing the generated plan.

The workflow verifies that the SHA is reachable from `origin/main`, that each selected function
changed in that commit, and that the live schema satisfies its machine-readable contracts. It then
deploys only the selected function with the JWT posture in
`scripts/deploy/deployment-contracts.json`.

## Push-main behavior

- Critical Edge changes remain dark and are listed in the workflow summary.
- A noncritical Edge function deploys only when its own managed directory changed.
- A shared Edge dependency change never fans out automatically.
- Frontend deployment runs only for frontend source changes and only after a live schema probe.
- A frontend changed in the same commit as critical Edge source remains dark until manual dispatch.
- Workflow, documentation, migration, and deployment-tooling-only changes do not deploy frontend.

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
```

The live schema probe is intentionally expected to block `process-swing` and `mass-assign` while
their operation-table contract is absent. Do not bypass that result.
