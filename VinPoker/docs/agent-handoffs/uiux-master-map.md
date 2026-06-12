# Agent Handoff — Session 6: Global UI/UX Mapping + Design System Audit

**Session:** uiux-master-map (Phase 0, docs-only)
**Branch:** `agent/uiux-master-map` (worktree `D:\VinPoker-uiux-map`, base origin/main `a56399e`)
**Date:** 2026-06-12
**App code changed:** none. Draft PR only — do not merge without owner review.

## What was produced

| Doc | Purpose |
| --- | --- |
| `docs/design/uiux-screen-inventory.md` | All 80 audited screens (54 routed pages + dashboard tabs/panels) with the full per-screen template (Screen/Path/Role/Purpose/Actions/Data/Quality/Risks/Batch) and conservative A–F classification; modal map, table/grid map, metric-card map, orphans, risky shared files, parallel-session exclusions, ownership table |
| `docs/design/uiux-master-map.md` | 20-section design strategy: vision, role model, nav, IA, PokerVN Stitch Dark token baseline + known token defects, component hierarchy, dashboard/form/table/badge/money/error rules, mobile, a11y, operator-safety rules, owner-finance rules, poker visual rules, 3D integration, Stitch rules, never-change-globally list |
| `docs/design/uiux-roadmap.md` | Phases 0–9 each with Goal/Allowed/Forbidden/Risk/Build-test/UAT/Rollback; standing security items and owner decisions |
| `docs/design/stitch/README.md` | Stitch ideation-only usage rules |

Audit method: 4 parallel read-only agents (player screens / ops screens + design debt / 8 workflow traces / mobile) + coordinator synthesis. ~814k tokens of investigation, all read-only.

## Highest-priority findings future sessions must know

1. **Intent bug (P4):** AttentionQueue per-table "swing" calls global `onAutoSwing()` — one-table button triggers club-wide processing (`DealerSwingTab.tsx:3613`).
2. **Control gap (P7/owner):** AdminStaking "1-step payout" auto-creates AND auto-cosigns its own release from one session (`AdminStaking.tsx:2204-2218`) — verify backend rejects same-user cosign; if not, P0.
3. **Falsified trail (P5):** payroll "Gửi bởi" renders the current viewer's id, not the stored submitter (`DealerPayrollTab.tsx:1036`); no approver name/time shown; no separation of duties in UI.
4. **Missing money record (P6):** real tournament payouts have no in-app ledger at all (`tournament_payouts` is design-only in seat-floor-ops handoff §9).
5. **Global mobile bug (P1):** Layout renders 10 bottom-nav tabs into `grid-cols-7` → two-row nav occludes bottom content on every phone page including operator consoles.
6. **One-line big win (P1):** `fontFamily.mono` isn't monospace — 207 `font-mono` usages (payroll money columns, wall-board countdowns) render proportional digits; `font-jetbrains` already shipped.
7. **Corrections to prior assumptions:** `src/components/tournament/seat/` does NOT exist on main (seat UI = `TableDrawPanel.tsx`; receipt RPC flow is feature-branch only). `StitchSchedulePreview.tsx` is untracked-only, not in origin/main. `/dealer-board` is not linked in nav and renders inside Layout.

## Screen ownership for future sessions

See inventory §15. Summary: P1 design-system session owns tokens + new `src/components/shared/` primitives; P2 cashier IA; P3 tracker/live (NOT TableDrawPanel); P4 dealer ops incl. swing-monolith decomposition; P5 payroll/finance (controlled patch, golden-master verification); P6 seat/floor + payout input; P7 staking; P8 engine/3D; P9 owner command center. AdminUsers + SetupDavinci + Unsubscribe token = dedicated security session, never a styling batch.

## Risks

- Shared-file blast radius: Layout.tsx (also uncommitted-modified in the main working tree), TournamentLivePanel (cashier+tracker), TournamentLiveView (ops+public, carries hole_cards — hidden-card invariant), SuperAdmin.tsx (exports consumed by MediaCenter), format.ts (~50 consumers).
- Classification E items await owner decisions: SetupDavinci, SuperAdmin Backing tab vs AdminStaking overlap, Rates tab consumers, dual registration systems.
- Phase 1 must wait for PR #13/#14 stabilization to avoid payroll-file conflicts.

## Next patch (one recommendation)

**Phase 1, PR 1: design-system primitives** — fix `fontFamily.mono`, gold→primary codemod + alias removal, ship `StatusPill`/`StatCard`/`PageLoader`/`EmptyState`/`ErrorState`, migrate the three colliding StatusBadge implementations. Single implementer, build+typecheck+360px screenshot pass, after PR #13/#14 land.
