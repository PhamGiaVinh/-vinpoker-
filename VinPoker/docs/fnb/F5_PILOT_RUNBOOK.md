# F5 Counter — Supervised Pilot Runbook

> **STATUS: PREPARED — DO NOT EXECUTE.** Nothing in this runbook runs until the owner explicitly says
> "start pilot." No flag is flipped, no order is written, no deploy, no SQL until then. The **owner
> executes** each step (it is their first real F&B order); Claude assists + verifies.
>
> **Precondition already met:** F5 UI UAT passed (counter + 8 admin tabs render, nav-gating correct,
> `…0008` staff list live); backend `…0008 / …0010 / …0011` LIVE + verified; HTTP PostgREST probe PASS;
> all `fnb*` flags currently **false** (dark).

## Scope (locked)
One club · one owner/cashier account · **one small order first** · `fnbCounter` = kill-switch ·
Kitchen **OFF** · `fnb_in_club_net` **OFF** (unless owner explicitly approves a read-only finance check) ·
**no broad production enable.**

## Environment — RECOMMENDED: local preview (minimal exposure, no deploy, no global enable)
- Local dev server (worktree `D:/wt/fnb-module/VinPoker`, port 8092), flags flipped **LOCAL-only
  (uncommitted)**, owner signed into their own Chrome as the **pilot-club owner**.
- Orders hit the **LIVE production DB** (a real order on the real pilot club) — but there is **NO
  production deploy and NO global flag flip**. Exactly what the F5 UAT used.
- **KILL-SWITCH:** revert the local flag (`fnbCounter → false`) **or** stop the dev server → the
  counter is instantly gone. No production change to undo.
- *(Later graduation, AFTER this pilot passes: flipping `fnbCounter` on `main` = a production deploy +
  a global flag. That is **not** this first pilot.)*

---

## 0) Preflight — read-only; confirm every ✓ before enabling
- [ ] **`…0008/…0010/…0011` live** — already verified (structural + functional + golden-diff). Re-confirm only if doubt:
  `select proname from pg_proc where proname in ('fnb_list_club_members','fnb_upsert_menu_item','fnb_mark_paid','fnb_cancel_order','get_club_finance_summary','fnb_get_report');`
- [ ] **HTTP PostgREST probe PASS** — confirmed (8-arg `MenuManager` call → `42501 permission denied`, i.e. resolved to the 9-arg). No re-run needed unless the function changed.
- [ ] **All `fnb*` flags currently false** — `featureFlags.ts` lines ~559–563 (`fnbModule/fnbCounter/fnbKitchen/fnbInventory/fnbFinance`).
- [ ] **Pilot club chosen** (one) + **owner account** confirmed (owner role satisfies all cashier authz — no separate cashier grant needed; optionally grant a cashier later via Nhân sự tab).
- [ ] **Data setup exists for one tracked item + one exempt item** — see "Setup data" below (admin currently empty → create them).

## 1) Enable — minimal flags (LOCAL only)
1. Copy the real `.env` into the worktree (Supabase connectivity), flip in `src/lib/featureFlags.ts`:
   - `fnbModule: true` (master + admin), `fnbCounter: true` (counter), `fnbInventory: true` (one-time item setup).
   - **Leave `fnbKitchen: false` and `fnbFinance: false`.**
2. `npm run dev --prefix D:/wt/fnb-module/VinPoker -- --port 8092 --strictPort`; owner opens `localhost:8092`, signs in as the pilot-club owner.
- **ROLLBACK (exact):** set those three flags back to `false` (`git checkout -- src/lib/featureFlags.ts`) + stop the dev server + remove the copied `.env`. Production is unaffected (nothing was committed/deployed).

### Setup data — one-time, on the pilot club, via `VẬN HÀNH → F&B · Quản trị`
- **Ingredient I:** *Nguyên liệu → Thêm nguyên liệu* (name, stock_unit). Then *Nhập kho* → stock-in (qty + unit cost) → **note `on_hand` = S0** (Nguyên liệu tab shows it).
- **Tracked item M1:** *Thực đơn → Thêm món* (name, price `P1`, leave **"Không trừ kho" UNticked** → `tracks_inventory=true`). Then *Công thức* → set recipe: M1 uses **`q` × I**.
- **Exempt item M3:** *Thực đơn → Thêm món* (name, price `P3`, **tick "Không trừ kho (COGS=0)"** → `tracks_inventory=false`).

---

## 2) Pilot Case A — tracked item with recipe  (`VẬN HÀNH → F&B · Quầy`)
1. **Tạo đơn** → tap **M1** (qty 1) → submit → the pay dialog opens.
2. **Confirm payment** → **Thu tiền**.
- **Verify:**
  - [ ] Order shows as **PAID** (moves to **Đã thu** tab); success toast (not an error).
  - [ ] **Subtotal = `P1`** (pay dialog / order card).
  - [ ] **Stock decremented:** Nguyên liệu → `I.on_hand = S0 − q`.
  - [ ] **COGS recorded** *(optional, deeper — see "Finance/COGS check")*.
  - [ ] **Capture the order ID** (from the order card / `Đã thu` list) + screenshot.

## 3) Pilot Case B — cancel/refund before shipped
1. **Tạo đơn** → tap **M1** (qty 1) → submit → **Thu tiền** (now `on_hand = S0 − 2q`).
2. Go to **Đã thu** → on that order tap **Huỷ / Hoàn** (kitchen is OFF, so it is paid-not-shipped).
- **Verify:**
  - [ ] Order status = **cancelled** (idempotent on re-tap = success, not error).
  - [ ] **Stock restored from the sale ledger:** Nguyên liệu → `I.on_hand = S0 − q` (the +q came back).
  - [ ] **COGS reversed** *(optional, deeper — see "Finance/COGS check"; refund recognized at `cancelled_at`, COGS reverses because it was never shipped)*.
  - [ ] Capture order ID + screenshot.

## 4) Pilot Case C — exempt / no-inventory item
1. **Tạo đơn** → tap **M3** (qty 1) → submit → **Thu tiền**.
- **Verify:**
  - [ ] Order **PAID** (success), subtotal = `P3`.
  - [ ] **No stock movement:** Nguyên liệu → `I.on_hand` UNCHANGED (still `S0 − q` from Case A).
  - [ ] **COGS = 0** *(optional, deeper — see below)*.
  - [ ] Capture order ID + screenshot.

### Finance/COGS check (OPTIONAL — owner-approved only; default skip, already backend-proven)
COGS + event-time finance are **not surfaced in the counter UI**. To see them live you would set
`fnb_in_club_net = true` on the **pilot club only** (via *Cài đặt → "Tính lãi/lỗ F&B vào Net CLB"*) **and**
flip `fnbFinance = true`, then read the **Tài chính** dashboard's F&B line (revenue.fnb / fnbCogs, net of
refunds). **Do this only with explicit owner approval**, and **revert both** afterward
(`fnb_in_club_net → false`, `fnbFinance → false`). Otherwise rely on the already-proven `…0011`
event-time tests + golden-diff and skip this — the pilot's must-pass is the visible order + stock flow.

---

## 5) Safety rules
- **Any mismatch** (wrong subtotal, stock not moving/restoring, an unexpected error, a write you didn't
  initiate) → **immediately set `fnbCounter = false`** (revert local flag / stop server). Stop the pilot.
- **No manual DB row edits** — do **not** UPDATE/DELETE `fnb_*` rows to "fix" anything unless a specific
  rollback snippet is written, reviewed, and **explicitly owner-approved** first.
- **Capture every order ID + a screenshot** at each PAID and each cancel.
- **Do NOT proceed to F6 (Kitchen)** until this pilot is a full PASS and the owner says go.
- `fnb_in_club_net` and `fnbFinance` stay **OFF** unless the optional finance check is explicitly approved.

## 6) Cleanup (after verification)
- Cancel the still-paid **Case A** + **Case C** orders → restores Case A stock; Case C had none
  (leaves the pilot club's stock back at `S0`). Capture the cancel confirmations.
- Optionally soft-delete the test menu items (M1, M3) + ingredient I (set inactive) on the pilot club.
- Revert flags to `false`, stop the dev server, remove the copied `.env`.

## 7) Final report format (Claude fills this in after the pilot)
- **Flags before / after** (must return to all-false).
- **Order IDs** (Case A, B, C; plus the cleanup cancels).
- **PASS / FAIL table** — one row per case + each verify sub-check.
- **Stock-movement proof** — `on_hand` trail: `S0 → S0−q (A) → S0−2q (B-pay) → S0−q (B-cancel) → S0−q (C)`, + the `fnb_stock_movements` sale/cancel_return rows if read.
- **Finance/report proof** — only if the optional check was approved (else: "deferred — backend-proven by `…0011`").
- **Cleanup / refund status** — orders cancelled, stock restored to `S0`, items deactivated.
- **Recommendation** — *continue pilot (add a real cashier / more orders)* · *hold* · *fix `<X>` first*.

---

## 8) Pilot execution result — 2026-06-29 · **FULL PASS**
Executed on **club 22222222 "Hanoi Royal Poker"** via the local preview (flags LOCAL-only, **production untouched, no deploy**); real orders on the live DB through the owner's authenticated session.

- **Flags:** before all-false → during `fnbModule/fnbCounter/fnbInventory` = true (LOCAL only), Kitchen/Finance/`fnb_in_club_net` = false → after all-false. `origin/main` F&B flags never changed.
- **Fixtures:** ingredient *Cà phê bột* 1000 g @ 50 ₫; *Cà phê sữa* 25 000 ₫ (recipe 20 g, tracked); *Nước suối* 10 000 ₫ (exempt).
- **Order IDs (all cancelled in cleanup):** A `b1d2f896…` · B `159040ff…` · C `72df295a…`

| Case | Result |
|---|---|
| A tracked+recipe (via counter UI) | ✅ paid · subtotal 25 000 · COGS 1 000 · stock 1000→980 · ledger −20 sale |
| B cancel before ship | ✅ paid→cancelled · stock 980→960→980 restored from sale ledger (+20 cancel_return) · reversed_stock=true |
| C exempt (`tracks_inventory=false`) | ✅ paid · subtotal 10 000 · COGS 0 · no stock movement |
| Finance event-time (`fnb_get_report`) | ✅ revenue 35 000 (B nets 0) · COGS 1 000 (B reversed) · GP 34 000 · 3 orders · {paid 2, cancelled 1} · topItems net refund |

- **Stock trail:** `1000 → 980 (A) → 960 (B-pay) → 980 (B-cancel) → 980 (C) → 1000 (cleanup)`.
- **Finance proof:** verified via `fnb_get_report` **without** enabling `fnb_in_club_net` (kept OFF).
- **Cleanup:** 3 orders cancelled, stock back to 1000, 2 test menu items deactivated, 0 open orders; ingredient left intact.
- **Recommendation:** **CONTINUE** — graduate to a real cashier (Nhân sự → Thu ngân) on one club, `fnbCounter`=false as kill-switch. **F6 Kitchen on HOLD.**

---
*Prepared after the F5 preview UAT passed, then executed on owner approval (see §8).
Reminder: rotate the test-account password that was shared in chat during the pilot (value redacted here).*
