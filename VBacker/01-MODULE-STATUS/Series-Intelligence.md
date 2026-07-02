---
title: Series Intelligence Module
updated: 2026-07-03
status: LIVE autosync + quant stack merged (3 flags ON)
---

# Series Intelligence Capture & Analytics

## Status Summary
- **4-table capture** LIVE + RLS-hardened + flag TRUE
- **Autosync** APPLIED LIVE all 4 clubs (server tự ghi) + cron `*/10`
- **Console** #621/#625 full UI MERGED
- **Readiness** private remote `PhamGiaVinh/vinpoker-club-intel` PR2–PR5 MERGED
- **Quant stack** #645–#651 ✅ ALL MERGED (2026-07-02) + #654 flags-on + #660 UI redesign + #664 KPI ✅ MERGED
- **Live:** 3 flags ON (`seriesTurnoutForecast`·`seriesRegimeNotice`·`seriesMarginByType`); `seriesKellyHint` OFF; Playwright-verified live

## Data Flow
- Live session table capture → `series_*` tables
- Autosync cron `*/10` writes server-generated summaries
- Readiness metrics: GTO gap, bankroll req, field EV
- Analytics dashboard read-only for operators

## PR Stack #645–#651 ✅ MERGED (live 2026-07-02)
- Money-truth relabels · ExplainHint adapter · Forecast port (ridge+CV, gating) · Regime caveat · Biên đóng góp theo loại giải
- Follow-ups: #660 UI redesign (dark mockup) · #664 quarterly KPI + avg profit/event — both MERGED
- **3 flags ON** (`seriesTurnoutForecast`·`seriesRegimeNotice`·`seriesMarginByType`); `seriesKellyHint` OFF
- Kelly + regime-switch DEFERRED (flag exists, needs owner decision + DB/audit)
- vitest 294/294; Playwright-verified live at `/club/admin/series-intelligence`

## Live Verification
- Query `series_summary` view in SQL Editor
- Check cron logs for `*/10` ticks
- UI visible at `/club/analytics/series`

## Risks
- Autosync dependency on cron uptime
- Quant stack must merge in PR order
- Kelly deferred = simple forecast only

## Next
1. ✅ Merged + flags flipped + verified live
2. Owner visual UAT on production (Vercel) — confirm 3 panels render at correct club
3. Deferred: Kelly hint (`seriesKellyHint`), regime switch (needs DB+audit), G7 calibration view (≥10 decision–outcome pairs)

---
Link: [[MODULE_STATUS]], [[PR-645-651-Series-Quant]]
