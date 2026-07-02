---
title: F&B Module Status
updated: 2026-07-02
status: APPLIED LIVE
---

# F&B Module (P0–P7 Live)

## Status Summary
- **P0–P7 Backend** APPLIED LIVE 2026-06-28
- **Code** pushed to `origin/agent/fnb-module` (NOT merged to main)
- **Flags** ALL OFF: `fnbModule`, `fnb_in_club_net` OFF
- **Finance** P&L dark mode (fnb=0, fnbcogs=0 shown)
- **Data** Verified golden-diff match with live dump (Hanoi Royal Poker: identical=true)

## Schema & RPC
- 11 tables: `fnb_items`, `fnb_sales`, `fnb_inventory`, `fnb_cogs`, etc.
- 16 functions: `create_fnb_sales`, `update_fnb_inventory`, `finalize_fnb_cogs`
- 2 realtime subscriptions
- Cron `*/5` for cost recalc

## Next Steps
- **P8b/c/d** UI + types regen + staff grants per UAT
- **Flip flags** after owner visual approval
- **Live rollout** phase TBD

## Risks
- Dark mode hides fnb lines → owner may not see until flip
- Cron dependency on Supabase uptime
- Staff permissions not yet granted

## Financial Recognition
- Revenue/COGS/refund recognition rules for F&B live in [[FNB_FINANCE_RECOGNITION]]
  (09-ACCOUNTING-CONTROL).

---
Link: [[MODULE_STATUS]], [[FNB_FINANCE_RECOGNITION]]
