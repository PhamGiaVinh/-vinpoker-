---
name: vinpoker-business-quant
description: Business-quant analysis skill for VinPoker/VBacker — poker-club economics, management-accounting doctrine (Tài chính & Đối soát / Accounting Control), formula library, forecasting discipline, dashboard rules, and a GO/HOLD/NO-GO review workflow for finance-touching PRs and product plans. Analysis and decision support only; it never executes money-path changes. Use when the user asks about VinPoker business analytics, finance, forecasting, owner dashboards, tournament economics, GTD, overlays, player value, Series Intelligence, Close Report, daily close, or cash reconciliation.
---

# VinPoker Business Quant

## Purpose

Business-quant analysis, owner decision support, finance sanity checks, and product design
review for VinPoker/VBacker. This skill supplies doctrine, formulas, checklists, and review
workflow — **analysis only, never execution**. It is MANAGEMENT accounting (kế toán quản trị),
not legal/tax accounting: no VAT, no invoices, no statutory ledger claims. Naming doctrine:
owner-facing UI = **Tài chính & Đối soát**; docs/architecture = **Accounting Control**;
never "Legal Accounting" / "Tax Accounting" / plain "Kế toán". Currency is VND; the owner is
non-technical and Vietnamese-speaking.

## Core doctrine (10 points)

1. Forecast value is decision support, not exact prediction.
2. Separate true demand vs captured entries.
3. Separate retained revenue vs pass-through prize pool.
4. Separate cash movement vs accounting recognition.
5. Use simple/shrinkage models first.
6. Always include uncertainty.
7. Always compare to a naive baseline.
8. Always ask what decision this metric changes.
9. Optimize at series/ecosystem level, not isolated event vanity.
10. Treat CLV/ecosystem as guardrails, not fake-weighted magic terms.

## Formula quick-reference

```
True Revenue      = Fee/Rake retained by club
Pass-through      = Prize pool / player-funded pool          (player money, a liability — NOT revenue)
GTD Subsidy       = max(0, Guarantee - Player-funded prize pool)

Event Contribution =
    retained_fee_revenue
  + other_event_revenue
  - GTD_subsidy
  - dealer_wages - floor_wages - cashier_wages
  - marketing_cost
  - F&B_COGS_if_comped_or_subsidized
  - other_direct_costs

Event Margin % = Event Contribution / retained_fee_revenue
```

Guardrail: Event Contribution is a CONTRIBUTION margin — never label it "profit" (lợi nhuận)
when operating/overhead costs are not included. Full library with input definitions, VinPoker
data sources, and per-formula pitfalls: **formulas.md**.

## Review workflow (summary)

When reviewing a PR or product plan, output:

- **Verdict:** GO / HOLD / NO-GO
- **Findings by severity:** P0 (money wrong / data loss / irreversible) ·
  P1 (misleading numbers / missing guardrail) · P2 (polish / clarity)
- **Six check dimensions:** formula correctness · data source correctness (LIVE vs
  source-only vs dark-flag) · live/source-only risk · owner decision impact ·
  test/screenshot requirements · rollback plan

Full checklists per review type: **review-checklists.md**.

## Dashboard rules (one-liners)

1. Show retained revenue separately from buy-in/prize pool.
2. Show GTD subsidy explicitly.
3. Show direct costs explicitly.
4. Avoid vanity entries-only metrics.
5. Show uncertainty where values are forecasted.
6. Label provisional vs final values.
7. Never call contribution margin "profit" if operating costs are missing.

Owner UI is plain-language Vietnamese, guided, one-task-first; hide advanced/empty panels
until data exists. Details: **dashboard-patterns.md**.

## Forecasting rules (one-liners)

1. No multiplier soup.
2. No false precision.
3. No single-number forecast without an interval.
4. Walk-forward backtest.
5. Compare to a naive baseline.
6. Report calibration (P5–P95 coverage ≈ 90%).
7. Show assumptions.
8. Flag insufficient history as "hypothesis / chưa backtest đủ".

Details: **forecasting-principles.md**.

## Companion files

| File | Open when |
|---|---|
| `formulas.md` | You need the full formula library: exact inputs, where each input comes from in VinPoker (defensively, given schema drift), per-formula pitfalls, and the decision-journal scoring method. |
| `review-checklists.md` | You are reviewing a PR, migration, dashboard, or product plan that touches money, finance display, or forecasting — run the GO/HOLD/NO-GO workflow. |
| `dashboard-patterns.md` | You are designing/critiquing an owner dashboard, P&L view, Daily Close, or any finance display. |
| `forecasting-principles.md` | You are building/reviewing entry forecasts, GTD/overlay risk models, or Series Intelligence quant work. |
| `examples.md` | You want worked examples (event P&L, overlay break-even, forecast calibration) to pattern-match against. |

## Hard boundaries

- No DB writes. No Edge deploys. No migration applies. No service_role usage.
- No approving financial transactions. No automatic merge.
- No gambling strategy advice to players.
- No presenting forecasts as certainty.
- No optimizing short-term extraction at the expense of player ecosystem health.
- Always distinguish revenue, pass-through money, subsidy, cost, cash, and accounting recognition.
- Any recommendation that changes a money path requires explicit owner approval.
