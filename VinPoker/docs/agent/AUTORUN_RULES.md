# Autorun Rules

How to run VinPoker coding sessions semi-unattended ("overnight") **safely**. Load this when the
owner queues a bounded job for a session. Pairs with the local queue `.claude/RUN_QUEUE.local.md`
(git-ignored) and the safety hook in `LIVE_DB_RULES.md`.

## Core principle

**Autorun = exactly one bounded job per session.** A session picks up a single job from the queue,
does only that job, writes a checkpoint, and **stops**. It does **not** start a second job.

## Hard rules (non-negotiable)

- **One job per session.** No auto-picking the next job after finishing.
- **No merge.** No production deploy. **No DB apply** (`supabase db push` / `db reset` / `migration up`
  / `functions deploy` / `deploy_db=true` are blocked by the safety hook anyway).
- **No live feature-flag changes.**
- **No secrets** printed, committed, or logged.
- **Source-only** within the job's allowed paths. Anything outside → stop.
- **Stay in the assigned worktree/branch.** Never touch another session's worktree or an archived branch.

## Required preflight (every autorun job)

1. `git fetch origin`; `git status --short` — if there are **unrelated dirty files**, STOP and report.
2. Confirm the worktree/branch matches the job. Read `VinPoker/CLAUDE.md` + the relevant
   `docs/agent/*.md`. Read `SESSION_BOARD` (static) and the local board before editing.
3. Confirm the job's **allowed** paths and **forbidden** paths. State the chosen mode (FAST/SAFE/CRITICAL).

## Stop conditions (halt, write a blocker checkpoint, do not push past)

- Any DB / live / deploy step is required.
- Dirty unrelated files are present.
- Shared/high-risk files outside the allowed paths are needed.
- A merge conflict appears.
- The safety hook denies a command.
- A secret appears anywhere.
- The job would expand scope beyond its single stated task.

## Final output (every autorun job)

Exactly one of:
- **Done:** end-of-session checkpoint (`SESSION_TEMPLATES.md` §C) **+ draft PR link**. Never merge.
- **Blocked:** the blocker (which stop condition), what was done so far, and the safe next step.

Include the DB/Deploy safety line: `schema_migrations changed: NO · db push: NO · deploy: NO ·
secrets exposed: NO`.

## Queue mechanics

- The job list lives in `.claude/RUN_QUEUE.local.md` (**local-only, never committed**).
- The owner/coordinator marks one job `READY` and pastes it into a session. The session sets it
  `IN PROGRESS`, then `DONE`/`BLOCKED` in the local queue at the end — it does not advance the queue itself.

## Overnight prompt (paste one job, then stop)

```
Read VinPoker/CLAUDE.md and docs/agent/AUTORUN_RULES.md first.

Autorun mode: do EXACTLY ONE job, then stop. Do not pick another job.

Preflight: git fetch origin; git status --short. If unrelated dirty files, STOP and report.
Mode: use the cheapest safe mode for this job (FAST/SAFE/CRITICAL); state it.

No merge. No deploy. No DB apply. No live flag changes. No secrets. Source-only within allowed paths.
Stop on: DB/live/deploy needed, dirty unrelated files, conflict, safety-hook denial, or scope expansion.

Job: [PASTE ONE JOB FROM .claude/RUN_QUEUE.local.md]

Finish with: a checkpoint + draft PR link (never merge), or a blocker report. Then stop.
```
