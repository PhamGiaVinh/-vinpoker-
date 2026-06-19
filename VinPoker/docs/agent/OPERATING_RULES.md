# Operating Rules

Session/git/parallel discipline for VinPoker. Canonical rules are in `/VinPoker/CLAUDE.md`; this
file is the detail. Load when starting a session.

## 1. Source of truth & preflight

Treat `origin/main` as the source of truth — never stale local memory, stale worktrees, or stale
PR state. Before any non-trivial task:

```
git fetch origin
git status --short
git log --oneline -5 origin/main
```

If a session report conflicts with `origin/main`, GitHub PR state, or live DB verification, **stop
and report the conflict** before continuing.

## 2. Working mode (cheapest safe)

Choose **FAST / SAFE / CRITICAL** per `/VinPoker/CLAUDE.md`. State the mode and why. Do not escalate
to CRITICAL unless the task touches real money, permissions, the database, game correctness, or live
operations.

## 3. Git hygiene

- **Never `git add -A`.** Stage files by **explicit path**.
- One module per branch (`agent/<module>-<topic>` or `chore/<topic>`). Commit per logical step.
- Use a separate worktree (`D:/wt/<name>`) when more than one session is active, or when the current
  tree is dirty / on another branch. Never touch another session's worktree.
- Do not rebase/checkout over a dirty worktree. Do not overwrite uncommitted files.
- **Final diff proof before commit/PR:**
  ```
  git diff --name-only origin/main...HEAD
  git status --short
  git diff --cached --name-only
  ```
  If unexpected files appear, **stop and report** instead of continuing.

## 4. Parallel-session safety

- Read `SESSION_BOARD.md` first. If another active session owns the same files/module, **stop and
  report the conflict** — do not edit.
- No session may expand scope because it found an adjacent issue. Document adjacent issues as a
  follow-up; fix only with explicit owner approval.
- When a module needs data from another module, do **not** rewrite that other module — write/update
  a contract or handoff doc (`docs/agent-handoffs/<session>.md`, `src/types/…`, `src/contracts/…`).

## 5. Load control (don't overload the machine)

- Max **2 active coding sessions** + at most 1 docs/review session at once.
- Serialize heavy commands across worktrees: `npm install`, `npm run build`, `npx tsc --noEmit`,
  `deno check`, any Supabase migration/apply. Only one at a time unless the owner approves.
- High-risk shared files (serialize access): `src/components/Layout.tsx`,
  `src/components/cashier/DealerSwingTab.tsx`, payroll calc RPC migrations, Dealer Swing RPC
  migrations, tracker live components.

## 6. Secret handling

- Credentials only via env vars / CLI keyring / GitHub Secrets / approved runtime channel.
- **Never** commit, print, or write secrets into code, docs, PR descriptions, skill files, or logs.
- If a token/key appears anywhere (chat, logs, repo, config), **report it and recommend rotation** —
  treat it as compromised.

## 7. Owner-friendly automation

The owner is non-technical. Prefer a safe, named, allowlisted operation over asking the owner to run
complex SQL/git by hand — but automation stays controlled: `name → preflight → allowlisted SQL/script
→ verify before/after → rollback note → final report`. Never substitute "run whatever is needed".

## 8. Verification & reporting

- Frontend/TS sessions: run `npx tsc --noEmit` and `npm run build` when app code changed.
- Don't paste full successful logs — say it passed; on failure paste only the final relevant error.
- End with the **final report format** in `/VinPoker/CLAUDE.md` (Completed · Files Changed ·
  Verification · Known Issues · Risks · DB/Deploy safety · Next Step), then stop.
