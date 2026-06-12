# Agent Handoff — Feature UX Cleanup: Dealer Swing + Tracker Operator Flow

**Session:** feature-ux-dealer-swing-tracker (UI/display-only)
**Date:** 2026-06-12
**Base:** origin/main `4577a10`
**Branches:** `agent/dealer-swing-ui-cleanup` (PR-A, Dealer Swing), `agent/tracker-ui-cleanup` (PR-B, Tracker)
**Mode:** frontend-only. No backend, no DB, no hooks/RPC/realtime changes, no payroll, no new features.

---

## 1. Files inspected

- `src/components/cashier/DealerSwingTab.tsx` (4,272 lines) + `TableCard*`, `DealerRow.tsx`, `NextDealerPreview.tsx`, `DealerManagementTab.tsx`, `command-center/*` (AttentionQueue, AttentionItem, OperationsCard, SystemHealthCard, QuickLinksCard, ExceptionCenter)
- `src/pages/DealerControlBoard.tsx` (read-only — out of scope this session)
- `src/pages/TrackerDashboard.tsx`, `src/components/cashier/TournamentLivePanel.tsx`, `tournament-live/{TournamentLiveView,HandInputPanel,ClockPanel,HandHistoryPanel,LeaderboardPanel,BlindStructurePanel}.tsx`, `src/pages/TournamentLiveTracker.tsx`
- Canonical docs: `docs/design/uiux-master-map.md`, `uiux-screen-inventory.md`, `uiux-roadmap.md`, `stitch/README.md`

## 2. Dealer Swing — UX problems found

| # | Problem | Severity | Status |
|---|---------|----------|--------|
| 1 | Mobile hierarchy inverted: main grid stacked Break Pool → Roster → Tables → Command Center, putting the attention queue + KPIs at the **bottom** on phones | P1 | **Fixed (PR-A)** — CSS order; desktop unchanged |
| 2 | "Swing All" and "Gán loạt" fire club-wide effects on a single click, no confirmation | P1 (operator safety) | **Fixed (PR-A)** — AlertDialog with blast-radius copy; same handlers |
| 3 | **AttentionQueue per-table "Swing" calls global `onAutoSwing()`** — one-table button triggers club-wide swing processing (`DealerSwingTab.tsx` ~:3613–3616) | **P0-class intent bug** | **NOT TOUCHED — owner decision.** Fix in a dedicated controlled session. Behavior in this PR is bit-identical. |
| 4 | Audit log unreadable: raw action codes + bare time; payload already carries dealer/table names but wasn't rendered | P2 | **Fixed (PR-A)** — Vietnamese label map + payload names + relative time; no new queries |
| 5 | Attention-queue action buttons h-5 (20px) — too small for floor touch | P2 | **Fixed (PR-A)** — 32px below lg, compact at lg+ |
| 6 | Assignment-modal score breakdown hover-only (onMouseEnter) — unreachable on touch | P2 | **Fixed (PR-A)** — shadcn Popover (tap to open) |
| 7 | Countdown digits jitter: `font-mono` isn't monospace in this repo | P2 | **Fixed (PR-A)** for the two swing timers only (`font-jetbrains tabular-nums`); global font-mono defect stays roadmap P1 |
| 8 | Special-dates / swing-config dialog grids cram at 360px | P2 | **Fixed (PR-A)** — stack below sm |
| 9 | Raw zinc/emerald/amber palette instead of theme tokens throughout swing surfaces | P2 (debt) | Not fixed — roadmap P1 owns the codemod; only opportunistic swaps on touched lines |
| 10 | `command-center/ExceptionCenter.tsx` is dead code (zero imports) | P2 (debt) | Not fixed — roadmap P1 owns deletion |
| 11 | Excluded-table list and REST_MINUTES hardcoded client-side | P2 (debt) | Not fixed — needs a config-column backend patch (separate session) |
| 12 | `/dealer-board` renders inside Layout (should be chrome-free wall display) | P2 (debt) | Not fixed — App.tsx route move is roadmap P4 proper |

## 3. Tracker — UX problems found

| # | Problem | Severity | Status |
|---|---------|----------|--------|
| 1 | 8-tab strip `grid-cols-3/4/8` wraps to 3 ragged rows on phones | P1 | **Fixed (PR-B)** — MediaCenter scrollable TabsList pattern |
| 2 | Tournament selector placeholder reuses the "Chọn Bàn" (table) i18n key | P2 | **Fixed (PR-B)** — new `selectTournament` key |
| 3 | Mixed English/Vietnamese labels: hardcoded "Input"/"Blinds"/"Prizes" tabs, "Action Timeline", "Table Stats" (vi.json keys existed but unwired) | P2 | **Fixed (PR-B)** — wired existing keys + additive new keys; poker terms (ALL IN, FOLD, Pot, BTN, Blinds) intentionally stay English |
| 4 | Status badges render raw enum ("FINAL TABLE") | P2 | **Fixed (PR-B)** — Vietnamese label map, colors unchanged |
| 5 | Seat pods fixed w-36 overlap/clip below ~411px on the felt | P1 (floor phones) | **Fixed (PR-B)** — width-only responsive classes; SEAT_POSITIONS/data untouched |
| 6 | Voided-hand strike-through never rendered (`#{…}` Ruby-style interpolation inside a literal class string, HandHistoryPanel ~:229) | P2 (real display bug) | **Fixed (PR-B)** |
| 7 | HandHistoryPanel swallows query errors into an empty list (silent failure) | P1 (operator trust) | **Fixed (PR-B)** — inline destructive banner + Thử lại; query shape unchanged |
| 8 | HandInputPanel read-only state (heartbeat lock lost) signaled only by a toast + tiny badge; operators keep typing into a dead session | P1 | **Fixed (PR-B)** — persistent banner rendering the existing `isReadOnly` state |
| 9 | Client-driven clock auto-advance (any open tab can fire next_level — race) | P1 (backend) | Not fixed — documented backend item; do not hack client-side |
| 10 | Same `TournamentLiveView` serves ops AND public `/live/:id`, carrying `hole_cards` in seat payloads (hidden-card invariant) | Known design risk | **No change to data rendering in this session** (verified byte-identical except classNames/labels). Structural fix belongs to the engine-contract track. |
| 11 | Tracker role sees mutating tabs it may not be able to use (server rejection invisible) | P2 | Not fixed — needs role-aware tab design, roadmap P3 proper |
| 12 | Freshness stamps exist only in TournamentLiveView; Clock/Leaderboard/HandHistory panels show no last-updated | P2 (debt) | Not fixed — needs per-panel state plumbing, deferred |

## 4. Information hierarchy applied

**Dealer Swing (per the operator-question framework):**
1. *What needs me now?* → Command Center (attention queue, critical/warning groups) — now FIRST on mobile, right rail on desktop.
2. *Workspace* → table grid with due timers (stable digits) in the center.
3. *Reference* → break pool + roster last on mobile, left rail on desktop.
4. *Dangerous actions* → Swing All / Gán loạt now confirm with restated blast radius. Per-table swing untouched (see §2.3).
5. *History* → recent activity collapsed to 3 rows, readable labels, full dialog one click away.

**Tracker:** context header (tournament + status badge) → tab strip (one scrollable row) → freshness banners (existing pattern, untouched) → hand state → input → history with visible error states.

## 5. Follow-ups for future sessions (do NOT mix into other work)

1. **Dedicated controlled patch:** fix AttentionQueue per-table swing wiring (`onSwing` should call `performSwingForTable(a.id)`, not `onAutoSwing()`); needs staging swing-cycle verification.
2. Roadmap P1: shared primitives (StatusPill/ErrorState/…), global font-mono fix, zinc→token codemod, delete ExceptionCenter.
3. Roadmap P4 proper: DealerSwingTab decomposition (pure moves), `/dealer-board` out of Layout, DealerManagementTab mobile collapse, config-driven REST_MINUTES/excluded tables.
4. Roadmap P3 proper: role-aware read-only tracker projection, clock event log display, per-panel freshness stamps.
5. Backend items: client clock auto-advance; engine state contract preventing hole-card leakage structurally.

## 6. Safety report

```
schema_migrations changed: NO
deploy_db=true used: NO
supabase db push used: NO
pending migrations applied: NO
secrets exposed: NO
forbidden files touched: NO
public /live/:id data rendering changed: NO
```
