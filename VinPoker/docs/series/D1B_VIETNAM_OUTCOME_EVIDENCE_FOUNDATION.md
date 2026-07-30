# D1B Vietnam Outcome Evidence Foundation

## Purpose

D1A records **planned schedule supply** from public posters. D1B records **observed public outcome evidence** after an event. They are immutable, separate releases. A D1A schedule row is never rewritten with a result.

## What counts mean

`entries`, `unique players`, `total bullets`, and `re-entry count` are different fields. A total-bullet number is not a unique-player count. A flight total, day total, or series total is never promoted to an event total. The evidence must explicitly state an `event_total` basis before turnout research may use it as an event outcome.

`published GTD` is an announced promise. `actual prize pool` is an observed result. Neither is inferred from the other. D1B also does not derive a prize pool from entries or entries from prize pool.

## Exact overlay and surplus rule

Only compatible explicit monetary fields may produce a derived value:

```text
overlay = max(published GTD - actual prize pool, 0)
surplus = max(actual prize pool - published GTD, 0)
```

Both values must have the same currency and scale. D1B uses exact integer arithmetic and does not perform FX conversion. If either source is missing, uncertain, conflicting, or incompatible, both derived values remain unavailable.

## Public source governance

Accepted sources include official result posters or reports, official organizer result pages, final-result PDFs, established public reporting, public posts that explicitly state the claimed outcome, and public satellite results that explicitly state awarded seats.

Evidence quality is not upgraded from appearance. An official-looking logo is insufficient. `owner_provided_public_image_unverified` remains unverified until a source-governance review explicitly changes it. Unsourced screenshots, cropped numbers without event identity, user recollection, estimates, comments, social engagement, schedule posters without outcomes, and private player lists are rejected.

## Intake workflow

1. Preserve the source bytes in `docs/series/evidence/vietnam/outcomes/inbox/`.
2. Record a SHA-256 for repository files, or the exact public HTTPS URL identity for a URL source.
3. Create an intake record with publication time, capture time, expected D1A competition key, claimed fields, reviewer state, and limitations.
4. Extract field claims with visual or text region and extraction state.
5. Perform a second-pass review.
6. Link the D1B outcome to D1A through an immutable `ScheduleOutcomeLink`.
7. Create a Draft PR containing a non-empty release, artifact, and receipt only after review.

The fictional template in `src/lib/series-market/fixtures/templates/` exists only to validate the workflow. It is never research data.

## Schedule-outcome linkage

An `exact` link requires a unique expected D1A competition key. An `explicit_source_link` requires a unique source-declared key. Structural matching can only produce `candidate`; it needs human review. Multiple matches are `ambiguous`; a mismatch between expected and source-declared keys is `conflicting`. Only `exact` and `explicit_source_link` are eligible for automatic aggregate research.

## Corrections and supersession

Claims and releases are append-only. A correction points from one historical claim to a newer claim and never deletes the earlier value. `superseded` is different from missing. A cycle or two successors for the same claim fails validation.

## Public/private boundary

D1B stores public event-level evidence only. It has no player identifiers, registrations, payment data, cashier data, private operator data, or player/cohort tables. Private operational outcomes belong to a later, separately governed system.

## Outcome readiness

Readiness reports explain what can safely be used:

- `entries_only`: explicit event-total entries, but no compatible actual prize pool.
- `prize_pool_only`: explicit actual prize pool, but no explicit event-total entries.
- `turnout_economics_ready`: both explicit event-total entries and actual prize pool.
- `unique_player_analysis_blocked`: unique players are absent or non-explicit.
- `reentry_analysis_blocked`: unique players or total bullets are absent or non-explicit.
- `satellite_conversion_blocked`: awarded, redeemed, or converted seats are missing.
- `ambiguous_linkage` and `conflicting_outcome`: review is required before aggregate research.

`outcome_ready` additionally requires a final result, explicit event-total entries, and an exact or explicit-source schedule link.

## Prohibited inferences

D1B must not claim market demand from one event, causal impact from a calendar collision, an optimal GTD, overlay probability, future turnout, a unique-player count inferred from entries, or profitability inferred from overlay alone.

## Evidence checklist for the next intake

- Official result poster, report, URL, or PDF with organizer and event identity.
- Publication time and capture time.
- Exact file hash when a file is preserved.
- Explicit entries basis; ideally event total.
- Explicit actual prize pool and published GTD when overlay arithmetic is wanted.
- Explicit unique players, bullets, and re-entries when player-behavior research is wanted.
- Explicit satellite awarded, redeemed, and converted seats when conversion analysis is wanted.

## Next step

Once several public outcomes are linked with immutable provenance, create a non-empty Vietnam Outcome Evidence V1 release. Only then should research compare observed outcomes against D1A supply. Forecasting models remain out of scope until outcome coverage and provenance are adequate.
