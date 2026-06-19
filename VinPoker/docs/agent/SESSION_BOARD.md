# Session Board (static template)

This tracked file defines the **fixed coordination slots** and the conflict rule. It intentionally
holds **no live per-session state** — that would cause cross-branch merge conflicts. Live state
(who is active, which branch/worktree, dirty files, current task, checkpoints) lives in the
**local, git-ignored** board: `.claude/SESSION_BOARD.local.md`.

## Global rule

**No session may touch files owned by another active session.** Read this board and the live local
board before editing. If an overlap appears, **stop and ask the owner** — do not edit.

## Fixed slots

| Slot | Module | Default mode | Owns (high level) | Must not touch |
|------|--------|--------------|-------------------|----------------|
| **S0** | Coordinator / Planner (no code) | — | task split, live board, conflict detection, prompts, checkpoints | any code edits |
| **S1** | Online Poker / Game Engine | SAFE→CRITICAL | `src/**/poker/**`, pure engine, engine tests | business-ops modules, live DB, deploy |
| **S2** | Tracker / Tournament Live | SAFE | tracker UI, viewer-hub, tracker hooks/lib | online engine, payroll, live DB apply |
| **S3** | Payroll / Finance | CRITICAL | payroll UI/dashboards, finance read paths | silent financial mutation, live apply, game engine |
| **S4** | Floor / Seat Assignment | CRITICAL | floor/seat UI + workflows | broad seat-flow rewrite, owner-gated RPCs |
| **S5** | Dealer / Shift / Swing | SAFE→CRITICAL | dealer app/folder, shift planner, swing UI | `perform_swing`/scheduler internals without snapshot+rollback |
| **S6** | Club Intelligence / Owner BI | SAFE→CRITICAL | BI/rules-engine UI, dataset import | fake predictions, cross-club leakage, live financial mutation |

See `MODULE_MAP.md` for the full per-module key concerns and allowed/forbidden detail.

## How to use

1. Before editing: read this board + `.claude/SESSION_BOARD.local.md`.
2. Claim a slot in the **local** board (branch, worktree, current task) — never here.
3. If your files overlap another active slot, **stop and report**.
4. At session end, write a checkpoint (see `SESSION_TEMPLATES.md` §C) into the local board.
