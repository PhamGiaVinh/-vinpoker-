# Accounting Control — Real-Data Wiring Plan

Turning the mock cockpit (PR #672, LIVE, `accountingControl` ON) into real read-only data,
one owner-gated increment at a time. This is the "phase sau" the shell was built for.

## Doctrine for every increment (non-negotiable)

- **Read-only.** No writes, no new money-path. Reads only.
- **Additive + own flag.** Each tab wires behind its OWN flag (e.g. `accountingControlLiveOverview`),
  default OFF; while OFF the tab renders today's mock. Never a big-bang swap.
- **merge ≠ apply.** #656 R1/R2/R3 are MERGED, not necessarily APPLIED LIVE. A wiring increment
  that depends on a migration only lights up after that migration is applied live — **verify via
  `VBacker/01-MODULE-STATUS/MODULE_STATUS.md` + a live query, never assume from merge.**
- **Gaps stay warnings, not zeros.** A missing/dark line (PT wage, F&B) keeps its amber warning
  from the mock — never render an earned 0. Keep the 4 state badges; a live-but-unclosed number
  is **Tạm tính**, not Đã chốt.
- **Golden-diff discipline** (from FNB): any change touching the finance summary must first prove
  a zero diff vs current behavior with the new read OFF, before the flag flips.

## Live sources confirmed (read-only, already on prod)

| Source | Grain | Returns | Status |
|---|---|---|---|
| `get_club_finance_summary` (`useClubFinanceSummary`) | **Club** × date range | retained revenue (rake online/offline/reentry + service fee + staking fees + payout fees), payroll cost (SAVED), net, per-club, per-period, unpaid/reconciled totals | LIVE (#110) |
| `get_tournament_prize_pool` (`useGtdTruePrizePool`) | **Tournament** | SUM confirmed buy-in = true prize pool | LIVE (flag `gtdTruePrizePool` ON) |
| `get_tournament_prizes` | **Tournament** | payout structure (rank → amount) | LIVE |
| `close_tournament` (`useCloseReport`) | **Tournament** | close/finalize | Draft #669, flag OFF, migration pending |

## Increments (priority order)

### W1 — Tổng quan real numbers ← `get_club_finance_summary` ⭐ do first, lowest risk
- Binds NOW (read-only, RPC already live): **Doanh thu giữ lại** ← `revenue.total`;
  **Chi phí trực tiếp** ← `cost.payrollNet` (SAVED dealer wages, never recompute);
  **Còn lại sau lương** ← `net` (labeled as contribution-after-wages, NOT "lãi ròng" — see the
  ClubFinanceDashboard doctrine fix). Reuse `useClubFinanceSummary({from,to,clubFilter})`.
- Stays a WARNING (not a number) until its dependency applies live:
  - **Lương PT** — missing from the summary until **#656 R2** (`20261211000000`) applied live.
  - **F&B** — 0/dark until `fnb_in_club_net` flipped per club (keep "chưa nối").
- NOT in this RPC (needs W3/W6 sources): the pass-through/liability side (prize pool, payout owed,
  escrow). Until wired, keep those cards on mock OR hide with "chưa nối".
- Flag `accountingControlLiveOverview`. Golden-diff: overview mock vs live for a known club/date.

### W3 — Payout liability ← `get_tournament_prize_pool` + `get_tournament_prizes`
- Prize pool (pass-through liability) ← `get_tournament_prize_pool` (confirmed buy-ins).
- Owed vs paid ← `get_tournament_prizes` (structure) minus recorded payments. Payout ENGINE
  authority is still gated (payout Edge v1.1 = **#656 R1**, deploy pending) → until deployed,
  label liability **Tạm tính**, "xác minh thủ công", exactly as the mock warns.

### W2 — Event P&L per-tournament ← ⚠️ needs a source that does not exist yet
- Event P&L is PER-TOURNAMENT; `get_club_finance_summary` is CLUB-level and does NOT break rake
  down per tournament. Real per-event contribution needs: per-tournament retained fee (rake for
  that tour), player-funded pool (`get_tournament_prize_pool` ✓), GTD (`tournaments.guarantee_amount`
  ✓), per-event wages (not currently attributable per event).
- → **Owner-gated backend needed:** a read-only `get_tournament_finance_summary(tournament_id)`
  RPC (rake + pool + subsidy + attributable direct costs). Until then Event P&L stays mock, or
  shows only pool + GTD + break-even (the parts derivable from live per-tournament reads) and
  labels the rest "chưa nối". Do NOT fake per-event wages.

### W4 — Lương & chi phí ← saved payroll + PT ledger
- Dealer/floor/cashier ← saved payroll (`get_club_finance_summary.cost` / payroll period reads),
  never recomputed. **PT wage line blocked on #656 R2 applied live** → keep the amber range warning.

### W5 — Tiền & Bank ← SePay reconcile worklist (read-only)
- `sepay_cashier_settlement_worklist` RPC (behind existing flag `sepayReconcile`, currently OFF /
  RPC apply pending). Bank-vs-app variance rows bind here. Keep the one-active-escrow hazard note.

### W6 — Staking escrow ← staking ledger
- Escrow in/released/refunded/balance ← staking tables. **Blocked on #656 R3 applied live**
  (refund states); until then show balances labeled provisional, keep the funds-trapped warning.

### W7 — F&B Finance ← `fnb_get_report(from,to,club)` (read-only, already used by SI F&B card)
- Blocked on per-club `fnb_in_club_net` + `fnbFinance` flag; golden-diff proven zero first.
  Until then the NotWiredState stays (never an earned 0).

### SPEC tabs — Chốt sổ + Báo cáo tháng
- Stay SPEC even after W1–W7. Chốt sổ needs **Daily Close** (not built) / **Close Report #669**
  (built source-only, flag OFF, migration owner-gated). Báo cáo tháng aggregates finalized closes
  → depends on those. Build order: Close Report #669 apply → Daily Close → then these tabs wire.

## Dependency on Repair Wave #656 (apply, not merge)

| Blocked increment | Needs #656 leg APPLIED LIVE |
|---|---|
| W1 PT-wage line, W4 PT | R2 (`20261211000000`) |
| W3 payout authority | R1 (payout Edge v1.1 deploy) |
| W6 staking refund states | R3 (enum+schema migs + 3 Edge fns) |

→ **The single highest-leverage owner action to unblock real data is gating the #656 live-apply
run** (GitHub Actions, 3 legs). W1 (Tổng quan) + W5 (bank) + W7 (F&B, after its own flag) do NOT
depend on #656 and can wire first.

## Recommended sequence

1. **W1 Tổng quan** (no #656 dependency; RPC live) — smallest, proves the wiring pattern + golden-diff.
2. Owner gates **#656 live-apply** → unblocks W3/W4/W6.
3. **W3 Payout liability** + **W4 Lương** (real cost).
4. **W2 Event P&L** only after a per-tournament finance read RPC is approved (owner-gated backend).
5. **W5/W7** independently as their flags/backends land.
6. SPEC tabs last, after Close Report #669 + Daily Close exist.
