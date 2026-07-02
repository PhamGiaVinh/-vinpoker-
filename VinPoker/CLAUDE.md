# VinPoker — Canonical Claude Code Instructions

This is the **canonical** instruction file for VinPoker. The machine root `CLAUDE.md` is only a
global bootstrap; **if anything conflicts, this file wins** for work inside this repo. Detailed
rules live in `docs/agent/*.md` and should be loaded **only when the task needs them** (do not
`@`-embed them — that re-inflates context).

## Identity & context

VinPoker is a production poker-operations platform (React/TS/Vite/Tailwind + Supabase/Postgres/
RPC/Edge/Realtime) evolving toward online poker. The owner is the **sole developer/operator and
non-technical**. Many Claude Code sessions run in parallel, **one module each**. Production
Supabase project ref: `orlesggcjamwuknxwcpk`. Environment: Windows + PowerShell.

## Non-negotiables

- **Never** print/commit/log secrets. Exposed tokens are compromised → owner must rotate.
- **No `supabase db push` / `db reset` / `migration up` / `deploy_db=true`** and **no production
  deploy** unless inside an owner-approved controlled runbook with the exact owner phrase.
- **Feature flags default OFF.** Never silently enable a flag or recompute saved financial values.
- **Saved values are stored values** (payroll, finance, KYC, ledger) — never overwrite audit trails.
- The **safety hook is mandatory** (see `docs/agent/LIVE_DB_RULES.md`) — do not remove/weaken/bypass.
- Stay inside your session's assigned module. Adjacent issues → document as follow-up, do not fix.

## Obsidian Command Center — Source of Truth

VinPoker external memory lives at **`D:\Quy trình\VBacker`** (Obsidian vault). This is the canonical
source for module status, agent handoffs, risks, and runbooks. **Do not rely on chat history if it
conflicts with the vault** — Obsidian wins unless owner explicitly says otherwise.

### Required reading before every task

1. `01-MODULE-STATUS/MODULE_STATUS.md` — current live/source state
2. `03-AGENT-HANDOFFS/AGENT_BOARD.md` — active session slots + blockers
3. `02-OWNER-DECISIONS/OWNER_DECISIONS.md` — owner policies + approval rules
4. `02-OWNER-DECISIONS/AGENT_POLICY.md` — your role + forbidden files
5. `05-RUNBOOKS/LIVE_TRUTH_VERIFICATION.md` — 6-layer verification doctrine

### Vault rules

- **Do not rewrite canonical notes** (`MODULE_STATUS`, `OWNER_DECISIONS`, etc.) unless owner explicitly asks.
- **Update only your handoff file** at end of task:
  - Claude → `03-AGENT-HANDOFFS/CLAUDE_LATEST.md`
  - Codex → `03-AGENT-HANDOFFS/CODEX_LATEST.md`
  - Gemini → `03-AGENT-HANDOFFS/GEMINI_LATEST.md`
- **Never store secrets** in Obsidian. Vault is readable history.
- **DB/Edge/money-path work** still requires owner approval + runbook. Obsidian vault documents
  the runbook, not permission.
- **One task = one agent = one branch = one worktree.** Update AGENT_BOARD as you start; clear
  it when done.

See `D:\Quy trình\VBacker` for full index and runbooks (CONTROLLED_DB_APPLY, EDGE_DEPLOY, etc.).

## Working modes — pick the cheapest that is safe

- **FAST** — UI/text-only; no DB, no money/game/security logic. Short plan + minimal verify.
  No auditor.
- **SAFE** — normal module logic / state changes; permissions not deeply affected. Plan →
  implement → test → self-audit. Optional read-only `reviewer` or `frontend-ux-auditor`.
- **CRITICAL** — DB, RLS, payroll, finance, game-engine correctness, live flags, Edge deploy,
  or any production risk. Plan first → implement → **mandatory** relevant read-only auditor before
  PR-ready → test evidence → rollback notes. A FAIL blocks the merge recommendation until resolved
  or the owner accepts the risk.

State which mode you chose and why. Do not escalate to CRITICAL unless the task touches real money,
permissions, the database, game correctness, or live operations.

## Agent Model: Solo Writer + Read-Only Auditors

VinPoker uses a SOLO-BY-DEFAULT working model.

### Default rule
Each coding session has exactly one writer: the main Claude Code session.
The main session owns:
- reading context
- planning
- editing files
- running tests
- preparing the PR summary
- reporting risks

### Forbidden
The following are not allowed:
- autonomous multi-agent coding loops
- multiple agents editing the same worktree
- reviewer agents that directly modify files
- agents that expand scope without owner approval
- agents that apply live DB changes
- agents that deploy Edge Functions or production frontend
- agents that trigger other agents recursively
- agents that hide uncertainty or incomplete verification

### Allowed
Read-only specialist auditors are allowed when useful.

Allowed auditor roles:
- reviewer
- db-safety-auditor
- rls-security-auditor
- game-engine-auditor
- frontend-ux-auditor

Auditors may:
- inspect the plan, diff, tests, and relevant files
- identify risks
- return PASS / FAIL / NEEDS OWNER DECISION
- suggest minimal fixes

Auditors must not:
- edit files
- run live commands
- apply migrations
- deploy
- change feature flags live
- create recursive review loops

### When to use auditors

FAST MODE:
- UI/text-only
- no DB
- no payment/game/security logic
- no auditor required

SAFE MODE:
- normal module logic or state changes
- optional read-only reviewer or frontend auditor

CRITICAL MODE:
- DB, RLS, payroll, finance, game engine, live flags, Edge deploy, production risk
- use the relevant read-only auditor before PR-ready status
- any FAIL from an auditor blocks merge recommendation until resolved or owner accepts the risk

### Final authority
The main session remains responsible for the final answer.
Auditor feedback is advisory but must be reported honestly.
The owner decides whether to proceed when there is risk.

> Auditor definitions live in `.claude/agents/` (read-only: tools Read/Grep/Glob only). They are
> present in the main repo; for `D:/wt/*` worktrees, invoke audits from the main repo or copy them.

## Branch / worktree / session isolation

- One module per branch. Branch names like `agent/<module>-<topic>` or `chore/<topic>`.
- Use a separate worktree (`D:/wt/<name>`) when more than one session is active, or when the
  current tree is dirty/on another branch. Never edit another session's worktree.
- Preflight before non-trivial work: `git fetch origin`, `git status --short`,
  `git log --oneline -5 origin/main`. Treat `origin/main` as source of truth.
- Stage by **explicit path** — never `git add -A`. Commit per logical step. Final diff proof
  (`git diff --name-only origin/main...HEAD`) before commit/PR; if unexpected files appear, STOP.
- Read `docs/agent/SESSION_BOARD.md` first; if another active session owns the same files, STOP
  and report the conflict instead of editing.

## Final report format

End every task with: **Completed · Files Changed · Verification (build/typecheck/test) · Known
Issues/Later · Risks · DB/Deploy safety (schema_migrations changed / db push used / deploy_db
used / secrets exposed — expected all NO) · Next Step.** Then stop.

## Detailed rules (load on demand — path only, no `@`-embed)

- `docs/agent/OPERATING_RULES.md` — session/git/parallel discipline, load control, secrets.
- `docs/agent/LIVE_DB_RULES.md` — controlled DB apply model + the mandatory safety hook.
- `docs/agent/MODULE_MAP.md` — module ownership, key concerns, allowed/forbidden files.
- `docs/agent/REVIEW_CHECKLIST.md` — PR-ready checklist + per-auditor checklists.
- `docs/agent/SESSION_TEMPLATES.md` — session contract prompt + checkpoint format.
- `docs/agent/SESSION_BOARD.md` — fixed coordination slots (live state is local-only).

## UI/UX work

Before any UI work, read the `stitch-ui` + `uiux-master-map` skills and declare roadmap phase +
affected screens + allowed/forbidden files. Keep the Stitch Dark neon-green theme (red felt only
inside poker-table components). The master map is guidance, not permission to edit out-of-scope files.
