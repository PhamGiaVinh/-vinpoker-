# D2A Decision Packet & Private Outcome Capture V1

## Status

Source-only schema and pure TypeScript contracts. No production database apply,
runtime consumer, UI, feature flag, Edge Function, or generated Supabase type
change is included in this increment.

Production application is CRITICAL/RED and remains owner-gated by
`VBacker/05-RUNBOOKS/CONTROLLED_DB_APPLY.md`.

## Why Additive V1 Tables Are Required

The existing capture tables remain useful but have different semantics:

- `series_decision_logs` is a mutable legacy workflow record.
- `series_event_actuals` is a current autosync cache that overwrites one row per
  event.
- `series_registration_events` is an observation journal, not an authoritative
  count.
- `series_forecast_snapshots` may be referenced only after exact event, timing,
  target-metric, and provenance checks.

No legacy row is silently promoted into a Decision Packet or calibration-ready
actual.

## Decision Packet Boundary

`series_decision_packets_v1` stores the information known when an owner makes a
decision:

- exact event, horizon, target metric, as-of timestamp, and source cutoff;
- an optional same-event forecast snapshot with explicit provenance state;
- schema-validated, cutoff-bounded hashes for public evidence, registration, and campaign slices;
- pre-decision facts, assumptions, alternatives, uncertainty, and owner action;
- append-only correction lineage.

Post-event values and raw player/operator identity fields are rejected from the
packet information set. A packet is mutable only while it is a draft. Freezing
sets a server-derived content hash and permanently blocks update/delete.
Existing forecast snapshots represent entries, so V1 rejects linking one to a
unique-player or total-bullets target. Incomplete provenance and an explicitly
non-identity-eligible snapshot remain separate states.

Every evidence/slice manifest is validated again inside the write RPC: the
server rejects unknown manifest keys, malformed references or hashes, duplicate
evidence, and any source cutoff after the packet cutoff. Recommendation sources
are restricted to the attached forecast snapshot or an attached public research
artifact; untracked human-analysis labels are not a V1 source of truth.

## Private Actual Boundary

`series_event_actual_revisions_v1` stores append-only revisions with explicit:

- scope (`event_total`, flight/day/series, partial, or unknown);
- finality (partial, provisional, final, corrected, conflicting, or void);
- source and publication-time semantics;
- per-metric availability, separating missing from explicit zero;
- one root and linear correction lineage per source family, with reconciliation references.

The schema never derives re-entry from entries minus unique players. Automatic
and manual revisions remain separate until a later trusted reconciliation
increment records an explicit resolution.

## Current Source PR Boundary

Included:

- additive tables, constraints, indexes, RLS, immutable triggers;
- owner-scoped create/freeze packet RPCs;
- owner-scoped manual actual revision RPC;
- server-derived hashes, idempotency, and advisory locks;
- pure TypeScript packet/actual contracts and graph validation;
- static migration and architecture tests.

Deferred:

- generated Supabase types (only after controlled live apply);
- system/autosync actual writer and explicit reconciliation RPC;
- Decision Room UI and `seriesDecisionPacketV1` flag;
- legacy reconciliation/promotion;
- eligible forecast-actual pair resolver and calibration changes;
- D1D public planned-versus-observed UI.

Idempotent retries are accepted only when the full canonical request matches.
Reusing a packet or actual idempotency key with changed content fails closed.

## Cross-Runtime Hash Contract

D2A uses the versioned `series-canonical-json-v1` contract for immutable
semantic identities. It is deliberately narrower than the generic provenance
serializer and is implemented in both TypeScript and PostgreSQL:

- UTF-8, compact JSON, NFC-normalized and trimmed string values;
- ASCII camelCase machine keys only, ordered bytewise by UTF-8/C collation;
- arrays retain semantic order, while evidence and text-set arrays are
  normalized, deduplicated, and sorted before hashing;
- null and explicit zero remain distinct;
- numeric JSON values are non-negative JavaScript-safe integers only;
- money remains an explicit `{ amountMinor: string, currency, scale }` shape;
- UUIDs are normalized to lowercase; timestamps are UTC and exactly
  millisecond-precise as `YYYY-MM-DDTHH:mm:ss.SSSZ`.

`jsonb::text`, `to_jsonb(row)::text`, insertion order, and PostgreSQL's
implementation-defined JSONB key order are not identity serializers.

Packet content hashes use the full normalized content shape excluding only
`contentHash`. Packet request hashes add `requestKind` and exclude server scope
and transport idempotency. Actual content hashes use the full normalized actual
shape excluding only `contentHash`, including its stored `idempotencyKey`.
Actual request hashes add `requestKind` and exclude server-derived club,
capture, reconciliation, row, and transport-idempotency fields.

Reviewed vectors live at
`src/lib/series-intelligence/fixtures/decisionPacketCanonicalV1.vectors.json`.
They are generated and checked with:

```text
npx vite-node --script scripts/series-intelligence/generate-decision-packet-canonical-vectors.ts
npx vite-node --script scripts/series-intelligence/generate-decision-packet-canonical-vectors.ts --check
npx vite-node --script scripts/series-intelligence/check-decision-packet-canonical-vectors.ts
```

The final schema gate also runs the exact migration against a disposable
PostgreSQL 17 database using
`scripts/series-intelligence/probe-decision-packet-pg17.mjs`. That probe binds
the migration SHA-256 and vector SHA-256, compares canonical UTF-8 bytes and
lowercase SHA-256 digests, then tears down its temporary database. It is not a
production apply, does not contact Supabase, and does not prove live database
readiness.

## Rollout Order

1. Review and merge the source-only schema PR.
2. Run catalog and migration-ledger preflight in a controlled session.
3. Apply only the exact reviewed migration after the owner gives the exact
   runbook authorization.
4. Verify tables, policies, grants, functions, triggers, and rollback probe.
5. Regenerate Supabase types in a separate narrow PR.
6. Add system/reconciliation writers and read model behind a default-OFF flag.
7. Run authenticated Preview UAT before any flag-on PR.

## Rollback

Before runtime adoption, rollback may drop only the two new empty V1 tables and
their dedicated functions after a dependency/data audit. Once a packet or
actual revision exists, rollback is forward-only: disable the consumer and
preserve the audit records.
