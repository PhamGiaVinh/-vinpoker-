# Ops Club Operator Invites — Preview Runbook

## Boundary

This runbook is for the persistent `ops-staging` Preview environment only. It
does not authorize a production database change, an Edge deployment outside
`ops-club-accounts`, a flag change, or a merge.

## Source order

Apply only these reviewed files, in this order, using the Preview migration API:

1. `20270108000000_ops_operator_membership_baseline.sql`
2. `20270108000001_ops_club_operator_invites.sql`

Do not use a bulk migration command. Before applying, record the Preview project
identity, PostgreSQL version, migration ledger, Auth-user count, current Edge
function list, and the exact non-production frontend host.

## Preflight

- Configure only the GitHub Environment `ops-staging` with these protected
  input names: `FLOOR_UAT_SUPABASE_URL`, `FLOOR_UAT_PROJECT_REF`,
  `FLOOR_UAT_PRODUCTION_DOMAIN`, `FLOOR_UAT_SUPABASE_ANON_KEY`, and
  `VERCEL_TOKEN`. Their values must point only to the persistent Preview
  target; do not record values in source, chat, or this runbook.
- Do not configure `FLOOR_UAT_BASE_URL`: the workflow derives it from the
  source-pinned Vercel Preview deployment and validates it against the
  production domain before any provisioning step.
- Confirm both migration versions are absent from the Preview ledger.
- Confirm the target is the persistent Preview project, not the production ref.
- Run the disposable PostgreSQL workflow, Deno checks, Ops boundary check,
  credential-context guard, source scans, and production build.
- Resolve the exact Preview frontend deployment. Verify `/ops`,
  `/ops/login`, and `/ops/auth/callback` return the Ops shell before configuring
  redirects.

## Apply and verify

After applying the two files, verify only the reviewed tables, policy contracts,
and `get_my_floor_operator_scope()` were added. Verify the scope is caller-bound,
has a fixed search path, permits `authenticated`, and denies anonymous callers.
Verify the invitation event table is append-only to browsers and owner-readable
for the owning club.

Deploy only `ops-club-accounts` from the reviewed commit. Configure the exact
Preview callback URL and expected origin through protected environment settings;
do not record their values in source, logs, or this document.

## UAT and cleanup

Use only exact `CODEX_OPS_INVITE_UAT_` fixtures. Test invitation, resend,
acceptance, sign-out/sign-in, scope removal after revoke, cross-club denial, and
concurrent accept/revoke. Remove only the exact fixture IDs created by the run
and verify all five remaining counts are zero: invites, events, memberships,
clubs, and Auth users.

Record the source SHA, migration ledger, Edge version, frontend host, checks,
and cleanup counts in the Draft PR. A failed preflight or cleanup is a stop
condition, not a reason to broaden the migration scope.
