# P3 check-in recovery — execution evidence

## Receipt rejection correction after independent review

Final implementation typecheck47453 terminal exit0. Build started sequentially
after typecheck, no parallel heavy build. Catalog initially rejected51 (correctly);
registered exact reviewed hash in existing ownerGatedActiveAllowlist without changing
checker rules. Catalog/control terminal PASS. Independent live read confirms48/49/50
ledger names and51 absent; new receipt RPC absent.51 has not been applied live.

Existing checkin.concurrent.mjs executed on isolated PG17 exact sanitized schema
plus14/51: actual first INSERT sleep barrier and second transactionid wait observed;
same-key responses identical, one active attendance. Terminal marker
CHECKIN_TWO_SESSION_OVERLAP_AND_RESPONSE_LOSS_PASS. This is server concurrency
evidence, not authenticated web/worker-canary acceptance. Final-diff typecheck
started after latest explicit retry implementation; build/release still required.

Second critical review found liveness defect: receipt-only retries never resolve a
request that never reached/committed on server. Reproduced RED with unknown read
then explicit retry still calling reader. Added explicit "Gửi lại cùng yêu cầu"
using original migration14 atomic mutation and unchanged journal key/payload;
no automatic retry/new identity. Rejections and unknown still retain journal.
Nine hook/view tests PASS after fix; final test now clicks actual production JSX
retry Button (terminal9/9 PASS).18 handler diagnostics and whitespace check PASS.
Independent reviewer reports PASS static for latest explicit-retry change, with
full-panel/live acceptance still absent. Typecheck75818 completed exit0 but predates
latest retry edits; do not claim final-diff typecheck PASS.

UI now exposes a scoped pending-intent section independent of active dealer/shift
candidates. Its explicit reconcile action calls only get_dealer_checkin_receipt_v1.
The regular check-in handler also reads (does not resend mutation) whenever an
exact persisted request exists. Unknown/denied/conflict keeps the request; only
validated committed canonical attendance result clears it. Original18 handler
diagnostics PASS after this wiring. Eight real-hook/view-fragment tests passed
before the final regular-handler read-only change; final suite/typecheck are running.
The view-fragment uses production JSX and real Button, not full DealerSwingTab/web
UAT. Independent critical reviewer resumed READ-ONLY on current diff.

Forward51 adds authorized own-actor exact-fingerprint read-only receipt lookup;
inactive dealer/closed shift do not suppress an existing receipt. Missing receipt
returns unknown, not permission to create another intent. Generated with Supabase
CLI then named forward51 after local catalog collision check; live reservation and
definition checks remain required before release. Migration14 unchanged.

Extended existing checkin.pg17.sql with opt-in reconciliation tests: actual check-in
then inactive dealer/closed shift, exact result, payload conflict, unknown request,
outsider denial, anon/service ACL and unchanged attendance/receipt counts PASS in
isolated PostgreSQL17 on127.0.0.1:55452. Sanitized schema artifact37820347781 was
downloaded and hash validated d23cfa75a7381453ba0d6216346f6460c816a3b1525ef5d47984c3a995ddc56a.
No production network extension exists in this fixture (ready notification warnings);
this is not proof of live ready trigger or notification behavior. Initial copied
minimal P2 fixture lacked dealer_shifts/auth.users, so no runtime PASS was claimed
from that failed attempt. Schema restoration then completed terminal exit0; the
reconciliation runtime suite was rerun after completion and again passed exit0.

Four new actual-handler diagnostics reproduced journal loss for actor_not_allowed,
dealer_not_eligible, invalid_request and IDEMPOTENCY_CONFLICT after a response-lost
request (RED: all four erased the stored key). These results no longer clear the
journal: migration14 pre-receipt authorization/eligibility checks and conflict do
not establish that the earlier request did not commit. All18 handler diagnostics
now PASS; diff whitespace check PASS. No migration14 edits or live writes.

Existing typecheck7907 completed exit0 and lifecycle27841 completed4/4 PASS, but
both started before this final rejection-classification change; they are not final
diff certification. Still required: exact authorized read-only receipt reconciliation,
UI recovery for dealers missing from candidates, full component/server integration,
final checks, independent review and production release/UAT. Goal remains incomplete.

## Baseline and preceding P2 release (2026-10-10)

- Baseline: f3fd106584ce3f00588e7d333296f0a8266c06bc, squash merge PR1452.
- Source PR head: 36d970fca17fdc9a740bdd8aa678750662a7fe52; required CI passed before merge.
- Recovery38061694984 completed SUCCESS including actual isolated PostgreSQL restore.
- Protected apply38063446130 completed SUCCESS; COMMITTED_EXACT49/50 and both OBJECT_POSTCHECK_PASS markers confirmed.
- Live ledger independently confirms20270128000049/50 and exact names. Cron job54 is active, postgres-owned, once/minute; observed succeeded execution at2026-10-10 22:26:00+07. This proves daemon execution, not pending-request business acceptance.
- Production artifact dpl_Hf98fqScamNhp8mvAHMpoeM3enyW built from clean exact baseline, releaseSha metadata supplied. Promoted successfully.
- Artifact and vinpoker.vercel.app/version.json both returned1791646249582. CLI resolves owner hostname to that artifact.
- Authenticated browser operational UAT remains NOT VERIFIED: earlier Chrome CDP failures and in-app URL policy denial were not bypassed. P2 is shipped, not fully accepted.
- No Daybreak/legacy CenterPoint Auto activation, history deletion, migration13–28 edits, or payroll/rest/payout/rounding policy changes in this release.

## P3 scope and next repro

One writer, branch codex/p3-checkin-recovery; no live mutations yet in P3.

Source candidates (not runtime repro PASS): DealerSwingTab checkinKeys uses useRef, unknown result retry does not survive remount; ok=true does not require a recognized outcome; scope check occurs before request and after the loop but not immediately after each awaited result. Re-check-in awaits candidate read before updating selection. Verify late result/finally behavior before changing.

Reuse existing dealerSwing PG17 receipt/concurrency tests and existing UI/browser harness. Add behavioral regressions for unknown-response remount, unknown success outcome, actor/club replacement during await, and stale re-check-in completion. Preserve server authority and chosen shift/date policy.

Do not claim P3 or the full campaign complete from this checkpoint. Three real-rest rotations, session close/reopen, notification/payroll-isolated canary and desktop/375px web acceptance remain required.

## Handler diagnostic RED → GREEN

Added checkinHandler.repro.mjs executing the actual extracted TypeScript handler (not a duplicated implementation). Unknown ok=true outcome and late previous-scope response both failed before the narrow fix, then passed. Added actual scope-initialization execution for A→B→A: RED on string comparison, GREEN after replacing the scope identity object on each actor/club transition. Three tests terminal PASS. Client recognizes only the two successful outcomes in existing migration14: checked_in/already_checked_in. Migration14 unchanged.

These are focused handler diagnostics, not React lifecycle/browser/DB acceptance. Persistent remount journal, unmount/operation-generation fences, re-check-in late completion, recognized-result shape, full typecheck/build and integration still pending. No P3 commit, live apply, deploy, or flag activation yet.

Further repro: unknown response then fresh handler/remount generated different UUIDs (RED); sessionStorage key scoped by exact actor/club/dealer/chosen shift now preserves UUID before sending, read-back verified, malformed/conflicting key fails closed. Remount diagnostic GREEN. Storage quota failure sends zero RPCs. Double click before render dispatched two RPCs (RED); synchronous per-scope submission ref now sends one (GREEN). Six handler tests terminal PASS. Earlier tsc session70155 terminal exit0, but it started before final journal/submission edits, so it is not a typecheck PASS for current diff. Current full typecheck/build and component/lifecycle tests still required. Storage failure message still generic and must be clarified before final delivery.

Late re-check-in candidate read diagnostic executed actual doReCheckin: scope replacement still selected old dealer and opened dialog (RED). Captured scope identity after await now prevents these updates (GREEN). Seven diagnostic tests terminal PASS; git diff --check PASS. Typecheck84992 still running at checkpoint, not a terminal result. Remaining: unmount and scope-reset lifecycle, unknown actor, success shape, chosen-shift change with unresolved intent, storage error copy, React/browser integration, exact-current-diff typecheck/build and protected review/release. No production state changed in P3.

Unknown actor and unmount completion diagnostics both RED, then GREEN after user.id dispatch guard and effect-cleanup scope invalidation. Nine handler diagnostics PASS. The harness executes scope initializer/cleanup with a focused hook stub; it is NOT evidence for real StrictMode/React lifecycle. Remaining scope-change UI reset, success receipt shape, shift-change unknown intent, storage copy and real component coverage are unchanged requirements. Typecheck84992 remains live, no second heavy build started.

Receipt shape repro: recognized success missing attendance/date and unknown ok=false backend error both RED; client now requires existing migration14 attendance UUID/date fields and recognized outcome, or one of its eight explicit rejection codes. Unknown shapes keep retry identity. Complete canonical receipt positive control PASS; twelve diagnostics PASS overall. Typecheck84992 terminal exit0, but latest receipt/re-check-in/cleanup edits occurred after its start and must receive fresh final-diff checks. No P3 deploy or production mutation.

React/StrictMode harness now executes production check-in block with real hooks: valid receipt, unmount suppression, genuine remount same key PASS. Initial harness URL failed under jsdom (no tests executed); corrected filesystem resolution, not production behavior. Scope-replacement test then RED (processing=checkin and old shift retained); scoped effect resets only check-in processing/selection/dialog/candidates, retains unresolved journal. Four lifecycle tests PASS. Existing attention/inventory/RPC-lineage plus lifecycle suites:13 tests/4files PASS; node diagnostics12 PASS. Added both to existing current-schema workflow without removing existing server tests. This remains block-level integration, not full DealerSwingTab browser UAT. Latest diff requires typecheck/build, storage error copy, unresolved shift change review and critical read-only audit.

Unresolved first-shift then changed-shift diagnostic RED (second intent sent), GREEN after same-actor/club/dealer journal prefix checks. Distinguishes pre-dispatch storage/other-shift blocker from sent-but-unconfirmed response. Thirteen handler diagnostics and four React lifecycle tests PASS. Recovery UX when old shift is no longer selectable remains a review item: do not clear unknown journal or generate a replacement key merely to unblock. Fresh full typecheck started after latest edits; no P3 release yet.
