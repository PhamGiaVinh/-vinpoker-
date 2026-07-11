# Review Checklist

Use the **PR-ready checklist** before declaring a task done. Use the **auditor checklists** when a
read-only auditor is invoked (optional in SAFE mode, mandatory in CRITICAL — see
`/VinPoker/CLAUDE.md`). Auditors **inspect only**; they never edit, run live commands, deploy, or
recurse.

## PR-ready checklist (main session)

- [ ] Scope: only the assigned module changed — no scope creep, no unrelated fixes.
- [ ] `git diff --name-only origin/main...HEAD` shows only intended files; no surprise files.
- [ ] Source-only unless the task explicitly authorizes a live apply.
- [ ] Feature flags default **OFF**.
- [ ] No DB/Edge/deploy changes (or, if present, they are owner-approved + documented).
- [ ] Test evidence: `npx tsc --noEmit` + `npm run build` pass (when app code changed); relevant tests run.
- [ ] Security/RLS impact considered; no secrets in diff/logs/PR.
- [ ] Rollback path noted for any risky change.
- [ ] Final report present (Completed · Files · Verification · Known Issues · Risks · DB/Deploy
      safety · Next Step).
- [ ] **Verdict:** SAFE TO MERGE / NEEDS OWNER DECISION / BLOCKED.

### Money changes (🔴 RED / CRITICAL) — extra bar

- [ ] Attack-test evidence attached: **concurrency** (two people at once), **idempotency** (double
      click / retry never pays twice), **rounding** (no drift over many repeats), **conservation**
      (total in = total out). Report PASS/FAIL per case in plain language.
- [ ] Money code (payroll / cashier / settlement / staking) flagged for **independent human technical
      review** before real money flows in production — the one place Claude-only carries real risk.
- [ ] Feature flag default **OFF**; stop before production; owner approves ("OK đẩy lên") to proceed.

## Auditor output format (all auditors)

```
Verdict: PASS / FAIL / NEEDS OWNER DECISION
Scope reviewed:
Findings (severity P0/P1/P2):
Risks:
Suggested minimal fixes:
Files inspected:
```

## reviewer
Scope creep, unrelated files, source-only safety, flags default OFF, DB/Edge/deploy presence, test
evidence, regression risk, merge readiness.

## db-safety-auditor
RLS, `SECURITY DEFINER` + `search_path`, grants/revokes, anon exposure, destructive statements,
migration-slot collision, live-apply safety, rollback path, role boundaries. **Never applies DB
changes — audit only.**

## rls-security-auditor
Owner/cashier/floor/dealer/player separation, cross-club leakage, public-viewer-safe data,
authenticated vs anon grants, client-trusted writes, RPC role checks. Return PASS/FAIL with exact reason.

## game-engine-auditor
Server-authoritative flow, NLH rules correctness, all-in/call/runout/showdown sequence, pot and
side-pot math, chip conservation, idempotency, race conditions, hidden-card secrecy, stale hand
history, reconnect/spectator behavior, missing tests.

## frontend-ux-auditor
Mobile usability, ≥44px tap targets, Vietnamese owner/operator clarity, loading/error/empty states,
stale state, role-based visibility, casino-style visual clarity where relevant.

## Series Intelligence — forecast honesty doctrine (A6)

Engineering + product doctrine for any forecasting / analytics change under
`src/lib/series-intelligence/`. **Enforced by** `featureBoundary.ts` (the one feature-availability +
pattern registry), `modelCapability.ts` (the one sample-size gate), the canonical walk-forward in
`turnoutForecast.ts`, and the guardrail tests (`featureBoundary` / `patternGuard` /
`seriesArchitecture` / `modelCapability` / `walkForward` / `baselineBattery`). Not new UI.

**Three labels — the ONLY honest framings for an analytics claim:**

- **Observed Pattern** — a measured fact about the past ("the last 3 Main events averaged 128"). No
  claim about the future. Historical association, not causation.
- **Hypothesis** — a model-based estimate, labelled as such (never "Model Estimate"), always with a
  band + confidence tier + walk-forward error + disclaimer, behind a default-OFF flag until it beats
  the baseline.
- **Decision Support** — surfaces the trade-off for the owner to decide; never auto-acts.

**Rules (all must hold):**

- Historical association is **not** causality; frequency is **not** predictive skill.
- A pattern must be compared against a **null expectation** (what pure randomness would produce).
- **"due" / "hot" / "cold" / "overdue" / "streak"** ("lâu chưa đông", "kỳ này đến lượt đông")
  language is **forbidden** in owner-facing forecast claims — and such features are registry-rejected
  (`PATTERN_FEATURE_REGISTRY`), admissible only via an owner-approved `ResearchContract`.
- Insufficient data must **never** be turned into a confident number — degrade to an honest
  "chưa đủ dữ liệu", never a fabricated value.
- A **model-skill claim** ("tốt hơn baseline") requires a **matched-fold** comparison against a
  baseline (same folds, both non-null metrics, capability min-fold met) — never mismatched fold sets.
- **best-of-N** experiments must **disclose N** (multiple-testing / trial-count record).
- **No auto-act** from an analytical pattern — analysis proposes; the owner decides.

**Feature discipline (registry is the authority):**

- Every quantity that may enter a model is registered in the ONE feature registry with a stable
  machine id and exactly one availability class (`static_known` / `observed_by_origin` /
  `outcome_only`). Unknown ids fail closed; `outcome_only` can never be a feature;
  `observed_by_origin` needs `observedAt ≤ originTs`. No feature builder keeps a private list, and no
  second registry / capability gate / walk-forward path is introduced. This is registry membership,
  **not** a keyword ban — legitimate ids like `editionTrend` are unaffected.
