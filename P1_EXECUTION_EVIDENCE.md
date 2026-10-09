# P1 — Deferred move / break intent

Status: IN_PROGRESS. Not a release or runtime PASS.

## Baseline

- Worktree: `D:\wt\vinpoker-deferred-break-intent`
- Branch: `codex/floor-deferred-break-intent`
- Base: `c252c16e3d8bc9071aeff8340745e9c6f6abf2b1` (origin/main, fetched this turn).
- Root checkout and previously merged branches left untouched.
- Daybreak and old CenterPoint automatic Swing must remain OFF.

## Findings confirmed in source

- F03: `floor_close_completed_break_source_v1` receives every terminal pending move, with no persisted break-operation identity. Its empty-source checks can close an ordinary move's source and release its dealer.
- F04: V5 break enqueues idle Tracker sources, but `floor_apply_tracker_moves_after_hand_v1` requires the source mode to be Manual and otherwise marks the move stale.
- Existing `criticalConsistency.disposable.sql` manually inserts a queue row and expects an empty source to close after cancellation. That expectation lacks authoritative break intent and must be replaced by public producer/consumer cases; it cannot justify preserving the bug.

## Runtime evidence

- Local Docker diagnostic FAIL: `dockerDesktopLinuxEngine` pipe absent. No test DB is currently available through Docker; no runtime test has run.
- Recovered available WSL PostgreSQL 17.11 on localhost port55439. Created only isolated `vinpoker_ops_p1_break`; production untouched.
- Downloaded unexpired baseline artifact from run37820347781, verified SHA256 through the existing restore script; sanitized public schema restored successfully.
- Applied exact local chain13–19,22–28. Migration28 first failed because Windows CRLF breaks its exact body substitution; normalized its input stream to LF without editing the historical migration, then apply passed.
- Existing `trackerRosterSession.pg17.sql`: PASS on that same test DB.
- New `tests/floorProduction/deferredMoveIntent.pg17.sql`: RED at `ordinary last-player move must not close its source`. Public open/roster/start/queue producers succeeded; actual terminal-hand consumer marked move applied, but the deferred close trigger closed the source. Transaction rolled back, preserving no fixture rows.
- This reproduces F03 at DB consumer scope. Full public finish RPC, dealer release, F04 and concurrency are not yet tested; they remain required.
- F04 now reproduced independently with `-v TRACKER_BREAK_CASE=1`: public idle-Tracker break preview complete, public V5 producer accepted and queued, terminal destination-hand consumer returned `status=stale`, `reason=control_mode_changed`. Regression RED at `queued move applies`; transaction rolled back.

## Next implementation boundary

- Both source faults now have failing behavioral tests, not only source-string evidence.
- Add server-owned persisted break identity bound to exact tournament/source session/epoch and originating request receipt. Ordinary queue producer must never mint it; legacy rows remain without close authority.
- Break consumer may accept idle Tracker source only with that authoritative operation and source-session fences. Prevent a new source hand while break reservations remain; do not merely remove the Manual-mode check.
- Deferred close must resolve the explicit operation and all seat/pending/hand blockers under the existing lock order. Cancellation/stale terminal rows alone do not prove a completed break.
- Extend tests with dealer assignment, successful explicit break, cancellation and source-start race before release.

## Initial fix (local only, not release-ready)

- CLI generated `20261009114334_floor_deferred_break_intent_v1.sql`; its final catalog/reservation version is still to be reconciled before committing/releasing.
- Added nullable break request link minted only by V5 producer; private validator binds it to actor/operation receipt and exact source table/session. No backfill of legacy rows.
- Pinned producer/consumer/close bodies patched with abort-on-drift checks; historical migrations unchanged.
- Close now requires explicit break intent and all operation moves applied, source epoch unchanged, no active source hand, plus existing seat/pending/session checks.
- Tracker source accepted only for proved break intent. New hand trigger serializes on tournament and rejects source hand while break reservations remain.
- Both previously RED regressions now PASS on the same current-schema PG17 DB: ordinary source remains open; explicit idle Tracker break moves and closes exact source.
- NOT_RUN: independent review, cancellation/retry/concurrency, dealer release, complete finish RPC, live definition parity, migration catalog, CI and web UAT. Do not apply/deploy this candidate yet.

## Additional verification

- Independent read-only reviewer found no concrete new P0/P1 in the candidate; requested true overlap, multi-destination mixed outcomes, full finish RPC and tampered receipt coverage. Review is not runtime PASS.
- Public cancellation case PASS: terminal cancelled queue does not close source.
- Changed source epoch case PASS: consumer marks stale and leaves source open.
- Direct source-hand insert while pending break PASS: common trigger rejects `source_break_pending`. This is sequential coverage, not a true-overlap proof.
- Live read-only MD5s of all three patched functions match pinned local baseline exactly.
- Live ledger highest wave entry remains00028; source/control catalog has no00029 reservation. CLI-generated candidate moved forward to `20270128000029_floor_deferred_break_intent_v1.sql` to preserve dependency ordering. Catalog checks still pending.

## True overlap and integration

- Public `record_hand` positive finish now PASS for explicit Tracker break, using frozen canonical hand participants and conserved stacks; deferred move applies and source closes.
- Added PG17 two-process concurrency suite with `pg_stat_activity` lock-wait barrier (not timing-only sleeps). Four cases PASS: break-first/start-first for both direct legacy INSERT and canonical `start_tracker_hand_v3`.
- Break-first: start rejected with `source_break_pending`, zero source hand, two pending break moves. Start-first: break rejected `table_has_active_hand`, one source hand, zero queue rows. Fixtures use unique scoped IDs and remain only in isolated local DB.
- First reverse-race fixture failed before overlap because source had only one player (`tracker_blind_roster_unavailable`); corrected fixture to two canonical source seats. Did not count that attempt as a concurrency PASS.
- Both catalog and migration-control now PASS with exact normalized hash allowlisted. Earlier catalog failure caused downstream control noise; no historical files or guard checks weakened.
- Existing operations workflow extended with new migration, behavioral cases, real finish and true-overlap suite. CI execution not yet run.
- Remaining before release: dealer lifecycle assertions, mixed multi-destination outcomes, tampered receipt/identity, fresh recovery point, CI and scoped live web proof.

## Dealer and partial completion

- Added exact source-session dealer/attendance fixture under authenticated owner intent; initial missing role claim was rejected by the real OFF/manual acquisition fence, then fixture correctly declared authenticated role. No guard bypass.
- Ordinary move, explicit complete break, cancelled move and stale epoch cases PASS with dealer release assertions and active-seat chip conservation60000.
- Two-player break with one cancelled and one applied PASS: source remains open, its dealer remains assigned, active chips80000 conserved. Included in both break-first overlap variants.
- Local public-only baseline lacks net schema; ready notification trigger emits caught warning. Tests prove DB lifecycle only, not HTTP ready/notification execution.

## Required regression cases

1. Public ordinary last-player queue → destination hand completion: source remains open, dealer not released.
2. Public explicit break → all destination moves finish: exact source closes, dealer release matches source session.
3. Idle Tracker source → active Tracker destination: deferred break applies without source-mode mismatch.
4. Source new-hand race, close/reopen, epoch change, mixed applied/cancelled/stale moves, retry and cross-club authority.

Implementation must use a new forward migration, retain session/epoch/entry/chip checks, and never infer break intent for legacy queue rows.
