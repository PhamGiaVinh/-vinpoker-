# D0 Public Source Coverage And Release Plan

## Scope

This document describes a deterministic, public-only coverage audit for the immutable Jeju V1 release. It is not data ingestion, a forecast, a probability estimate, optimization, a recommendation, or a production decision surface.

The canonical artifact is generated from the committed Jeju V1 release and its canonical import. Its companion receipt stores the SHA-256 of the exact artifact bytes. The semantic artifact identity is distinct from the exact file-byte hash.

## Current Jeju V1 Coverage

The generated `public-source-coverage-v1.json` derives the current release counts rather than treating documentation counts as source of truth:

- 5 festivals, 87 events, 92 entities, and 972 claims.
- 794 present claims, 178 missing claims, and 0 conflict groups.
- `gtd`: 80 missing claims.
- `buy_in_prize`: 49 missing claims.
- `organizer_fee`: 49 missing claims.
- `entries` outcome coverage is present for 87 events.
- 7 events have current public GTD and prize-contribution values compatible for the existing historical GTD Stress input boundary.

All currently committed Jeju V1 claims remain `unverified`. The audit preserves that state; it never upgrades public evidence based on coverage alone. Missing and explicit zero remain separate values.

## Capability Boundary

The artifact records machine-readable readiness and reasons for the Verified Market Explorer, Comparable Event Engine V0, Historical GTD Stress, Ridge, Negative Binomial, TabPFN, registration-curve nowcasting, causal intervention analysis, cross-market evaluation, and production forecast eligibility.

- Explorer and Comparable V0 are supported only for current exploratory use.
- Historical GTD Stress is only partially supported because compatible public inputs exist for a subset of events and evidence remains unverified.
- Ridge, Negative Binomial, and TabPFN are research challengers only; they are not production eligible from this corpus.
- Registration nowcasting is blocked because timestamped registration curves are private and absent.
- Causal analysis is blocked because intervention design, treatment timing, and decision/action history are absent.
- Cross-market evaluation is blocked because Jeju V1 is a single market release.
- Production forecast eligibility remains blocked pending verified evidence, calibration, prospective private-data shadow evaluation, and cross-market validation.

## Priority Categories

The audit uses categorical priority only; it assigns no numeric weights.

- `P0`: evidence verification and missing GTD / prize-contribution coverage.
- `P1`: organizer-fee coverage for future event-economics research.
- `P2`: market diversity through separately scoped releases.

## Release Boundaries

`Jeju V2` is Jeju-only. It may add Jeju public sources or corrections, but it must not absorb Vietnam or other Southeast Asian events.

`Vietnam V1` is a separate country-scoped public release. `SEA V1` is a separately defined regional market release. Each release retains its own market key, scope kind, explicit currency values, source cutoff, claim lineage, and immutable identity.

`CrossMarketCorpus V1` is not a market relabeling exercise. When it is eventually created, it will reference immutable constituent release IDs and compatibility rules; it does not merge claims into a synthetic market and does not perform FX conversion. Cross-market evaluation will require an explicit leave-one-market-out protocol.

Corrections never rewrite V1. They use superseding claims or a later release.

## Public / Private Boundary

The D0 contract excludes registration timestamps, hashed player or cohort identities, re-entry and bullet linkage, private satellite linkage, capacity, cashier queues, staffing, marketing spend, decision logs, and operating economics. These fields belong to later private operator data work and are not accepted into the public coverage audit.

## Reproducibility

From `VinPoker/`, run:

```powershell
npx vite-node scripts/series-market/emitPublicSourceCoverageAudit.ts --check
```

The generator has no network, database, Supabase, UI, or deployment dependency. It reads only committed Jeju V1 artifacts and checks that the content-addressed artifact and its exact-byte receipt reproduce.
