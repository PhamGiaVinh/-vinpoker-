# Ops Quant Dashboard Q1 Evidence

## Original Q1 source receipt (historical)

- Base: `2cb341f0f0648c47a96651a14807cfca566b3c87`
- Branch: `codex/ops-quant-dashboard-q1`
- Runtime flag: `opsQuantDashboardQ1=true`
- Surface: `/ops/select-module`, Owner/Super Admin, desktop `>=1280px`
- Delivery scope: frontend-only, read-only
- No DB, migration, RPC, Edge, Gemini, route, package, polling, Realtime, or money-write change

## Authority limits

- Forecast output is labeled `RESEARCH MODEL - HISTORY FINALITY UNVERIFIED` and remains a hypothesis.
- Wave 1 supersedes the original chart: observed registration stays on the time axis; final-entry forecasts remain in a separate summary until a verified target timestamp exists.
- Capacity compares demand with exact selected-event table/dealer allocation. Club-wide inventory is context only.
- Prize-pool parsing preserves observed zero and fails closed on malformed or missing payloads.
- The V dock is a deterministic artifact explanation and does not call Gemini.
- Tablet and mobile preserve the legacy selector and mount no Q1 readers.

## Original Q1 validation receipt (not rerun in full by Wave 1)

- Focused Vitest: 130/130 passed across 11 files.
- Playwright Q1 real-route mock: passed at 1440x900, 1920x1080, 1194x834, and 390x844.
- Existing Command Center and Q0 Playwright suites: passed.
- Protected Finance/Series Playwright suite: 3/3 passed with the current server-validated auth fixture.
- Protected Ops Hub Playwright suite: 2/2 passed; sub-1280 legacy selector issued zero Q1 reads.
- Targeted ESLint: passed.
- Focused Ops registry and Finance/Series TypeScript projects: passed.
- Ops boundary, money boundary, owner-digest boundary, V3 shell text, and credential-context guards: passed.
- Normal production build: passed.
- Constrained production build (`NODE_OPTIONS=--max-old-space-size=4096`, `GOMAXPROCS=2`): passed.
- Full app TypeScript command did not complete within the measurement window and is `NOT_MEASURED`; no diagnostics were emitted before termination.

## Wave 1 local receipt - 2026-09-09

- Base: `7d9ed8b326593d1bf5aebea7fe8daa9a5e4059a3`.
- Branch: `codex/quant-q1-wave1-correctness`.
- Original implementation was source-only working changes. The review-prep receipt below supersedes its commit/PR status; no merge, flag change or production mutation.
- Unknown/partial/stale operations cannot become zero allocation. Exact empty responses preserve zero.
- Final entries no longer imply simultaneous seating demand. Only an explicit Custom peak and seats-per-table assumption derive table coverage, not a whole-shift staffing plan.
- Custom results render independently of missing forecast/history/contribution. Invalid inputs show errors; explicit zero is preserved.
- Requested event, raw scenario draft and successful source receipts survive tab switches. Missing events do not silently select a replacement. Event changes confirm draft reset; actor/club changes clear local state and scoped cache.
- Only the active tab mounts its readers. Source as-of, last successful read and machine clock are separate; failed reads do not advance successful receipts.
- Final-entry forecast markers at event start were removed. All alerts can be expanded; pressure rows select exact event IDs.

### Validation performed in Wave 1

- Intelligence + Ops auth Vitest: 115/115 across 15 files.
- Real-route mocked Playwright: 8/8. Includes four viewport sizes, embedded tabs, Custom/invalid/zero inputs, missing history, failed registration reads, removed events, retained drafts/receipts, spaces/non-owner/unverified-super-admin zero-reader gates.
- Desktop screenshots inspected at 1440x900 and Custom output; route tests cover 1920x1080, 1194x834 and 390x844, overflow, console/page errors and reduced motion.
- Targeted ESLint and both focused Ops TypeScript projects: pass.
- Ops import, money, owner-digest, V3 shell-text and credential-context guards: pass.
- Normal and constrained production builds: pass, sequentially. Existing bundle-size/import/Browserslist warnings remain.
- Full `tsc -b`: `NOT_MEASURED`, stopped by a 300-second timeout; not counted as pass.
- Final `git diff --check`, 13-path allowlist and targeted added-content credential signature scan: pass. Package files, flags and generated `public/version.json` are unchanged; staging is empty.
- Initial final E2E invocation omitted the dedicated mock-server URL; corrected to `PLAYWRIGHT_BASE_URL=http://127.0.0.1:8097`. A spaces heading assertion was corrected to the actual selector heading. The complete rerun passed.

### Evidence limits

All screenshots and browser observations here use synthetic local fixtures. They are not real-club business records, authenticated production smoke, forecast calibration or proof of a completed decision/outcome loop. No DB, Edge, Gemini or deployment call was made. Later roadmap waves remain unimplemented.

## Review preparation - 2026-09-10

- BASE SHA: `c713e32a1edf3346f5c27b386c3aeb86bfee8f09` (fresh `origin/main`).
- Rebased from `7d9ed8b326593d1bf5aebea7fe8daa9a5e4059a3`; #1223/#1224 touched Tracker only, including its existing Edge source. No overlap or semantic conflict. Four Wave 1 runtime files are unchanged by rebase.
- Tested SOURCE HEAD SHA: `282acff78bbae798019b73f70dfc9f6413eea260`. This receipt is a subsequent docs-only commit; the final PR head is recorded in the PR body rather than a self-referential commit hash inside its own file.
- SOURCE: ready for exact-diff review. LOCAL E2E: pass. USER_VISIBLE: local mocks only. PRODUCTION: unchanged.
- Rechecked P0 assertions: unavailable allocation is null, exact empty is zero, missing values are not OBSERVED; Custom peak alone drives table demand; Custom never rescales standard bands; no final-turnout marker at start time; all alerts are accessible; selection/draft survive tab switches and reset on club/user change.
- Network regression: all 9 route-mock E2E cases pass, including QUANT -> LIVE OPS -> DATA HEALTH -> QUANT retention, active-reader-only requests and 65-second clock advances with no polling or receipt refresh. No storage persistence, RPC, query-factory, route, flag, package, forecast-engine, DB, Edge or Gemini change.
- Post-rebase Vitest: 115/115 across 15 Intelligence/Q0/Ops-auth files. Focused Ops registry and Finance/Series TypeScript: pass. Targeted ESLint: pass. Ops/import, money, owner-digest, shell-text and credential guards: pass.
- Post-rebase normal build: pass (1m07s); constrained build: pass (59.46s, heap 4096 MB, GOMAXPROCS=2). Existing build warnings are unchanged categories: Browserslist age, mixed imports and chunk size. Generated version content is restored to base before staging.
- Post-rebase diff check, 10-path allowlist, package/flag/version unchanged guard and targeted added-content secret scan: pass. No raw transaction data or real owner data is included in the two fixture screenshots.
- Full `tsc -b` remains `NOT_MEASURED` from the prior bounded 300-second run without diagnostics; not rerun or promoted to PASS. No shared type/core infrastructure is changed.
- Changed files (10): four runtime files (`opsQuantDashboardQ1.ts`, `OpsQuantDashboardQ1View.tsx`, `OpsQuantForecastChart.tsx`, `OpsIntelligenceWorkspaceQ1.tsx`); two unit/component tests (`opsQuantDashboardQ1.test.ts`, `OpsIntelligenceWorkspaceQ1.test.tsx`); `e2e/ops-quant-dashboard-q1.mock.spec.ts`; this evidence document; `quant-1440x900.png`; `wave1-custom.png`.
- Only the Custom and forecast-horizon proof images are included in the Wave 1 diff. Other existing screenshots remain the original Q1 evidence, although their viewports were exercised again locally.
- Stop after one Draft PR. Review/merge and any production rollout are separate gates; Wave 2 is not started.

## P1 final-review correction - 2026-09-10

- Reviewed predecessor: `1fda26a4f1836ebbe1e99e505c82100f8bd9dbb0`, same Draft PR #1225. This correction supersedes the test counts and source-head receipt above; base is unchanged.
- Tested P1 SOURCE HEAD: `486e5a72524a3a7e9f9d71727ec94be9d0ef1f33`. Final PR head includes this evidence-only follow-up and is recorded in the PR body.
- One pure `customPeakError(entries, peak)` rule is shared by model and inline UI: when both values exist and peak exceeds entries, capacity outputs are null and capacity status is UNAVAILABLE. Owner values and independent economics remain unchanged; no clamp or band rescaling.
- Valid boundaries verified: blank/80/8 -> 10 tables with economics unavailable; 200/80/8 -> 10; 80/80/8 -> 10; 0/0/8 -> 0. Invalid 50/80/8 fails closed; correcting peak to 40 restores 5 tables immediately. Exact inline message and aria-invalid/description behavior are covered.
- P2 copy only: header now says `Ops status`; its Pulse + Live Operations algorithm is unchanged.
- Red/green proof: before the fix the new unit case returned 10 instead of null and the new browser case had no inline alert; both pass after the shared invariant.
- Latest local validation: 120/120 Vitest across the same 15 files; 10/10 route-mock E2E, retaining the prior 115 tests / 9 E2E coverage. Both focused TypeScript projects, targeted ESLint and Ops/import/money/owner-digest/shell/credential guards pass.
- Normal build PASS (1m07s); constrained build PASS (57.22s, heap 4096 MB / GOMAXPROCS=2). Diff check, targeted secret scan, five-path incremental allowlist and unchanged package/flag/version guard pass. Existing build warning categories remain unchanged.
- Full-app `tsc -b` remains NOT_MEASURED under the existing bounded policy; no shared type/core changes. Authenticated production smoke is not performed.
- No new screenshot is needed: valid Custom output retains SHA-256 `2ae61362cbb9b743b38e372436566752618b8c4fa849d26349020873b0030b1b`. The earlier terminal image predates the cosmetic `Status` -> `Ops status` label change; its forecast-horizon proof is unchanged.
- Incremental scope: two existing runtime files, existing model tests, existing E2E and this receipt only. No merge, deploy, DB, Edge, Gemini, flag, package, route or Wave 2 change.

## Screenshot byte receipts

Hashes identify the captured bytes, not a promise of browser-render byte identity across machines. Original screenshot hashes remain available in the baseline revision.

| Artifact | SHA-256 |
| --- | --- |
| `docs/ops/evidence/quant-q1/quant-1440x900.png` | `752dfb8e795383cc046bba98cfb05c5e2a3f50dcc1a5e508d9fbde277000c0c5` |
| `docs/ops/evidence/quant-q1/quant-1920x1080.png` (original Q1) | `01d1901d5e59eec848d5bc5eb69083766b6ca3cd2f5ef0f2248cc523ae06e60b` |
| `docs/ops/evidence/quant-q1/live-ops-embedded-1920x1080.png` (original Q1) | `9743f85a8cf5f6e84f9f85701a4f6f2b242cc7ba87f5b177eb8204cfefc38059` |
| `docs/ops/evidence/quant-q1/data-health-embedded-1920x1080.png` (original Q1) | `bbf5632a13b3924dc916e8f530818846e38de1bb36a0f34fd4f0337f478a0da5` |
| `docs/ops/evidence/quant-q1/mobile-fallback-390x844.png` | `d578037302ee642488a05495224450af60fc696c459a1c48041d25a3b95118fd` |
| `docs/ops/evidence/quant-q1/wave1-custom.png` | `2ae61362cbb9b743b38e372436566752618b8c4fa849d26349020873b0030b1b` |

## Rollout boundary

This source receipt is not production evidence. After review and merge, deploy only the exact reviewed merge SHA through the protected frontend workflow and perform authenticated Owner/Super Admin smoke. The narrow rollback is `opsQuantDashboardQ1: true -> false` followed by the same exact-SHA workflow.
