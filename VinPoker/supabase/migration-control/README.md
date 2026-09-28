# Migration Control Manifest

`manifest.json` is the canonical reservation and provenance contract for the
S1-S6 migration wave. It does not authorize a database apply. Daybreak and all
production gates remain off.

## Reserved order

| Domain | Old version | Reserved version | Semantic | Predecessors | Owner |
|---|---|---|---|---|---|
| Dealer Swing | `20270115000018` | `20270128000001` | `dealer_swing_authorization_containment_v1` | `20270115000018` | S3 |
| TV Stage A | `20260924065041` | `20270128000002` | `tv_display_config_guarded_rpc_v1` | exact live TV v1 digest/ACL gate | S2 |
| TV Stage B | none | `20270128000003` | `tv_display_direct_update_revoke_v1` | `20270128000002` plus compatible frontend proof | S2 |
| History foundation | `20270115000019` | `20270128000004` | `tracker_history_completion_queue` | `20270115000018` | S4 |
| Correction | `20270115000021` | `20270128000005` | `tracker_correction_floor_tracker_authority` | `20270115000020`, `20270128000004` | S1 |
| History audit | `20270115000022` | `20270128000006` | `tracker_history_completion_audit_fixes` | `20270128000004` | S4 |
| Floor | `20270127000000` | `20270128000007` | `floor_v3_critical_consistency` | `20270115000018` | S5 |
| Voice | `20270115000023` | `20270128000008` | `tracker_voice_floor_owner_telegram_dealer` | `20270115000020`, `20270115000018` | S6 |
| History reparent invalidation | none | `20270128000009` | `tracker_history_reparent_invalidation_v1` | `20270128000004`, `20270128000006` | S4 |

The numeric order is the only permitted protected apply order. A dependency
must be verified before its dependent migration is considered. Independent
entries may still be held; skipping a failed or unverified predecessor to run a
later dependent entry is forbidden.

## Binding a reserved migration

Before a domain branch adds SQL at a reserved version, it must update the same
manifest entry in that commit:

1. Keep the reserved version, semantic filename and owner session unchanged.
2. Set `normalizedSqlSha256` to SHA-256 of UTF-8 SQL after converting CRLF and
   lone CR to LF.
3. Set `sourceSha` to the reviewed source commit that owns those exact bytes.
4. Change `state` to `SOURCE_BOUND`.
5. Run `npm run check:migration-control` and the contract test.

The guard rejects a file in an unbound reservation, a semantic-name mismatch,
a hash mismatch, a missing predecessor and a second branch claiming the same
version.

## Protected exact-allowlist plan

Production release is a later owner-only operation. For each entry, in manifest
order:

1. Freeze the reviewed commit and exact normalized SQL hash.
2. Re-read the live ledger and object/function digests. Stop if the version is
   occupied, the semantic name/hash differs, or a predecessor postcheck is not
   proven.
3. Verify a fresh restorable recovery point and the protected environment gate.
4. Build an exact allowlist containing only the next migration. Execute its SQL
   and new ledger receipt atomically; never repair or rewrite an existing row.
5. Run migration-specific ACL, object digest, dependency and data-integrity
   postchecks. Stop on failure or unknown outcome; do not continue the chain.
6. Record the exact source SHA, SQL hash, ledger result and postcheck receipt.

No broad `db push`, production deploy, Edge deploy, flag activation, live-data
repair or Daybreak activation is part of this source change.
