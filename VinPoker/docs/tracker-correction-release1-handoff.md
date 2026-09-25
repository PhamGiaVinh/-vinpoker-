# Tracker correction, Release 1 source preview

This release is source and local verification only. No production database,
Edge function, frontend, or feature flag has been changed.

## Capability boundary

- Existing correction and undo writers are disabled in the proposed forward
  migration. The Edge commit and undo routes also fail closed. Normal Tracker
  action, board, and start-hand routes are not intentionally changed.
- The Floor editor is a read-only draft while correction writes are disabled.
  It separates recorded pot from the pot replayed from draft actions and does
  not display a missing recorded pot as zero.
- Shared validation rejects out-of-turn/street actions, duplicate/invalid
  cards, and nonterminal settlement streams. Blind/ante postings remain legal
  during all-in runout when the canonical hand requires them.
- This does not implement Release 2 durable undo or Release 3 historical
  correction/replacement. Those capabilities must remain disabled until their
  server contracts and endpoint tests are reviewed separately.
- `DealerFloorAlertControls` calls the proposed
  `report_tracker_floor_operational_alert_v2` RPC directly, outside Voice. It
  accepts table-level requests without a hand and can bind a selected action
  ID to its source revision and canonical action snapshot. The existing RPC
  still validates dealer assignment/session and writes the operational alert.
  The client retains the request ID for same-key retry and requires a receipt
  before showing success. If browser storage refuses the request ID, it does
  not send.
- Voice `report_wrong_action` is rejected by the update Edge route and its
  button is unavailable. This is not a substitute for Release 2 persistent
  correction-pending. The ordinary support call does not stop the hand.

## Entrypoints and side effects

| Operation | Client / server | Release 1 behavior |
| --- | --- | --- |
| Call Floor / display issue | DealerFloorAlertControls -> report_tracker_floor_operational_alert_v2 RPC | Operational alert insert only; optional canonical action reference; no poker-state write. |
| Wrong action through Voice | TrackerVoicePanel -> tournament-live-update voice route | Disabled in UI and rejected in Edge; existing historical DB voice RPC has not been independently endpoint-tested. |
| Historical correction commit | HandHistoryWorkspace -> tournament-live-resettle-commit -> commit_tracker_hand_correction_outcome | UI and Edge deny; proposed migration revokes writer RPC grants. |
| Legacy undo | HandInputEdge -> tournament-live-update delete_last_action -> delete_last_action RPC | Edge denies; proposed migration revokes writer RPC grants. |
| Correction preview | HandHistoryWorkspace -> existing preview route | Read-only intended; HTTP/Auth/DB behavior not yet measured. |

## Local evidence

- Vite production build: PASS. Existing dynamic-import and large-chunk
  warnings remain.
- Focused Vitest: 149 passed, 1 skipped across 19 files.
- Floor alert/Voice UI Vitest: 43 passed across 2 files, including Voice-off
  support, table-level request, uncertain same-key retry, and blocked browser
  storage. These are mocked UI tests, not HTTP/Auth/DB integration.
- Floor queue/Dealer alert focused Vitest: 11 passed across 2 files. The
  Dealer can select a canonical action and sends its ID, revision and snapshot.
  `FloorHandActionReview` selects by action ID and says the original action is
  gone when it cannot be found. These mocked tests do not prove SQL binding.
- Edge `deno check`: PASS for both changed functions.
- PostgreSQL 17 disposable fixture: migration applied; six correction writer
  RPCs lost execution privileges for `anon`, `authenticated`, and
  `service_role`; three ordinary Tracker writer RPCs retained their prior
  execution privileges. Function definitions and seeded poker rows remained
  unchanged. A direct `SET ROLE authenticated; SELECT
  public.delete_last_action(NULL::uuid, NULL::uuid)` returned `permission
  denied for function delete_last_action`. The fixture has zero hand/action
  rows and lacks `tracker_floor_alerts`; it cannot prove alert integration or
  row-level mutation behavior. This is not the full production migration chain.
- DEV-only no-database UI fixture: no document horizontal overflow at 320,
  375, 414, or 768 px. Physical-device UAT: NOT_MEASURED.
- Direct HTTP/Auth/DB endpoint requests and authorized Dealer role calls:
  NOT_MEASURED. The isolated PostgreSQL fixture lacks the alert table and an
  Auth/Edge stack; Docker daemon did not respond when probed. To unblock,
  provision a disposable local Supabase Auth/Edge/Postgres stack or extend the
  approved fixture with the exact alert migration and an authenticated HTTP
  harness. Source-revision binding is SOURCE_ONLY until migration 12 and an
  authenticated endpoint are verified. Keyboard-open/safe-area/1024 px visual checks:
  NOT_MEASURED. Full-app typecheck: interrupted, NOT_MEASURED.

## Before any rollout

Review the exact live function signatures, grants, dependent Edge callers,
and migration order against a fresh read-only production inventory. The
disposable database cannot prove that every production overload or historical
hand is compatible. Keep correction capability OFF if any inventory differs.
Run endpoint-level PostgreSQL 17 tests for the actual deployment chain,
including unauthorized calls and normal Tracker actions. Review the UI on a
real mobile device and tablet. Obtain separate owner approval for DB apply,
Edge deploy, frontend deploy, flag activation, and UAT. A merge or deployment
status alone is not evidence that live correction is safe.
