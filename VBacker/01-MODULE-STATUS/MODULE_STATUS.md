---
title: Module Status Matrix
updated: 2026-07-02
status: canonical
---

# VinPoker Live/Source Truth Rules

**Core Doctrine:** Merged PR ≠ live DB ≠ Vercel FE live ≠ Edge deployed ≠ Feature flag active

## Truth Layers

| Layer | Source | Verification |
|-------|--------|--------------|
| **Code** | Main branch merge | `git log`, tsc, build |
| **Frontend** | Vercel deploy | Live screen, network inspect |
| **Database** | Live orlesggcjamwuknxwcpk | Query live objects directly |
| **Edge** | Deploy timestamp | Edge function logs |
| **Feature Flag** | Supabase flags table | Code reads flag + UI behavior |
| **Migration** | SQL files + applied log | Never trust ledger alone—verify applied state |

## Current Priority Status

### 🔴 P0: Repair Wave (PR #656) — ✅ MERGED (2026-07-03)
- **R1 Payout Edge** — stale redeploy v1→v1.1 ✅ code merged, Edge deploy pending owner gate
- **R2 Finance PT Wage** — restore from live dump ✅ code merged, mig apply pending owner gate
- **R3 Staking Money Path** — refund hardening, nil schema fix ✅ code merged, mig+Edge deploy pending owner gate
- **Live-apply workflow:** GitHub Actions dispatch (3 legs: payout-edge → finance-pt-wage → staking-edge, owner-gated each)

### ✅ P1: Series Quant Stack (PR #645–#651) — DONE (2026-07-02)
- 7 PRs ✅ ALL MERGED in order + #654 flags-on + #660 UI + #664 KPI merged
- 3 flags `series*` ON (Kelly OFF), 294 tests, Playwright-verified live
- Remaining: owner production visual UAT · Kelly/regime-switch deferred

### 🟡 P2: Midnight Sakura UI — PR #665 OPEN
- Codex foundation `codex/midnight-sakura-ui-foundation` (needs Claude design review)
- Sumi black + dark plum + aged gold brand
- Reject generic SaaS blue/neon/purple

### 🔵 WEDGE (strategic): Close Report — SPEC NEEDED
- Census flagged as "the missing wedge piece" (tournament finalize/settle)
- Blocked on owner scope decisions → see [[CLOSE_REPORT_WEDGE]]
- Soft-blocked on #656 R1/R2 live-apply (payouts + P&L display)

### Other open PRs
- #289 hide /poker (online-poker rework) · #73 CSS 3D poker table prototype

### 🟢 Live Status Check
- [[FNB]] P0–P7 APPLIED LIVE 2026-06-28 (dark, fnb_in_club_net OFF)
- [[Staking-VBacker]] broken paths awaiting #656 R3
- [[Payout]] engine stale, #656 R1 pending
- [[Finance]] P&L live, PT wage missing (#656 R2)
- [[Tracker-Viewer]] LIVE, Phase 2 not started
- [[Series-Intelligence]] 4-table capture LIVE, autosync on

## Financial Truth Layer

Money movement, retained revenue, pass-through funds, costs, liabilities, and reconciliation
are governed centrally in `09-ACCOUNTING-CONTROL/` → [[ACCOUNTING_CONTROL_HOME]].
Modules emit events; Accounting Control aggregates and finalizes the numbers.

**Accounting Control is the financial truth layer. Series Intelligence consumes finalized
Accounting Control outputs for calibration and decision support. Series Intelligence must
not be treated as accounting truth.**

## Verification Workflow

1. **Never trust migration ledger alone** — verify object state in live DB
2. **Distinguish layers:** What's merged ≠ what's deployed ≠ what's active
3. **Feature flag read check** — grep code for flag usage
4. **Screenshot proof** — feature must be observable in live UI

---
Links: [[FNB]], [[Staking-VBacker]], [[Payout]], [[Finance]], [[Dealer-Swing-Payroll]], [[Series-Intelligence]], [[Tracker-Viewer]], [[ACCOUNTING_CONTROL_HOME]]
