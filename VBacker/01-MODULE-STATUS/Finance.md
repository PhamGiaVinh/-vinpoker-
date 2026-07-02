---
title: Finance & P&L Module
updated: 2026-07-02
status: LIVE (PT wage missing)
---

# Finance Module

## Status Summary
- **P&L read-only** LIVE (`/club/admin/finance`)
- **RPC** `get_club_finance_summary` #110 APPLIED
- **Rake accuracy** #222 + mig 20260905000000 APPLIED
- **Issue** PT wage line missing from live dump (PR #656 R2 repair)
- **Payroll** B1–B7 + break-policy live (test DB)
- **Payroll P3** #90 LIVE

## Schema
- `club_finance_summary`: gross revenue, rake, cogs, ptw, fnb, etc.
- `blind_session_rakes`: per-session audit log
- Live DB: orlesggcjamwuknxwcpk (staging fixture, rake=0 until real tours)

## Live Truth Verification
- Read `club_finance_summary` view directly in SQL Editor
- Cross-check rake against `blind_sessions` logs
- F&B lines dark-hidden until fnb_in_club_net flag flips

## PR #656 R2: PT Wage Restore (2026-07-03)
✅ **Merged to main** — code live, migration apply pending owner gate
- Restored 6 [PT] insertion points from live dump
- Mig 20261211000000 ready for owner-gated apply
- Once applied, `get_club_finance_summary` will re-read PT wage cost

## Owner UAT Pending
- Club 11111111 fixture financial round UAT owed

## Financial Truth Layer
- P&L definitions, recognition rules, and reconciliation live in [[ACCOUNTING_CONTROL_HOME]]
  (09-ACCOUNTING-CONTROL); this module is the read-only UI over that truth.

---
Link: [[MODULE_STATUS]], [[IMMEDIATE_CONTAINMENT_REGISTER]], [[ACCOUNTING_CONTROL_HOME]]
