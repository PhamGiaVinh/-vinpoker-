---
title: Accounting Glossary (EN/VI)
updated: 2026-07-03
status: canonical
---

# Accounting Glossary (EN/VI)

Bilingual glossary for all Accounting Control (Tài chính & Đối soát) notes and owner-facing
UI. One term = one meaning; use these exact Vietnamese terms in owner-facing screens.
All terms are management accounting (kế toán quản trị) for owner decision support — NOT
statutory/tax accounting (no VAT, invoices, or statutory ledger); VinPoker does not replace
statutory accounting software.

## Revenue & money classification
- **True / Retained Revenue (Doanh thu thực giữ lại)** — the fee/rake portion the club keeps;
  the only money that counts as club revenue.
- **Pass-through (Tiền chuyển hộ)** — player/backer money that moves through the club
  (prize pool, staking escrow) and is never club revenue.
- **Rake (Phí bàn)** — the per-table/per-session fee the club collects from play; part of
  retained revenue.
- **Buy-in (Tiền mua vé)** — the amount a player pays to enter a tournament, split into a
  retained fee portion and a pass-through prize-pool portion.

## Guarantees & event economics
- **GTD / Guarantee (Đảm bảo)** — the minimum prize pool the club promises regardless of how
  many players enter.
- **GTD Subsidy (Bù đảm bảo)** — club money injected when players don't fund the guarantee:
  `max(0, Guarantee − player-funded prize pool)`; a real cost.
- **Overlay** — the shortfall situation where the guarantee exceeds the player-funded pool,
  forcing the club to subsidize the difference.
- **Event Contribution (Biên đóng góp sự kiện)** — retained fee revenue plus other event
  revenue minus GTD subsidy, wages, marketing, and other direct costs of the event.
- **Contribution ≠ Profit warning (Biên đóng góp ≠ Lợi nhuận)** — contribution margin excludes
  operating/overhead costs, so it must never be labeled "profit" (lợi nhuận).

## Liabilities & held money
- **Liability (Nợ phải trả)** — money the club holds but owes to someone else, such as the
  unpaid prize pool or staking escrow balances.
- **Escrow (Tiền ký quỹ)** — funds held on behalf of players/backers (staking, payment
  routing) until settlement; always pass-through, never revenue.

## Control & reconciliation
- **Reconciliation (Đối soát)** — matching recorded transactions against bank inflows (SePay)
  and cash drawer counts to prove the books agree with reality.
- **Variance (Chênh lệch)** — the difference found during reconciliation between what was
  recorded and what was counted/received; every variance needs an explanation.
- **Provisional vs Final (Tạm tính / Đã chốt)** — numbers are provisional (tạm tính) until a
  close event finalizes (chốt) them; reports must label which one they show.
- **Daily Close (Chốt sổ cuối ngày)** — the end-of-day control event that finalizes the day's revenue,
  costs, liabilities, and cash position.
- **Cash movement vs Recognition (Dòng tiền / Ghi nhận)** — money moving in bank/drawer
  (dòng tiền) is separate from when revenue/cost is recognized in the books (ghi nhận).

## Costs
- **COGS (Giá vốn)** — cost of goods sold, e.g. the inventory cost of F&B items sold or
  comped; recognized as a cost when the item is consumed.

---
Link: [[ACCOUNTING_CONTROL_HOME]], [[MONEY_FLOW_MAP]], [[EVENT_PNL]], [[DAILY_CLOSE]]
