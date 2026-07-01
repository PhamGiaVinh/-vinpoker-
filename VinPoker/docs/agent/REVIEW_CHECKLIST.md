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
