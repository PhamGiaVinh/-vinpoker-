# Dealer Swing Shortage Alert Rollout

## Purpose

This runbook rolls out the canonical Dealer Swing shortage alert. It replaces the
old all-tables-OT message with a planner-backed classification and a durable,
service-only incident ledger. It does not enable durable mass-open.

## Scope and invariants

- Apply only `20270104000005_dealer_shortage_alert_lifecycle.sql` after owner approval.
- Deploy only the reviewed `process-swing` source SHA through the protected
  ControlPlane workflow. Do not deploy `mass-assign` or frontend assets in this wave.
- Keep `dealer_mass_open_rollout.enabled = false`,
  `dealer_mass_open_rollout.all_clubs_enabled = false`, and the allowlist empty.
- Do not replay, mark applied, or edit historical Drift migrations.
- Do not use broad migration commands or a migration replay command.

## Owner-gated rollout

1. Capture the current migration ledger, `process-swing` deployment receipt,
   cron definitions, function ACLs, and the exact verified rollback artifact.
2. Run the target-aware schema probe for `dealer_shortage_alert_v1`. The probe
   must fail before the migration because the ledger objects are absent.
3. In a controlled window, apply exactly the approved migration file with the
   platform's targeted migration procedure.
4. Verify the table, both service-only ledger RPC signatures, RLS, grants, and
   the `dealer_shortage_alert_v1` target-aware schema probe. Stop before Edge
   deployment if any check fails.
5. Use the protected manual workflow to deploy only `process-swing` at the
   reviewed, exact source SHA. Preserve the function's current JWT posture.
6. Smoke one TEST club. Confirm that a healthy snapshot does not notify, a true
   shortage creates one incident, and the same condition does not notify again
   within ten minutes.
7. Observe at least ten minutes. Confirm resolution occurs only after the
   debounce window, a new episode can notify after resolution, snapshot/query
   failures send no Telegram, and diagnostics contain only stable codes.

## Evidence to retain

- Target source SHA and deployment receipt.
- Before/after catalog and ACL output.
- Negative and positive target-aware probe results.
- TEST-club incident rows, sanitized snapshot sizes, and correlated Telegram
  delivery result.
- At least ten minutes of dispatch/observer and `process-swing` diagnostics.

## Emergency response

- If alert behavior is unsafe, use the protected control-plane workflow to
  deploy the exact previously verified `process-swing` artifact. Do not guess a
  rollback target from a version number.
- Do not delete incident history or revert the migration during an incident.
  Preserve evidence first, then choose a forward repair under owner approval.
- A failed snapshot is already fail-closed: it records a sanitized diagnostic
  and sends no shortage Telegram. It must not be treated as zero available
  dealers.

## Success criteria

- A snapshot with overtime tables and eligible or reserved relief is not called
  a pool-empty shortage.
- Telegram respects `club_settings.shortage_notify_telegram`.
- The service-only ledger deduplicates an open incident for ten minutes,
  handles severity escalation, and permits a notification only after a
  resolved condition recurs.
- No rollout control, allowlist, or frontend behavior changes in this wave.
