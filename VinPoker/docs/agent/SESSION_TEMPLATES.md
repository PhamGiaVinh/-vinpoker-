# Session Templates

Copy-paste prompts so each session starts disciplined and ends with a clean checkpoint.

> **Owner (non-technical) prompts:** the plain-Vietnamese 🟢 GREEN / 🔴 RED copy-paste prompts live in
> `OWNER_LOOP.md`. Use those for owner-driven tasks; the templates below are the session-level scaffolding.

## A. Session contract (paste at the start of every session)

```
Read /VinPoker/CLAUDE.md and docs/agent/MODULE_MAP.md first.
Read docs/agent/SESSION_BOARD.md and confirm no active session owns my files.

Use the cheapest safe working mode:
- FAST for UI/text-only.
- SAFE for normal module logic.
- CRITICAL for DB, RLS, payroll, finance, game engine, live flags, deploy, or production risk.
Explain which mode you chose and why.

Hard rules:
- One writer (you). Read-only auditors only; no autonomous multi-agent coding loops.
- Do not apply live DB migrations. Do not deploy. Do not print secrets.
- Stay inside my assigned module; do not touch forbidden files.
- Start by running: git fetch origin; git status --short; git log --oneline -5 origin/main.
- Report unrelated dirty files before editing. Produce a plan before editing if scope is risky.

My session: [S?, module]
Branch / worktree: [agent/...  /  D:/wt/...]
Task: [paste task]
```

## B. Cheapest-safe-mode selector (short form)

```
Use the cheapest safe working mode (FAST / SAFE / CRITICAL). Do not escalate to CRITICAL unless the
task touches real money, permissions, the database, game correctness, or live operations. State the
mode and why.
```

## C. End-of-session checkpoint (paste into SESSION_BOARD.local.md, and into the PR summary)

```
Session checkpoint
Session ID:
Branch:
Worktree:
Status: ACTIVE / BLOCKED / DONE
Files changed:
Tests run:
Open risks:
Next step:
Files that may conflict with other sessions:
DB/Deploy safety: schema_migrations changed=NO | db push=NO | deploy_db=NO | secrets exposed=NO
```

## D. Invoking a read-only auditor (CRITICAL mode, or optional in SAFE)

```
Run the <reviewer | db-safety-auditor | rls-security-auditor | game-engine-auditor |
frontend-ux-auditor> auditor on this change. It is READ-ONLY: inspect the diff/files I provide,
do not edit, do not run live commands. Return Verdict (PASS/FAIL/NEEDS OWNER DECISION) + findings +
risks + suggested minimal fixes, per docs/agent/REVIEW_CHECKLIST.md.
```
