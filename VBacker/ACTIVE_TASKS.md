---
title: Active Tasks & PR Board
updated: 2026-07-09
type: tracked
---

# Active Tasks — VinPoker Task Board

**Format:** PR # | Branch | Status | Assigned | Notes | Runbook  
**Update cadence:** Agent updates on completion, owner syncs sprint review  
**Archive:** When closed (moved to PR-REVIEWS/ if important)

## 🟢 Tracking: Tracker Sửa-hand → tự đảo chip (Đợt F/G) — money-path

| Item | Status | Assigned | Notes |
|------|--------|----------|-------|
| F2 "Sửa hand" (display-only) | ✅ LIVE | Claude/Owner | #806 merged · mig `20261225000000` applied · flag `trackerHandHistoryEdit` ON (#807) · owner UAT ✅ |
| G1 resettle engine (pure, inert) | ✅ MERGED LIVE | Claude | #813 · `resettleForward.ts` + 10 tests · 6 block reasons · nothing calls it yet |
| G2 apply RPC (chips-only atomic) | ✅ MERGED + APPLIED LIVE | Claude/Owner | #815 · mig `20261226000000` applied 2026-07-09 (anon-execute=false ✓) · auditor PASS · flag `trackerResettleForward` OFF |
| **G3: "Sửa & tính lại chip" UI** | ✅ MERGED + LIVE | Claude/Owner | #818 merged · flag `trackerResettleForward` ON (#820) · client `reduceHand` copy + `resettleApply` mapping; entry_number re-attach; changed-only conservation subset |
| G3 hardening (post-go-live review) | ✅ MERGED + LIVE | Claude/Owner | #823 · 36-agent adversarial review → 11 real bugs/15 fixed: intra-subset drift re-check, re-entry block, paged fetch, side-pot manual guard, atomic UX; **manual-winner picker** added (v1 gap closed); 28/28 tests |
| G3-A+B: server guards (belt + starting_stack) | ✅ mig APPLIED LIVE · ⏳ merge #824 | Claude/Owner | mig `20261227000000` **APPLIED 2026-07-09** (anon=false verified). Freshness belt (`expected_current`) + `starting_stack` via OPTIONAL jsonb fields → signature UNCHANGED, backward-compat. 2 adversarial reviewers clean. **NEXT: merge #824** (client sends fields → belt engages) → UAT on TEST tournament. Spec: [[resettle-forward-server-hardening]] |

**Why:** owner wants editing an old completed hand to auto re-score the winner + reverse chips. **LIVE + client-hardened**; only 2 defense-in-depth server migrations remain (owner-gated coordinated deploy). See [[project-resettle-forward-g3-ui]] + [[CLAUDE_LATEST]].

---

## 🔴 P0: Close Report Launch (THIS SPRINT)

| Item | Status | Assigned | Runbook | Notes |
|------|--------|----------|---------|-------|
| Migration apply | ✅ DONE | Owner | [[CONTROLLED_DB_APPLY.md]] | Enum `completed` added, migration live, table+RPC verified |
| Code merge #669 | ✅ DONE | Owner | — | fabfc87e live on main, Vercel deployed |
| Flag flip #685 | ⏳ READY | Owner | — | **1-line commit:** `closeReport: false` → `true` |
| **ACTION:** Merge #685 | ⏳ OWNER | Owner | — | **BLOCKS:** nút "Chốt giải" not visible until merged |
| Floor UAT | ⏳ BLOCKED | Owner | — | **UNBLOCK:** Merge #685 → enter giải → nút appears → test 2-step lock |

**Why P0:** Settlement + financial audit = critical for every tournament ending. Owner scope approved, code audited, migration live, ready for go-live.

---

## 🔴 P0: Repair Wave Live-Apply (OWNER GATE)

| Item | Status | Assigned | Runbook | Notes |
|------|--------|----------|---------|-------|
| **R1: Payout Edge redeploy** | MERGED | Claude | [[EDGE_DEPLOY.md]] | compute-payouts stale v1→v1.1, GH Actions leg |
| **R2: Finance PT Wage restore** | MERGED | Claude | [[CONTROLLED_DB_APPLY.md]] | P&L missing PT rolling, mig 20261201*, golden-diff gate |
| **R3: Staking Refund hardening** | MERGED | Claude | [[EDGE_DEPLOY.md]] | 3 Edge fns + nil-schema fix, append-only guard |
| **ACTION:** Dispatch workflow | ⏳ OWNER | Owner | GH Actions repair-wave-apply.yml | **BLOCKS:** R1–R3 Edge deploys not live until workflow runs |
| **Smoke tests:** R1, R2, R3 | ⏳ BLOCKED | Claude | Golden-diff report (auto) | **UNBLOCK:** Owner triggers workflow → legs run → green ✓ each |

**Why P0:** Money flows through all 3 paths (payout, finance, staking). Live apply = gate for ongoing operations.  
**Workflow:** leg 1 (payout) → green ✓ → leg 2 (finance) → green ✓ → leg 3 (staking) → green ✓ → DONE.

---

## 🟠 P1: Series Intelligence UAT (OWNER GATE)

| Item | Status | Assigned | Runbook | Notes |
|------|--------|----------|---------|-------|
| Code + flags | ✅ LIVE | Claude | — | 3 flags ON, Kelly OFF, 7 PRs merged + live |
| **Owner live-numbers verify** | ⏳ OWNER | Owner | — | **Test:** `/club/admin/series-intelligence` on prod, check quarterly/avg-contribution/F&B numbers |
| Approve Kelly? | ⏳ OWNER | Owner | — | If yes → prepare bankroll + flip `seriesKellyHint` ON |
| Regime switch? | ⏳ DEFERRED | Owner | PR #678 (source-only) | Local-only `regimeOverride.ts`, not a priority |

**Why P1:** Live revenue intelligence. Kelly + regime = optional, not launch-critical.

---

## 🟡 P2: Accounting Control UI (OWNER GATE)

| Item | Status | Assigned | Runbook | Notes |
|------|--------|----------|---------|-------|
| #681: W1 wire live numbers | OPEN | Claude | — | Finance dashboard reads live `get_club_finance_summary` |
| #677: Label fix | OPEN | Claude | — | "Còn lại sau lương" (not "Lãi ròng") |
| **ACTION:** Merge #681 + #677 | ⏳ OWNER | Owner | — | **BLOCKS:** live P&L not yet wired to UI |
| Owner UAT | ⏳ BLOCKED | Owner | — | **UNBLOCK:** Merge → flip accountingControlLiveOverview ON → check numbers |

**Why P2:** Money dashboard. Foundation live, UI wiring pending.

---

## 🟡 P2: Midnight Sakura UI (DESIGN GATE)

| Item | Status | Assigned | Runbook | Notes |
|------|--------|----------|---------|-------|
| #665: Codex foundation | OPEN | Codex | — | sumi black + dark plum + aged gold brand |
| **ACTION:** Claude design review | ⏳ BLOCKED | Claude | — | **BLOCKS:** Codex can't code without approval |
| Approve brand? | ⏳ OWNER | Owner | — | **UNBLOCK:** Owner says "yes, build" or "no, try again" |

**Why P2:** Dark-premium rebrand. High confidence in direction, awaits validation.

---

## 🟢 Tracking: Tracker UX Fixes (OPEN PR #674)

| Item | Status | Assigned | Runbook | Notes |
|------|--------|----------|---------|-------|
| #674: Cover-call + chip stacks + bet amounts | OPEN | Claude | — | Owner UAT on TEST tournament (5 all-in scenario) |

**Why:** Viewer felt rough, fixable in one shot.

---

## Legend

- **✅ DONE** — code in place, live if applicable
- **⏳ READY** — awaiting owner gate / next step
- **⏳ BLOCKED** — waiting for something else (noted in column)
- **🟢 LIVE** — actively running in production
- **🔴 P0, 🟠 P1, 🟡 P2, 🟢 Tracking** — priority bucket

---

## Owner Decision Queue (Next Sprint)

1. **Close Report:** Merge #685 → UAT → done (1 sprint)
2. **Repair Wave:** Trigger workflow → monitor green ✓ (⏱️ 15 min)
3. **Series Intel:** Live UAT + Kelly decision (1 sprint)
4. **Accounting UI:** Merge #681/#677 → UAT (1 sprint)
5. **Midnight Sakura:** Design approval → Codex build (2 sprints)

**Total:** 2 major owner gates this sprint (Close Report, Repair Wave), 3 next sprint.

---

**Primary operator:** Grok (from 2026-07-09) — auto-update end-of-session via [[GROK_LATEST]]  
**Owner review:** Sprint planning + on-demand  
**Stale if:** >3 days old + no merges or deployment
