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

**Owner lens (🟢 GREEN / 🔴 RED).** The non-technical owner decides in 5 seconds: *does this touch
money, cards, or game results?* 🟢 **GREEN** (no) → run FAST or SAFE, full automation; owner approves a
1-line Vietnamese plan, you do everything, report + how-to-test. 🔴 **RED** (yes — payroll / cashier /
withdrawal / staking split / chip count / who-wins / settlement / price-fee) → run CRITICAL: explain
the **money flow in plain Vietnamese** for approval BEFORE writing, then run adversarial **attack
tests** (concurrency, idempotency, rounding, sum-in=sum-out), then **STOP before production**. **Not
sure → treat as RED.** Full protocol + copy-paste prompts: `docs/agent/OWNER_LOOP.md`.

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

- `docs/agent/OWNER_LOOP.md` — 🟢/🔴 owner loop (money-vs-not decision) + copy-paste Vietnamese prompts.
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

## Web/UI inspection — BẮT BUỘC (mọi session)

- **Xem TRƯỚC khi sửa:** mọi việc UI/UX, MỞ giao diện đang chạy bằng **Playwright MCP**
  (dev server localhost / preview / UAT flag-ON), inspect accessibility snapshot + screenshot
  TRƯỚC khi sửa. Chẩn đoán từ cái render THẬT, không đoán từ code.
- **Verify SAU khi sửa:** sau mỗi thay đổi UI, MỞ LẠI bằng Playwright MCP, xác nhận fix bằng
  screenshot + snapshot. `tsc -b`/build pass KHÔNG đủ — phải xác nhận bằng mắt (build pass ≠ UI chạy).
- **Tham khảo web ngoài:** khi tham khảo sản phẩm/docs khác (layout racetrack, luật TDA…), dùng
  **Playwright MCP** (UI sống) / **Firecrawl MCP** (scrape docs) — không đoán.
- **Câu đầu mỗi lần** phải nói rõ "dùng playwright mcp" (không thì agent có thể chạy Bash thay vì MCP).
- **Ngoại lệ:** thay đổi thuần logic/engine (không ảnh hưởng render) verify bằng test như thường.
  Tôn trọng flag-gating — mở preview flag-ON, KHÔNG mở production.

> Áp dụng đặc biệt cho **session Engine** và **session Tracker**. Tracker: tham khảo
> `https://rptlive.app/event/...` (qua Playwright/Firecrawl, học bố cục live-event — KHÔNG copy
> nguyên xi) rồi điều chỉnh, giữ theme + scope của VinPoker.
