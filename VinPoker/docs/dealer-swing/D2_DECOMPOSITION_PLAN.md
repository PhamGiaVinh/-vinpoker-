# D2 — DealerSwingTab Decomposition Plan (+ slice 1)

> Roadmap item 12. **Multi-PR, byte-identical render.** `DealerSwingTab.tsx` is ~4.6k lines and is
> the most operator-critical screen, so D2 is a sequence of disciplined, individually-verified slices
> — NOT a one-shot rewrite. This doc is the contract for the sequence; **slice 1 ships in this PR**.
> UIUX phase: maintainability refactor (no visual/behavior change) under the existing dealer-swing
> design governance (stitch-ui / uiux-master-map).

## 1. Why slices, not a rewrite
A single rewrite of a 4.6k-line live screen can't be safely verified (preview snapshot diff is
auth-gated; one regression breaks floor ops). Each slice instead **relocates already-encapsulated
units verbatim** and proves equivalence with `tsc` (every call site still resolves/type-checks) +
`vite build`. Behavior cannot change because the moved code is byte-identical and only its file
location changes.

## 2. Current structure (ground-truthed)
`SwingPanel` (the default export) spans ~189–2817 (state, effects, handlers, render). After it,
**16 already-separate top-level components/hooks** live in the same file — these are the natural
extraction units:

| Component | ~line | Kind | Slice |
|---|---|---|---|
| `TierBadge`, `TableTypeBadge`, `StatusPill` | 4086 / 4105 / 4625 | pure leaf badges (no imports) | **1 (this PR)** |
| `DealerTimer`, `FatigueDot`, `TimerCell`, `PriorityBreakIndicator` | 2818 / 2834 / 4042 / 2844 | small leaves (timers/dots) | 2 |
| `CollapsibleSection`, `RecentActivitySection` | 2879 / 4581 | generic presentational | 2 |
| `BreakDurationDialog`, `SwingConfigDialog` (+ `useEffectiveDuration`, `AutoAdjustSection`) | 2912 / 4349 / 4123 / 4163 | dialogs | 3 |
| `RosterPanel` | 2991 | pane (RosterPane) | 4 |
| `BreakPoolCard` | 3372 | pane (BreakPoolPane) | 4 |
| `TableGrid` | 3557 | pane (TablesPane) | 4 |
| `CommandCenter` | 3788 | toolbar/command rail | 5 |

`SwingPanel`'s own internals (state groups, the board-snapshot memos, the command handlers) are the
last + hardest slices (6–7), extracted into hooks (`useDealerSwingBoard`, `useDealerSwingCommands`)
once the leaf/pane components are out and the file is smaller.

## 3. Slice order (each = its own owner-gated PR, tsc+build+UAT)
1. **Pure leaf badges** → `dealer-swing/SwingBadges.tsx` (`TierBadge`/`TableTypeBadge`/`StatusPill`). **← this PR.**
2. **Small leaves** (timers/dots/generic sections) → `dealer-swing/SwingLeaves.tsx`.
3. **Dialogs** → `dealer-swing/BreakDurationDialog.tsx`, `dealer-swing/SwingConfigDialog.tsx`
   (carry `useEffectiveDuration` + `AutoAdjustSection`).
4. **Panes** → `dealer-swing/RosterPane.tsx` (`RosterPanel`), `dealer-swing/BreakPoolPane.tsx`
   (`BreakPoolCard`), `dealer-swing/TablesPane.tsx` (`TableGrid`). These take more props but stay
   presentational.
5. **Command rail** → `dealer-swing/CommandCenter.tsx` (already prop-driven; mostly an import move).
6. **Board-snapshot hook** → `useDealerSwingBoard` (the derived memos: timelines, summaryCounts,
   nextDealerMap, tableAssignmentMap) out of `SwingPanel`.
7. **Commands hook** → `useDealerSwingCommands` (massAssign / swingAll / sendToBreak / close-table /
   create-tour handlers), leaving `SwingPanel` a thin shell/container.

## 4. Byte-identical proof (per slice)
- Move the unit **verbatim** (only add `export`); import it back at the original call sites.
- `npx tsc --noEmit` = 0 errors (proves every call site still resolves with identical prop types).
- `npm run build` = success.
- Diff is a pure move (deletions in DealerSwingTab == additions in the new file) + one import line.
- Owner UAT on the live screen (both themes) before merge — the slices are behavior-neutral but the
  screen is operator-critical, so a human glance per slice is the final gate.

## 5. Guardrails
No behavior/visual change; no DB/edge/RPC; no new deps. Each slice is frontend-only, verified by
tsc+build, owner-gated. Slices 6–7 (hook extraction) touch `SwingPanel` internals → smallest possible
steps, one memo/handler group at a time, each its own PR.

## 6. Slice 1 (this PR)
`TierBadge` / `TableTypeBadge` / `StatusPill` moved verbatim to `dealer-swing/SwingBadges.tsx` and
re-imported. They are pure (props + Tailwind only, zero imports) → render output is identical.
`tsc` 0 errors + `vite build` OK confirm all call sites still resolve.
