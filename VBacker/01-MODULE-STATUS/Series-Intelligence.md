---
title: Series Intelligence Module
updated: 2026-08-27
status: source state only; production must be verified independently
---

# Series Intelligence

## Source state

- Series Intelligence contains read-only planning and evidence surfaces behind
  individual feature flags.
- The related Ops Intelligence Command Center V1 is source-only in its parent
  branch. It is an Owner/Super Admin read model in `/ops/select-module`, not a
  Series decision engine.
- It uses Club Pulse as its headline aggregate and keeps finance, Daily Digest
  and detailed operations provenance separate.

## Flag state

- `opsIntelligenceCommandCenterV1=false` in the parent source change.
- No Preview or production flag-on is part of that parent change.
- Existing Series flags require their own source, runtime and authenticated UAT
  evidence; a flag value in source alone is not production proof.

## Production-verified state

- This note does not assert a production frontend deployment, database change,
  Edge deployment or runtime activation for Ops Intelligence Command Center V1.
- No production mutation is performed by the parent source-only work.

## Preview-UAT state

- No authenticated Preview UAT has been recorded for Ops Intelligence Command
  Center V1.
- Local Playwright mock E2E is development evidence only. It is not an
  authenticated runtime check.

## Current blockers

1. The source parent must pass review and merge before a narrow Preview flag-on
   PR can be considered.
2. Registration pace, SePay and event stream have no approved read contracts,
   so V1 shows their unavailability rather than inventing data.
3. Cross-source count comparison is disabled until definition/grain compatibility
   has been audited.

## Rule

Merged source, deployed frontend, applied database, active flag and owner UAT
are separate truth layers. Do not collapse them into a single claim.
