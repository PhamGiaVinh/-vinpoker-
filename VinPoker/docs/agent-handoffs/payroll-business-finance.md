# Agent Handoff: Payroll / Business Finance

**Session Module:** Payroll / Business Finance
**Branch:** agent/tracker-improve (work executed here; module branch: agent/payroll-business-finance)
**Created:** 2026-06-12
**Mode:** SOLO FABLE. Frontend-only changes shipped; everything DB/RPC-side in this document is **proposal only**.

## Scope

Payroll code review, business-owner financial visibility, money-flow design, safe Phase-0 UI improvements.

## Files This Session Owns

- `src/components/cashier/DealerPayrollTab.tsx` (UI additions only — no formula/save-flow change)
- `src/lib/payrollAnomalies.ts` (new, pure helpers)
- `src/lib/payrollFinanceSummary.ts` (new, pure helpers)
- `docs/agent-handoffs/payroll-business-finance.md` (this document)

## Files This Session Must NOT Touch

- Supabase migrations, RPC functions, Edge Functions
- Dealer Swing, Cashier settlement, Staking settlement, Seat Assignment, Bankroll
- `useDealerPayroll.ts` save/transition helpers (read-only consumption only)
- Game Engine, Godot client

## Shared Contracts Needed

- **Provides:** `buildPayrollFinanceSummary()` + anomaly helpers — reusable by a future Owner Finance Dashboard page.
- **Needs later:** `profiles.full_name` mapping for actor UUIDs; `v_payroll_owner_summary` view (Phase 3); `payment_records` table (Phase 2).

## Current Status

- [x] Analysis
- [x] Implementation (Phase 0, frontend-only)
- [x] Verification (`vite build` ✓, `tsc --noEmit` ✓)
- [x] Handoff document complete

---

## 1. Current Payroll Behavior

**Flow (active path):**

```
dealer check-in/out → dealer_attendance (the ONLY payroll input)
        ↓
DealerPayrollTab (CashierDashboard, section "payroll")
        ↓ fetchPayroll
RPC calculate_club_payroll(club, start, end)
        ├─ period saved   → read dealer_payroll snapshot (status != 'excluded'),
        │                   re-sum payroll_adjustments live (NOT recombined into net)
        └─ period unsaved → per-dealer calculate_dealer_payroll (attendance only)
        ↓
UI table + totals → handleSave → RPC save_payroll_period(p_payroll_rows = client rows)
        ↓
transition_payroll_status: draft → submitted → approved → locked (+ rejected → draft)
```

**Key facts:**
- Payroll reads `dealer_attendance` only — `dealer_assignments`, `dealer_breaks`, `dealer_meal_breaks`, swing data have **zero** effect on pay.
- FT: base = full `monthly_salary_vnd` (no proration) + per-shift OT (>8h × rate × 1.5). PT: hours × rate (50k/h floor).
- 24h/shift cap; open shifts accrue to `now()`.
- `save_payroll_period` persists the exact client-sent rows; server does not recompute.
- Status lifecycle: `draft / submitted / approved / locked / rejected`. **No paid, no reconciled.**
- Files: `src/components/cashier/DealerPayrollTab.tsx`, `src/hooks/useDealerPayroll.ts`, `src/lib/exportPayrollPdf.ts`, `src/lib/exportExcel.ts`; migrations `20260717000000`, `20260609000001`, `20260801000000`, `20260716000000`, `20260724000000`.

## 2. Risks in Current Payroll Logic (classified)

| ID | Finding | Class |
|----|---------|-------|
| B1 | **Formula drift**: two conflicting `calculate_dealer_payroll` overloads committed (3-param: insurance/PIT informational only; 4-param: actually deducted). Live body unverified; a 3-arg call with both overloads present can fail "function is not unique". Net pay is **unknown** until live introspection. | **P0** |
| B7 | `save_payroll_period` trusts client-supplied gross/net/OT — tampered or buggy client writes arbitrary pay. | **P0** |
| B5 | Post-save adjustments are re-summed live but **never recombined into saved `net_pay_vnd`** — adjustments show in their column but are not in "Thực lãnh". Most dispute-prone issue. | **P0** (visibility shipped this session; data fix needs RPC) |
| B2 | Break time never deducted (paid-break policy unconfirmed). | P1 |
| B3 | No FT proration; UI badge displays prorated formula while value may be full salary. | P1 |
| B4 | Open shifts (`checked_in`) accrue hours to `now()` — non-deterministic payroll at month end. | P1 |
| B6 | `check_in_time::DATE` evaluated in DB session TZ — VN 00:00–06:59 shifts may land in the previous period if DB is UTC. | P1 |
| — | No paid/unpaid distinction, no payment recording, no reconciliation view, no owner cross-period dashboard, no variance analysis. | P1 |
| B8 | Insurance cap inconsistency between overloads (uncapped vs 46.8M cap). | P2 |
| B9 | 50,000đ/h floor silently overrides lower configured rates. | P2 |
| B10 | Orphaned `get_dealer_payroll` + `dealer_scores` view — wrong-wiring hazard. | P2 |
| B11 | Per-shift OT (two 5h shifts same day = no OT) vs per-day in orphaned fn — policy inconsistency. | P2 |
| NEW | Approval footer showed the **viewer's** id as "Gửi bởi" instead of `submitted_by` (fixed this session). | P1 (fixed) |
| NEW | TIPS adjustment renders with a "−" sign in the row badge (UI sign logic groups TIPS with penalties). Display-only; verify intended sign. | P2 (found this session, not changed) |
| — | Dealer Swing / rotation / seat-assignment bugs | Existing/unrelated — out of scope |

## 3. Owner Dashboard Design (target)

Sections, in priority order:
1. **Hôm nay** — payroll cost accrued today (live attendance), open shifts, dealers on floor.
2. **Tuần / Tháng này** — payroll cost to date, vs same period last month, FT/PT split.
3. **Payroll due** — current period total "Cần chuẩn bị chi trả".
4. **Payroll paid** — paid batches + payment refs (needs Phase 2).
5. **Payroll pending approval** — periods in submitted state, days waiting, who must act.
6. **Dealer cost ranking** — top-N by net, by OT, by adjustments.
7. **Adjustments** — bonus vs penalty vs advance totals, large/negative flags.
8. **Cashier inflow/outflow** — future integration.
9. **Tournament payout obligations** — future integration.
10. **Staking liabilities** — future integration.
11. **Warnings/anomalies** — operational risk strip (shipped in payroll tab this session).
12. **AI business recommendations** — Phase 4, rules first.

## 4. Money-Flow Map (business flow)

```
REVENUE IN                       OPERATIONAL OUT
─ Cash game rake                 ─ Dealer payroll (net + adjustments)
─ Tournament fee                 ─ Dealer adjustments (bonus/penalty/advance)
─ Rebuy/addon fee                ─ Tournament payout
─ Club income (membership, F&B)  ─ Staff payroll (non-dealer, future)
─ Staking/markup income (future) ─ Venue cost / marketing (future)
                                 ─ Bankroll movement
                                 ─ Cashier settlement

CONTROL POINTS (every money movement must answer):
  Who entered? Who approved? Who locked? Who paid? Who reconciled?
  Which source of cash (cash drawer / bank / bankroll account)?
  Which evidence attached (export, receipt, payment ref)?
```

Payroll is one outflow lane in this map; the owner dashboard (Phase 3) joins all lanes into club-level P&L.

## 5. Payroll Status Lifecycle

**Current:** `draft → submitted → approved → locked` (+ `submitted → rejected → draft`).

**Proposed full chain (Phase 2):**

```
draft → submitted → approved → locked → payment_prepared → paid → reconciled
```

- `locked` — numbers frozen.
- `payment_prepared` — payment batch/order created by accountant/owner.
- `paid` — money actually transferred/handed out.
- `reconciled` — matched against bank/cash/bankroll records.

Proposed fields on `payroll_periods` (or a child `payment_records` table):
`payment_batch_id, payment_method, payment_ref, paid_at, paid_by, reconciled_at, reconciled_by, reconciliation_note, source_cash_account_id`.

Do **not** add a bare `paid` boolean — without `reconciled` the owner cannot distinguish "we sent money" from "money confirmed received/balanced".

## 6. Suggested Database / Reporting Model (proposal only)

- **`payment_records`** — one row per payment batch: period_id, batch_id, method, ref, amount_vnd, paid_at/by, reconciled_at/by, source_cash_account_id, note. Append-only.
- **`v_payroll_owner_summary`** (read-only view) — per club per period: total gross/net/adjustments, status, counts, paid/unpaid amounts. Powers the owner dashboard with one query.
- **Actor display names** — UI currently shows UUID prefixes; map `submitted_by/approved_by/locked_by/paid_by` → `profiles.full_name` in the view so the owner sees names, not ids.
- **Variance source** — either a `v_payroll_period_compare` view (this vs previous period per dealer) or client-side fetch of two periods (cheap; RPC already parameterized by date).

## 7. Audit Trail Requirements

- Every state transition records actor + timestamp (exists for submit/approve/lock/reject; extend to payment_prepared/paid/reconciled).
- Every adjustment carries created_by + reason (exists); **approved_by should become mandatory for negative or ≥500k adjustments**.
- `payroll_audit_log` old/new values now rendered as field-level diffs in the UI (shipped this session).
- Payment records are append-only; corrections are new rows, never updates.
- Exports (Excel/PDF) should embed period status + generated-at timestamp so an archived file is self-identifying.

## 8. Reconciliation Workflow + Payment Readiness Checklist

**Reconciliation workflow (Phase 2):** after `paid`, accountant matches payment batch against bank statement / cash count / bankroll ledger → records `reconciled_at/by` + note → period reaches `reconciled`. Any mismatch opens a correction adjustment in the **next** period (never edits a locked one).

**Payment Readiness Checklist — before owner pays payroll:**
1. Payroll period is locked.
2. No open shifts.
3. No 24h-capped shifts unless manually approved.
4. No net/adjustment mismatch ("Chênh lệch điều chỉnh" = 0).
5. All negative adjustments have an audit reason.
6. All high-cost dealers reviewed.
7. Submitted/approved/locked actor metadata visible.
8. Export/PDF generated and archived.
9. Payment batch prepared.
10. Payment reference recorded (once DB support exists).

Items 1–7 are checkable today in the UI (decision strip + anomaly strip shipped this session).

## 9. Payroll Variance Analysis (proposal — needs cross-period data)

Future dashboard must show:
- Payroll cost this month vs last month (absolute + %).
- FT vs PT cost delta.
- Adjustment total delta (bonus vs penalty trend).
- Biggest dealer cost movers (who drove the increase).
- Abnormal club-level increases (multi-club owners).
- Ratios: payroll/revenue, payroll/rake, payroll/tournament-fee, payroll/active-tables, payroll/operating-hours.

Not implemented this session: component fetches one period only and the session rule was "no new queries".

## 10. Business Recommendations Engine (idea)

Phase 4, strictly rules-first:
- Rule pack over the same anomaly helpers + variance data: "OT của dealer X tăng 3 tuần liên tiếp — cân nhắc thêm ca", "Chi phí PT vượt FT lần đầu — review lịch", "Penalty tập trung vào 1 dealer — review quản lý ca".
- Each recommendation links to its evidence rows (explainable, auditable).
- Only after the rule pack is trusted: optional AI layer that *explains* rule output in natural language. AI must never produce numbers; it narrates rule results.

## 11. Integration Points

| Module | Integration |
|--------|-------------|
| **Cashier** | Payroll paid from cash drawer → payment_records.source_cash_account_id ties payroll outflow to cashier settlement; daily cash report subtracts prepared payroll batches. |
| **Bankroll** | If payroll is paid from club bankroll, payment batch creates a bankroll movement entry; reconciliation matches both ledgers. |
| **Staking** | Staking liabilities appear as a separate owner-dashboard lane; no payroll coupling beyond shared cash accounts. |
| **Tournament Payout** | Payout obligations are a parallel outflow lane; owner "cash required today" = payroll due + payouts due − expected inflows. |
| **Dealer Directory** | Source of rates/employment_type; rate changes should be audit-logged and surfaced in variance analysis ("cost moved because rate changed, not hours"). |

## 12. Owner Exports (proposal)

- Period summary export (one sheet: totals, status, actors, checklist state).
- Anomaly report export (the warning strip as a sheet).
- Approval log export (audit trail for the period).
- Payment batch template (dealer, amount, method, ref columns) — becomes the Phase 2 input.
- Quick win available later: extend the existing `exportExcel` call with a second summary sheet (anomaly counts + mismatch). Left proposal-only to keep this patch minimal.

## 13. Roadmap

- **Phase 0 — this patch (shipped):** frontend-only visibility: owner finance summary, decision strip, anomaly strip, real approval metadata, last-refreshed, cost ranking, audit-log diffs.
- **Phase 1 — payroll integrity:** verify live `calculate_dealer_payroll` (read-only introspection), resolve overload drift (one signature), recompute server-side on save (fix B7), recombine adjustments into net (fix B5).
- **Phase 2 — payment workflow:** `payment_records`, `payment_prepared/paid/reconciled` lifecycle, payment batch export, readiness checklist enforced server-side.
- **Phase 3 — owner finance dashboard:** revenue, payroll, payout, staking, cashier, bankroll → club-level P&L + variance.
- **Phase 4 — recommendation engine:** rule pack first, AI explanation layer later.

## 14. Safe Patch Order

1. **Verify live RPC** (read-only `pg_get_functiondef`) — nothing else proceeds while B1 is open.
2. **B5 fix** — recombine adjustments into net in saved path (one RPC change + golden-period diff).
3. **Lifecycle extension** — payment_prepared/paid/reconciled + payment_records (new migration; no old-migration edits).
4. **Server-side recompute on save** (B7) — client sends ids only; server snapshots its own numbers.
5. **Break deduction / FT proration / TZ pinning / OT policy** — only after written PO sign-off (policy decisions, not bugs).

Golden rule for every step: export the last real period as a baseline, re-run after the change on staging, diff per dealer, zero unexplained deltas before deploy. Locked periods are never recomputed.

---

## Findings

See §2 table (B1–B11 + two new UI findings, P0/P1/P2 classified).

## Code Changes

Phase 0, frontend-only (no payroll number, formula, RPC, migration, or payment state changed; all new figures labeled "Số liệu đối chiếu — không thay đổi số lương đã lưu"):

- `src/lib/payrollAnomalies.ts` (NEW) — pure anomaly helpers: `openShifts`, `cappedShifts`, `netAdjustmentMismatches`, `zeroHoursPaid`, `largeAdjustments`, `negativeAdjustments`, `highCostOutliers`.
- `src/lib/payrollFinanceSummary.ts` (NEW) — `buildPayrollFinanceSummary()`: totals, đối-chiếu payable, mismatch, anomaly counts, top-cost dealers, FT/PT split, status label, readiness level (`ready`/`review`/`blocked`).
- `src/components/cashier/DealerPayrollTab.tsx` (EDIT) —
  - Owner Finance Summary panel: "Cần chuẩn bị chi trả", status, FT/PT split, adjustments, "Chênh lệch điều chỉnh" (danger card when ≠ 0).
  - Owner Decision Strip "Trạng thái sẵn sàng chi trả": Sẵn sàng duyệt / Cần kiểm tra trước khi duyệt / Không nên chi trước khi đối chiếu + reasons.
  - Expandable anomaly strip with business wording (7 groups).
  - Approval footer now shows real `submitted/approved/locked by+at` (was: viewer's own id) + current viewer + last-refreshed.
  - "Chi phí cao nhất" cost-ranking toggle (sorts by net desc within FT/PT sections).
  - Audit-log dialog renders field-level old→new diffs for money/status fields.

## Verification Result

- `npx tsc --noEmit` — passed (no output).
- `npm run build` (vite build) — passed, built in 2m02s. Pre-existing chunk-size warnings only (unrelated).

## Handoff to Next Session

1. **Phase 1 first**: run the read-only live-RPC verification (`LIVE_PAYROLL_RPC_VERIFICATION` plan exists) — every other payroll fix is blocked on knowing which formula is live (B1).
2. Then B5 (recombine adjustments into net in saved path) as a single controlled production patch with golden-period diff.
3. The Owner Finance Dashboard page (Phase 3) can reuse `buildPayrollFinanceSummary` + anomaly helpers as-is; they are UI-agnostic pure functions.
