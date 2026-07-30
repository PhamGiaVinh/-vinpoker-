# D1B Vietnam Outcome Evidence Foundation v2

## Purpose

D1A records **planned schedule supply** from public posters. D1B records **observed public outcome evidence** after an event. They are immutable, separate releases. A D1A schedule row is never rewritten with a result.

## What counts mean

`entries`, `unique players`, `total bullets`, and `re-entry count` are different fields. A total-bullet number is not a unique-player count. Every count and money claim carries its own immutable scope: `event_total`, `flight_only`, `day_total`, `series_total`, `partial_result`, or `unknown`, plus a scope identity. A flight, day, partial, unknown, or series value is never promoted to an event total.

`published GTD` is an announced promise. `actual prize pool` is an observed result. Neither is inferred from the other. D1B also does not derive a prize pool from entries or entries from prize pool.

## Exact overlay and surplus rule

Only compatible explicit monetary fields may produce a derived value:

```text
overlay = max(published GTD - actual prize pool, 0)
surplus = max(actual prize pool - published GTD, 0)
```

Both values must be final, active, event-scoped, linked to the current corrected D1A graph, and have the same currency and scale. D1B uses exact non-negative integer arithmetic and does not perform FX conversion. If an event is partial, future, cancelled, ambiguous, conflicting, missing, or incompatible, both derived values remain unavailable.

## Public source governance

Accepted sources include official result posters or reports, official organizer result pages, final-result PDFs, established public reporting, public posts that explicitly state the claimed outcome, and public satellite results that explicitly state awarded seats.

Evidence quality is not upgraded from appearance. An official-looking logo is insufficient. `owner_provided_public_image_unverified` remains unverified until a source-governance review explicitly changes it. Unsourced screenshots, cropped numbers without event identity, user recollection, estimates, comments, social engagement, schedule posters without outcomes, and private player lists are rejected.

## Intake workflow

1. Preserve the source bytes in `docs/series/evidence/vietnam/outcomes/inbox/`.
2. Preserve accepted bytes under `outcomes/reviewed/` and record path, SHA-256, byte length, and approved media type. URL-only evidence may remain in intake, but cannot enter a release.
3. Create an intake record with `exact` or `not_reported` publication semantics, exact capture time, expected D1A competition key, claim values and scopes, reviewer state, and limitations.
4. Extract field claims with visual or text region and extraction state.
5. Perform a second-pass review.
6. Link the D1B outcome to D1A through an immutable `ScheduleOutcomeLink`.
7. Create a Draft PR containing a non-empty release, artifact, and receipt only after review.

The strict intake command accepts `--input <path>` and keeps `--check-template`. It rejects unknown keys, malformed enums and values, private-field literals, private URLs, and fixture namespace misuse. Exit codes are `0` valid, `2` invalid evidence, `3` I/O/runtime failure, and `64` invalid CLI usage.

The fictional template in `src/lib/series-market/fixtures/templates/` uses the reserved `fixture.` namespace. It exists only to validate the workflow and the release constructor always rejects fixture records.

## Schedule-outcome linkage

Every link is bound to an immutable `VietnamScheduleLinkageContext` containing the current D1A release, artifact, receipt, artifact-file hash, source cutoff, correction lineage, and schedule competition identities. The context validates the exact corrected D1A cutoff and the canonical hash of the complete 46-row competition index, so an omitted or altered schedule row or cutoff fails closed. An `exact` or `explicit_source_link` requires both the key and organizer, series, event, date, and flight metadata to match one current corrected D1A row. The superseded D1A release, same-key metadata mismatch, and fuzzy matching fail closed. Structural matching can only produce `candidate`; it needs human review. Only `exact` and `explicit_source_link` are eligible for automatic aggregate research.

## Corrections and supersession

Claims and releases are append-only. Input claims cannot declare themselves `superseded`; that state exists only in resolved output. A correction points from one historical claim to a newer claim with the same event, field, and scope and never deletes the earlier value. Correction time is explicit and chronological. Divergence, convergence, cycles, unknown claims, or multiple current descendants fail validation. Correction records are included in the release manifest and artifact.

## Public/private boundary

D1B stores public event-level evidence only. It has no player identifiers, registrations, payment data, cashier data, private operator data, or player/cohort tables. Private operational outcomes belong to a later, separately governed system.

## Outcome readiness

Readiness reports explain what can safely be used:

- `entries_only`: explicit event-total entries, but no compatible actual prize pool.
- `prize_pool_only`: explicit actual prize pool, but no explicit event-total entries.
- `turnout_economics_ready`: both explicit event-total entries and actual prize pool.
- `unique_player_analysis_blocked`: unique players are absent or non-explicit.
- `reentry_analysis_blocked`: explicit event-total unique players, total bullets, or `reentry_count` are absent.
- `satellite_conversion_blocked`: awarded, redeemed, or converted seats are missing.
- `ambiguous_linkage` and `conflicting_outcome`: review is required before aggregate research.

`outcome_ready` additionally requires a non-future final result, explicit event-total entries, and an exact or explicit-source schedule link. The first non-empty release must contain at least one `outcome_ready` event; partial/live-only evidence remains intake material.

## Prohibited inferences

D1B must not claim market demand from one event, causal impact from a calendar collision, an optimal GTD, overlay probability, future turnout, a unique-player count inferred from entries, or profitability inferred from overlay alone.

## Evidence checklist for the next intake

- Official result poster, report, URL, or PDF with organizer and event identity.
- Publication time and capture time.
- Exact repository path, file hash, byte length, and media type for accepted evidence.
- Explicit scope and scope identity on every count and money claim.
- Explicit actual prize pool and published GTD when overlay arithmetic is wanted.
- Explicit unique players, bullets, and re-entries when player-behavior research is wanted.
- Explicit satellite awarded, redeemed, and converted seats when conversion analysis is wanted.

## Next step

After D1B v2 is merged, rerun public discovery. Create Vietnam Outcome Evidence V1 only when at least one final public result can be linked exactly or explicitly to the current corrected D1A release. Until then the correct state is `OUTCOME_EVIDENCE_ACQUISITION_BLOCKED`. Forecasting models and planned-versus-observed UI remain out of scope.
