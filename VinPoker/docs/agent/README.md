# VinPoker Agent Operating Docs

This folder is the **detail layer** of VinPoker's Claude Code operating system. It exists so that
`CLAUDE.md` stays short and each session loads only what its task needs.

## The three layers

1. **`/CLAUDE.md` (machine root)** — short global bootstrap. Non-negotiables + precedence + pointers.
2. **`/VinPoker/CLAUDE.md`** — canonical rulebook: modes, agent model, safety, branch rules, report
   format. **Wins on conflict** with the root bootstrap.
3. **`/VinPoker/docs/agent/*.md` (this folder)** — detailed rules, **loaded on demand only**.

Do **not** `@`-embed these files into `CLAUDE.md`; reference them by path. Embedding re-inflates
context and defeats the purpose of the split.

## Files

| File | Load when… |
|------|-----------|
| `OPERATING_RULES.md` | Starting any session — git/preflight/parallel discipline, load control, secrets. |
| `LIVE_DB_RULES.md` | The task touches Supabase / DB / migrations / Edge / deploy. |
| `MODULE_MAP.md` | You need to know which files a module owns / must not touch. |
| `REVIEW_CHECKLIST.md` | Preparing a PR, or running a read-only auditor. |
| `SESSION_TEMPLATES.md` | Opening a new session or writing an end-of-session checkpoint. |
| `SESSION_BOARD.md` | Always read first — fixed session slots + conflict rule. |
| `archive/LEGACY_NOTES.md` | Only if the owner explicitly asks about the old long CLAUDE.md. |

## Agent model in one line

**One writer, many possible read-only reviewers. No autonomous multi-agent coding loops.
Auditors inspect; they do not edit.** Auditor definitions: `.claude/agents/` (read-only).

> Note: `.claude/agents/` and `.claude/hooks/` live in the **main repo** `.claude/`. They are not
> automatically present inside `D:/wt/*` worktrees — invoke audits from the main repo, or copy the
> definitions into the worktree if needed. The **safety hook** is registered user-globally
> (`~/.claude/settings.json`) so it protects every session and worktree regardless.
