# Controlled VinPoker Tooling Pilot — 2026-08-30

Mode: **CRITICAL / RED / source-only**

Baseline: `64fbdcfa83e5e255aaf3850b64a9b5f07cadd340`
Parser commit: `8649ecff2c2075ffd633b746e911265ff8e78c83`

No production, database, Edge deployment, migration, feature flag, merge, or canonical writer change was performed.

## RESULT

**Draft review candidate created with honest gate status.** The parser safety change and tooling pilot are independent.

- Parser behavior and scoped verification: **PASS**.
- `PARSER_SAFETY_REVIEW_READY`: **NOT READY** because the canonical full-repository lint gate fails on pre-existing repository debt and `tsc -b` did not return a completion receipt within the bounded run.
- Archify verdict: **NOT_READY**. Its failure does not block review of the parser diff.

## PARSER SAFETY RESULT

The shared `parserCore` now classifies safety from structured hardener provenance after anchored grammar parsing:

- Any repaired transcript whose parsed action is `all_in` returns `null` with classifier reason `repair_action_unsafe`.
- Exact, unrepaired `seat 9 all in` remains valid.
- Safe bounded repair such as `fit 3 call` remains a confirmation-required proposal and performs zero canonical writes before confirmation.
- Browser and Edge continue to delegate to the same parser core.
- Multi-action, empty, partial, interrupted, timeout, and disconnect paths remain fail-closed.
- Existing amount-unit behavior is only locked by tests: `bet 9` becomes `9000` with confirmed unit context and remains ambiguous/rejected without it.

The Preview fixture needed two missing canonical context fields (`workflowState` and actor `entry_number`) so the existing E2E confirmation path could exercise current validation. This is dev-only fixture repair, not product authority or writer logic.

### Parser verification receipts

| Gate | Command | Result |
|---|---|---|
| Targeted Vitest | `npm.cmd run test -- src/lib/trackerVoice/transcriptHardener.test.ts src/lib/trackerVoice/trackerVoice.test.ts src/lib/trackerVoice/providers.test.ts tests/trackerVoice/parserParity.test.ts --maxWorkers=1 --no-file-parallelism` | **PASS**, 4 files and 275/275 tests |
| Tracker Voice Playwright | `npm.cmd exec -- playwright test --config=playwright.tracker-voice-v0.config.ts` | **PASS**, 4/4 tests |
| Scoped ESLint | `npm.cmd exec -- eslint src/lib/trackerVoice/parserCore.ts src/lib/trackerVoice/transcriptHardener.test.ts src/lib/trackerVoice/trackerVoice.test.ts src/lib/trackerVoice/providers.test.ts tests/trackerVoice/parserParity.test.ts e2e/tracker-voice-v0.mock.spec.ts src/dev/TrackerVoiceV0Preview.tsx` | **PASS**, exit 0 |
| Canonical repository lint | `npm.cmd run lint` | **FAIL**, 2,166 existing findings across the repository (2,026 errors, 140 warnings) |
| Canonical typecheck | `npm.cmd exec -- tsc -b` | **NOT MEASURED**, no completion receipt during bounded run; process terminated |
| Build | `npm.cmd run build` | **PASS**, 5,637 modules, built in 40.80 s |
| Credential context guard | `npm.cmd run check:credential-context` | **PASS**, `Sensitive credential context guard passed.` |
| Scoped diff | `git diff --check` and explicit-path staging | **PASS** |

The initial red test run produced 13 intended failures for unsafe repaired all-in variants and the missing classifier while 262 existing assertions passed. The green run passed 275/275 assertions.

`npm ci` completed using the repository lockfile. It reported 22 dependency audit findings (4 moderate, 17 high, 1 critical); no audit fix or dependency upgrade was attempted because that is outside this slice.

## TOOLING PILOT RESULT

| Tool | Verdict | Evidence / boundary |
|---|---|---|
| Screenshot-to-Code | `WAITING_FOR_AUTHORIZED_INPUT` | Not installed or run; no authorized screenshot was supplied. Inspected upstream commit `d026163f586dfa8c5c10d28c36edd59a9d3b0e88`, MIT. |
| LiveKit Agents / Agent Skills | `SKIPPED_NOT_APPLICABLE` | Not installed. VinPoker already has transport, provider interface, shared parser, and Shadow/Assist seams; no capability gap was found. Missing credentials only prevented a live benchmark. Inspected Agents `v1.7.1` commit `6e3af311381d11c5d6c065567e98d35bb54b85a9` (Apache-2.0) and Agent Skills commit `8e7c931b8324bcb891ff4029fe6bd4f894385204` (MIT). |
| Archify | `NOT_READY` | Exact external checkout `v2.16.0`, commit `c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`, MIT. Doctor passed. Candidate pinned repository evidence to parser commit `8649ecff2c2075ffd633b746e911265ff8e78c83`. After two bounded authoring corrections, showcase validation still reported connection-label overlap. No failed artifact is committed. |
| OpenViking | `BLOCKED_MODEL_CONFIGURATION` | Not installed or configured. Embedding provider/model, VLM provider/model, auth method, and workspace remain unselected. Local server does not require an OpenViking API key and Windows does not require Docker. Inspected `v0.4.17` commit `e7f2fe519086923340703b300895c02f8ccfd3e9`; no config, database, hook, or auto-capture was created. |
| GitNexus | `GITNEXUS_BLOCKED_LICENSE` | Not installed, run, or indexed. Inspected commit `9718e1247aec56745a32fbc19ae83f392f656f02`; upstream license is PolyForm Noncommercial and commercial use requires separate permission. |

### Archify receipts

- Exact checkout: `D:\external-tools\vinpoker-tooling-pilot\archify-v2.16.0-c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`
- Candidate diagnostics retained outside the repository: `D:\external-tools\vinpoker-tooling-pilot\diagnostics\tracker-voice-shadow`
- `git rev-parse HEAD`: `c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de`
- `git describe --tags --exact-match HEAD`: `v2.16.0`
- Node: `v24.15.0`
- `node <exact-checkout>\archify\bin\archify.mjs doctor`: **PASS**
- Validation correction 1: guided-view note reduced to the schema maximum.
- Validation correction 2: proposal source range corrected to the exact file length at the parser commit.
- Final bounded validation: **FAIL**, showcase layout label-overlap diagnostics.
- `ARCHIFY_VALIDATION_PASS`: **NO**
- `ARCHIFY_CONTAINMENT_PASS`: **NOT MEASURED**
- `HUMAN_VISUAL_REVIEW_PASS`: **NOT MEASURED**
- `visualReview`: remains **pending**, never represented as visual PASS.

Exact commands used:

```powershell
git clone --filter=blob:none --no-checkout https://github.com/tt-a1i/archify.git <exact-checkout>
git -C <exact-checkout> checkout --detach c826e6c3a7abad19c0f3cd1ca57207d54b1ad8de
node <exact-checkout>\archify\bin\archify.mjs doctor
node <exact-checkout>\archify\bin\archify.mjs validate architecture <candidate-json> --repo-root D:\wt\tooling-integration-pilot --quality showcase --json
```

No invalid Archify JSON, HTML, visual receipt, or PNG was copied into the VinPoker worktree. The external checkout and candidate diagnostics were intentionally retained for diagnosis.

## CHANGED

- `VinPoker/src/lib/trackerVoice/parserCore.ts`
- `VinPoker/src/lib/trackerVoice/transcriptHardener.test.ts`
- `VinPoker/src/lib/trackerVoice/trackerVoice.test.ts`
- `VinPoker/src/lib/trackerVoice/providers.test.ts`
- `VinPoker/tests/trackerVoice/parserParity.test.ts`
- `VinPoker/e2e/tracker-voice-v0.mock.spec.ts`
- `VinPoker/src/dev/TrackerVoiceV0Preview.tsx`
- `INTEGRATION_REPORTS/tooling-pilot-20260830/REPORT.md`

## VALIDATED

- Unsafe repair provenance is rejected only after exact action parsing; no all-in substring heuristic was introduced.
- Exact all-in, repaired safe-call confirmation, multi-action, partial/interrupted, timeout/disconnect, amount-unit behavior, and Browser/Edge parity are covered.
- Build and credential-context guard pass.
- Changed files pass scoped ESLint and diff checks.
- Main checkout was not edited, staged, restored, or cleaned.

## NOT MEASURED

- Production or authenticated UAT.
- Live voice latency and false-accept metrics.
- Canonical `tsc -b` completion.
- Archify containment and human perceptual review.
- LiveKit benchmark.
- Screenshot-to-Code output.
- OpenViking retrieval.
- GitNexus indexing.

## REMAINING

- Review the parser safety diff independently of Archify.
- Decide whether repository-wide lint debt and the non-completing canonical typecheck must be resolved in a separate task before promoting the parser gate to `PARSER_SAFETY_REVIEW_READY`.
- If the Archify pilot is continued later, correct the existing label-overlap diagnostics in the retained external candidate, then rerun validation, containment, and actual human visual inspection.
- Do not merge, deploy, apply DB/Edge changes, or enable a flag without separate owner approval.
