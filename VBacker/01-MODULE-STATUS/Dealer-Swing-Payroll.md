---
title: Dealer Swing & Payroll
updated: 2026-07-02
status: LIVE (hardening roadmap active)
---

# Dealer Swing & Payroll System

## Live Status
- **Forward Rotation Scheduler A–K** LIVE
- **Swing config** immutable, backlog worked-minutes credit
- **Empty-table autofill** #288 + ghost fix #135/#138 LIVE (Edge-deployed DEFAULT ON)
- **Telegram check-in/out** LIVE (#122/#128)
- **UI redesign V3** #198/#199 LIVE, #200 OPEN
- **Mobile app** Inc1/5/8+nav MERGED flag OFF
- **Shift Planner V2.1** P1+2A+2B+2C+broadcast LIVE flag TRUE

## Payroll (Live Test DB)
- **B1–B7** + break-policy LIVE
- **P3** #90 LIVE
- **P&L** live, P4b insurance Phase-1 tables LIVE #236
- **Owner UAT** club 11 fixture pending

## Hardening Roadmap (CTO Scorecard)
- 13-step owner-gated contract
- Stage0 #339 + A0 #340 draft
- Priority: `priority_break=HARD`, lease heartbeat + fencing

## Risks
- Orphan-assignment freeze (released_at NULL → club freeze)
- 4 teardown sites miss release (SPEC DRAFT #297)
- Wrong-table reconcile one-sided+swap LIVE, multi-table wizard #66 OPEN

## Next
1. Close Tour "Đóng tour" atomic (flag TRUE) ✓
2. Orphan-assignment fix #297 (owner-gated)
3. Multi-table wizard #66 (owner-gated)
4. Mobile app Phase 2 (owner gate)

## Financial Recognition
- Wage cost recognition (dealer/floor/PT) and mapping into event/day P&L live in
  [[PAYROLL_AND_WAGES]] (09-ACCOUNTING-CONTROL).

---
Link: [[MODULE_STATUS]], [[IMMEDIATE_CONTAINMENT_REGISTER]], [[PAYROLL_AND_WAGES]]
