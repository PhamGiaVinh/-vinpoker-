# Accounting Control — Visual Verification Evidence (2026-07-03)

Live-render evidence for PR #672, captured from a local `vite preview` of the production build
(with a **local, uncommitted** gate-bypass so the flag-OFF page renders without a login session;
bypass reverted before commit — `git diff` proved `accountingControl: false` + gates intact).

> **Why no PNG screenshots:** the rasterized screenshot tool timed out (30s) every attempt —
> the full VinPoker app holds an open Supabase realtime websocket, so the renderer never reaches
> the idle frame the capture waits for. This is a tooling limit on this machine, not the page.
> Instead, render/layout/content were verified directly from the live DOM (accessibility tree +
> computed layout), which actually proves the things the owner asked about (money definitions,
> doctrine strings, state badges, mobile tab-scroll, card density) more precisely than a PNG.
>
> **Earlier misdiagnosis corrected:** the first "screenshots blocked" report blamed the 8s
> boot-watchdog / RAM. The true cause was the fresh worktree missing `.env`
> (`VITE_SUPABASE_URL`), so the Supabase client threw `"supabaseUrl is required."` at module
> init and the whole app failed to mount (root `/` blank too). Copying the gitignored `.env`
> into the worktree fixed it; the app then boots and every tab renders.

## Bug found & fixed via this visual review

**Entries forecast was formatted as currency.** On Tổng quan, "Dự báo entries giải tới" rendered
**`70 ₫ – 105 ₫ (thường gặp ~85 ₫)`** — entry *counts* shown with the đồng sign (would read as
"70 đồng"). Fixed: `MoneyCard` gained a `unit` prop (`"vnd"` default | `"count"`); the entries
card passes `unit="count"` → now **`70 – 105 (thường gặp ~85)`**, no ₫. PT-wage range (real money)
still shows ₫ correctly. Locked by a new regression test.

## Per-tab live-DOM verification (desktop 1280 + mobile 390)

| Tab | Verified live |
|---|---|
| **Tổng quan** | h1 "Tài chính & Đối soát" + "MOCK · UAT"; MockNotice banner; verbatim explainer "Doanh thu giữ lại ≠ tổng buy-in…"; two separate blocks — "Tiền của club" (Doanh thu giữ lại 60.200.000 ₫ · Chi phí 26.900.000 ₫ · Bù đắp GTD 60.000.000 ₫ · **Biên đóng góp (chưa trừ chi phí vận hành chung)** −26.700.000 ₫) vs gold "Tiền giữ hộ" (pool 531.800.000 ₫ · phải trả 28.500.000 ₫ · escrow 20.000.000 ₫ · tổng 48.500.000 ₫); forecast **70 – 105 (thường gặp ~85)** count, no ₫ |
| **Event P&L** | heading "…Biên đóng góp theo giải"; **dual break-even** "Hòa vốn GTD (đủ phủ đảm bảo): 100 entries" + "Hòa vốn đóng góp (gồm chi phí trực tiếp): 104 entries — đạt 88"; missing PT line = "chưa có số" (never 0 ₫); Prize pool in gold LiabilityCard 440.000.000 ₫ |
| **F&B Finance** | NotWiredState "Chưa nối dữ liệu tài chính F&B vào Accounting Control"; no earned `0 ₫`; golden-diff line present |
| **Lương & chi phí** | PT wage range keeps ₫ (real money) "8.000.000 ₫ – 12.000.000 ₫ (thường gặp ~10.000.000 ₫)"; hard-rule "lương đã lưu KHÔNG BAO GIỜ tính lại"; table-hour cost present |
| **Cảnh báo lệch số** | heading present; "7 mục — 5 chưa giải thích xong"; P0 severity; "Cảnh báo mẫu" chips; staking-refund warning; 7 "Xem tab →" items |
| **Series / Chốt sổ / Báo cáo tháng / Tiền & Bank / Phải trả / Staking** | render (11 tabs total, all mount); bridge/spec/doctrine strings covered by the 27-test suite |

## Responsive (measured at 390×844)

- Tab strip **scrolls horizontally**: scrollWidth 1055 > clientWidth 382 → 11 tabs never squash.
- Tổng quan two-block grid **collapses to one column** (computed `grid-template-columns: 358px`).
- **No body horizontal scroll** (`document.body.scrollWidth ≤ viewport`).

## Environment / correctness

- 11 `[role=tab]` present; active-tab switching works (Radix keeps panels mounted, hidden).
- Zero console errors after mount; no failed network requests.
- vitest **27/27**; `vite build` OK; `tsc -b` 75 = baseline, 0 new; grep guards clean.

## How the owner can view it live

Flag stays OFF. As **super_admin**: open the PR #672 Vercel preview (or run local preview) →
**Quản lý CLB** → click the **"Tài chính & Đối soát"** card. No code change or flag flip needed.
