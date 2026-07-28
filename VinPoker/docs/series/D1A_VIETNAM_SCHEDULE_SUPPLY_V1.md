# D1A Vietnam Schedule Supply V1

## Scope

This release preserves and extracts three owner-provided public schedule posters:

- RPT schedule for 11-12 September 2026;
- Center-P Poker Master Season 2 schedule for 17 July 2026;
- Grand Loyal Poker Championship V schedule for 29 July 2026.

The release describes announced tournament supply. It is not an outcome,
turnout, demand, entry, overlay, or profitability dataset.

## Evidence

Original PNG bytes are preserved under:

`docs/series/evidence/vietnam/inbox/`

| Poster | Repository source | SHA-256 |
| --- | --- | --- |
| RPT | `rpt_schedule_sep_11_12_2026.png` | `2d70ed4cb17e6915753e60908b0c18a9f8aeb57362335b7f40b35a5c07cd4e11` |
| Center-P | `center_p_schedule_jul_17_2026.png` | `ae86830b97335debcf88e480bc0cf20572426af76ae8456aa2108e88da602cca` |
| Grand Loyal | `grand_loyal_schedule_jul_29_2026.png` | `999c86b0f2496166683240dfccf774d574d675073580e022e9c465a513fa7bb4` |

Every extracted claim remains:

`owner_provided_public_image_unverified`

OCR is not treated as authoritative. Rows were manually checked against the
preserved poster images. Unreadable or absent values remain missing or uncertain.

Correction `D1A-001` supersedes the release identities merged in PR #994 after
a Center-P prize-contribution transcription error was confirmed. See
`D1A_CORRECTION_001_CENTER_P_AFTER_DARK.md` and the immutable correction record
under `datasets/vietnam/schedule-supply/v1/corrections/`.

## Money Semantics

- Money uses integer minor units with explicit currency and scale.
- Seats and tickets are non-monetary guarantee units.
- A dash is not converted to zero.
- Total buy-in is not treated as prize contribution.
- Required entries are emitted only when both monetary GTD and explicit prize
  contribution are available in the same currency and scale.
- No FX conversion is performed.

## Derived Research

The deterministic artifact includes:

- announced monetary GTD totals by series and date;
- exact required-entry calculations where eligible;
- schedule-template fingerprints;
- repeated-template groups;
- 0/3/7/14/30-day announced-supply collision windows;
- buy-in and GTD bands;
- missing and uncertain field coverage.

These are descriptive research outputs. Template similarity does not establish
copying. Schedule proximity does not establish player-pool overlap or business
impact.

## Prohibited Interpretations

This release must not be used to claim:

- achieved GTD or turnout;
- underlying player demand;
- player-pool overlap or demand dilution;
- a probability of a financial outcome;
- an optimal date, GTD, buy-in, or schedule;
- that one organizer copied another.

## Next Evidence Needed

The next outcome-aware release would require separately sourced and
time-stamped evidence for:

- actual entries;
- unique players;
- bullet and re-entry distributions;
- satellite seats awarded, redeemed, and converted;
- final overlay;
- side-event economics.

Those fields must not be backfilled into this planned-supply release.

## Reproduction

From `VinPoker/`:

```powershell
npx tsx scripts/series-market/emitVietnamScheduleSupplyV1.ts
npx tsx scripts/series-market/emitVietnamScheduleSupplyV1.ts --check
```

The generator verifies the exact source-image SHA-256 and byte length before
emitting the release, canonical dataset, research artifact, and receipt.
