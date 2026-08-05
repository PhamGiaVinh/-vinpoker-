# Dealer Trigger / Edge Auth Incident - 2026-08-05

## Classification

`P0 - EDGE SERVICE-ROLE AUTHORIZATION BYPASS`

The pre-containment `process-swing-on-dealer-ready` handler accepted any request whose
`Authorization` header merely began with `Bearer `, then constructed a service-role client.
`send-push-notification` relied on platform JWT verification but did not authorize an internal
database trigger caller in its handler. The two database trigger functions also contained a
legacy anon JWT literal. That legacy key is not a service-role key, but it is not a valid internal
authorization boundary.

No raw credential, secret, token, or decoded key is recorded in this document.

## Live Evidence

Evidence is stored outside Git at the operator evidence path recorded in the deployment receipt.
The evidence was redacted before retention.

- Before containment, an arbitrary non-secret Bearer header reached the dealer handler and
  returned the handler's malformed-payload response (`400`), proving it passed the old header
  prefix check.
- Pre-change live catalog showed `process-swing-on-dealer-ready` version `37` with
  `verify_jwt=false`, and `send-push-notification` version `35` with `verify_jwt=true`.
- Both trigger functions were `SECURITY DEFINER`, contained a token-shaped literal, and had
  direct `EXECUTE` grants broader than a trigger-only contract requires.

## Emergency Containment Applied

The following Edge-only change was deployed before database migration work:

- `process-swing-on-dealer-ready` version `38`, `verify_jwt=false` with custom internal auth.
- `send-push-notification` version `36`, `verify_jwt=false` with custom internal auth.

Until `DEALER_TRIGGER_INTERNAL_SECRET` is provisioned in Edge, both endpoints fail closed before
creating a service-role client or provider request. Post-deploy arbitrary-Bearer probes returned
`503 internal_auth_not_configured` for both endpoints. Existing database triggers therefore cannot
trigger Dealer Swing or push dispatch during this containment window.

## Source-Only Follow-up

Migration `20270106000004_dealer_trigger_edge_auth_containment.sql` is pending review and
controlled application. It replaces only `notify_dealer_ready_v2()` and `fn_dispatch_push()`.

- It obtains `VINPOKER_SUPABASE_URL`, `VINPOKER_EDGE_PUBLISHABLE_KEY`, and
  `DEALER_TRIGGER_INTERNAL_SECRET` from Vault.
- It sends `apikey`, a dedicated internal-secret header, and deterministic event identities.
- It removes all credential fallbacks and revokes unnecessary direct execution from `PUBLIC`,
  `anon`, `authenticated`, and `service_role`.
- It preserves the existing state-transition predicate and keeps the attendance transaction alive
  when a required Vault secret is unavailable.

## Gates Still Closed

- No Vault or Edge secret has been provisioned by this source change.
- No database migration has been applied and no migration ledger was changed.
- Disposable PostgreSQL/Supabase validation is blocked because Docker Desktop has no responding
  Server. `pg_net` rollback behavior and trigger grant behavior remain unmeasured.
- Exact TEST-only Dealer release UAT remains blocked. No real dealer assignment, Tracker,
  settlement, Hand #8, Close Table business logic, or feature flag was changed.

`PR2A remains blocked.`
