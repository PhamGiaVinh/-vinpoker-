# D1A Correction 001 - Center-P After Dark

## Incident

PR #994 merged Vietnam Schedule Supply V1 with one confirmed transcription
error in the Center-P poster row:

`21:00 - CPM After Dark - 25% ITM`

The preserved poster displays:

- prize contribution: VND 2,000,000;
- organizer fee: VND 300,000;
- monetary GTD: VND 30,000,000.

The merged seed incorrectly recorded the prize contribution as VND 3,000,000.
The original poster image was not changed.

## Correction

| Field | Superseded | Corrected |
| --- | ---: | ---: |
| Prize contribution | VND 3,000,000 | VND 2,000,000 |
| Organizer fee | VND 300,000 | VND 300,000 |
| Monetary GTD | VND 30,000,000 | VND 30,000,000 |
| Required entries | 10 | 15 |

Required entries are derived using exact ceiling arithmetic:

`ceil(30,000,000 / 2,000,000) = 15`

## Downstream Changes

- Center-P calculable required entries: 1,114 to 1,119.
- Center-P plus Grand Loyal within-14-day calculable required entries:
  2,266 to 2,271.
- The corrected claim, release, artifact, exact artifact bytes, and receipt
  receive new content identities.
- GTD totals, event count, claim count, source images, and evidence quality do
  not change.

## Supersession

Superseded identities:

- release:
  `series-market:v1:vietnam-schedule-supply:v1:release:dbd23425e5318a23e07779e2a448120a6c361b16149c90c0ef9481ca816ac150`
- artifact:
  `series-market:v1:vietnam-schedule-supply:v1:artifact:62a3ec31affac9cf655242f364107b1fbc34b56bf346696d168e39fac0c23c72`
- artifact file SHA-256:
  `dc656a5bca1cde8a657ad79e5cf1631c422ec496f9a055caff3be7157a4c8ca8`
- receipt:
  `series-market:v1:vietnam-schedule-supply:v1:receipt:240651066c3352afdc16803733cb7bbefbeace72ca495eaedaac075b38a55cc5`

Corrected identities:

- release:
  `series-market:v1:vietnam-schedule-supply:v1:release:c0f5e97aeb8b58bca4f52325cca2e17b4c27bbdb2bdca3e5f908f6ae946a5651`
- artifact:
  `series-market:v1:vietnam-schedule-supply:v1:artifact:30fecbeb69d184a614febbcff87ef925fe6fb1d2f4d1a1822c2a8d9403f5e995`
- artifact file SHA-256:
  `6517f858e80cb439d3b15375859df2b5b51d3e7c8a2bc7f96ffef4b3fe2f1706`
- receipt:
  `series-market:v1:vietnam-schedule-supply:v1:receipt:1a513eca0724db4ea8cff0ddcef74dcf056045ce5af1a167c2668b327a879b5c`
- correction:
  `series-market:v1:vietnam-schedule-supply:v1:correction:9b172417ff4f80738e818c4f31269520957392c174949d32c0cfe3e19ed27d16`

The superseded identities remain in Git history. They must not be treated as
the current D1A research release.

## Second-Pass Audit

All 46 schedule rows were rechecked against the three preserved posters,
including every declared schedule, money, structure, registration, ITM,
satellite, promotion, and floor field. Missing values were also checked as
missing rather than inferred.

- audited rows: 46;
- unresolved rows: 0;
- additional confirmed extraction defects: 0;
- source image hashes changed: 0.

All evidence remains:

`owner_provided_public_image_unverified`

This correction affects only source-controlled public research data. It does
not affect a production forecast, recommendation, UI, feature flag, database,
private operator data, or money action.
