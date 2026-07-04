# iOS Operations — Implementation Plan (PR-IOS0, docs-only)

> **Trạng thái: SPEC — chưa triển khai.** Base SHA `e194571d`. Ghi đè master-map §20.1.
> **Không code app trong PR này.** Triển khai chỉ bắt đầu sau khi owner nói đúng câu:
> **"Proceed with iPhone Floor UI implementation."**

## 1. Cờ `mobileOpsV2` (đề xuất — CHƯA tồn tại)
- Thêm vào `src/lib/featureFlags.ts`, **mặc định `false`** (theo non-negotiable "flags default OFF").
- Ý nghĩa kill-switch: OFF ⇒ route `/ops/*` redirect + `SafeAreaPageShell` không mount + entry ẩn ⇒ **prod
  không đổi 1 byte**. ON (sau UAT) ⇒ hiện shell vận hành mobile.
- Gate kép: `mobileOpsV2` (bật UI) **và** vai trò (`isFloor`/`isCashier`/…); độc lập với cờ backend đã ON
  (`floorTableOps`/`floorOutConfirm`/`accountingControl`) — chỉ **tái dùng** read/RPC hiện có, không thêm write.

## 2. Các PR (mỗi PR = 1 owner-gate riêng)

### PR-IOS0 — Docs (PR NÀY)
- **Scope**: 6 docs + 1 evidence log dưới `VinPoker/docs/design/`.
- **Files touched**: `docs/design/iphone-operations-ux-audit.md`, `…-information-architecture.md`,
  `ios-floor-ux-spec.md`, `ios-floor-wireframes.md`, `ios-operations-components.md`,
  `ios-operations-implementation-plan.md`, `iphone-operations-screens/EVIDENCE.md`.
- **Files forbidden**: mọi thứ NGOÀI `docs/design/**` (không `src/`, không `featureFlags.ts`, không `manifest`,
  không route, không `uiux-master-map.md`).
- **Tests**: không (docs). **Screenshots**: không commit (privacy).
- **Rollback**: revert PR.
- **Owner UAT**: đọc docs (checklist §4).
- **Stop trigger**: owner phản đối bất kỳ verdict GO/HOLD/NO-GO nào → sửa doc trước khi đi tiếp.

### PR-IOS1 — Shell + flag (UI-only, mock)
- **Scope**: `SafeAreaPageShell` + bottom nav (nhân bản `DealerAppShell`/`DealerBottomNav`), route `/ops/*`
  rỗng (placeholder), cờ `mobileOpsV2=false`. **+ sửa manifest** `theme_color` `#3b82f6`→`#C9A86A` (1 dòng).
- **Files touched**: `src/components/ops/SafeAreaPageShell.tsx` (mới), `src/components/ops/OpsBottomNav.tsx` (mới),
  route add (App router), `src/lib/featureFlags.ts` (+1 dòng cờ), `public/manifest.webmanifest` (theme_color).
- **Files forbidden**: `Layout.tsx`, `DealerAppShell.tsx`/`DealerBottomNav.tsx` (không sửa — chỉ tham chiếu),
  `src/rpc/*`, `src/edge/*`, migrations, các cờ khác.
- **Tests**: render test shell (mount khi flag ON, redirect khi OFF); tsc 0 lỗi mới (baseline 75).
- **Screenshots**: local preview mock, 390/430/768 — shell rỗng + nav.
- **Rollback**: cờ OFF + revert. **Owner UAT**: mở `/ops` (flag ON preview) thấy shell + nav an toàn.
- **Stop trigger**: bất kỳ thay đổi nào rò rỉ ra ngoài `/ops` khi cờ OFF.

### PR-IOS2 — "Floor hôm nay" read-only (mock/data-an-toàn)
- **Scope**: màn Hôm nay + component TodayTaskCard/TournamentStatusCard/CompactMetricCard/OperationStatusChip/
  RealtimeStaleBanner với **DỮ LIỆU MẪU** (hoặc read-only từ nguồn an toàn hiện có nếu owner muốn).
- **Files touched**: `src/components/ops/today/*`, `src/components/ops/shared/*` (component §5 docs).
- **Files forbidden**: mọi write path; `Layout.tsx`; cờ khác.
- **Tests**: unit render 5-state (default/loading/empty/error/stale); tsc.
- **Screenshots**: 390/430/768 màn Hôm nay (mock).
- **Rollback**: cờ OFF. **Owner UAT**: 6 câu hỏi trả lời trong 5 giây? (checklist §4).
- **Stop trigger**: bất kỳ số tài chính nào hiện không kèm Tạm tính/Đã chốt; mock không dán nhãn.

### PR-IOS3 — Bàn / ghế / redraw (wiring an toàn hiện có)
- **Scope**: màn Bàn (TableStatusCard) → sheet chi tiết → **tái dùng** `PlayerActionSheet`/`BustConfirmDialog`/
  `RedrawLauncherDialog`/`MovePlayerDialog`/`EditChipsDialog` (KHÔNG viết lại backend).
- **Files touched**: `src/components/ops/tables/*`; import lại component floor hiện có.
- **Files forbidden**: sửa Edge `tournament-live-draw`, RPC seat, migrations; thêm write mới.
- **Tests**: guard confirm restate; tsc; không đổi write path (diff review).
- **Screenshots**: 390 map + sheet + BustConfirm.
- **Rollback**: cờ OFF. **Owner UAT**: bốc lại/loại có preview + restate; không mis-tap.
- **Stop trigger**: bất kỳ hành động tiền/bust nào thiếu ConfirmActionSheet restate.

### PR-IOS4 — Cảnh báo / sự cố + Tài chính read-only
- **Scope**: `/ops/alerts` (AlertQueueItem) + FinancialWarningCard **read-only** (nhãn DỮ LIỆU MẪU tới khi
  cockpit nối số thật — phụ thuộc plan Tài chính riêng, không thuộc đây).
- **Files touched**: `src/components/ops/alerts/*`.
- **Files forbidden**: mọi nút ghi tiền cho floor; RPC/Edge.
- **Tests**: word-guard doctrine ("Kế toán"/"Lãi ròng"/"Lợi nhuận" cấm — như test PR #672); 5-state.
- **Screenshots**: 390 alerts + financial card.
- **Rollback**: cờ OFF. **Owner UAT**: thuật ngữ đúng; floor không sửa được tiền.
- **Stop trigger**: floor thao tác được tiền; thuật ngữ sai.

### PR-IOS5 — Owner UAT flag-on
- **Scope**: flip `mobileOpsV2=true` (1 dòng) sau khi UAT các PR trên. Không code mới.
- **Rollback**: về `false`. **Owner UAT**: dùng thật trên iPhone (PWA) một ca.
- **Stop trigger**: bất kỳ P0 nào xuất hiện trên thiết bị thật.

## 3. Follow-up chore (KHÔNG trong các PR trên)
`docs(design): update uiux-master-map §20.1 from Stitch neon-green to Midnight Sakura` — sửa clause §20.1 cho
khớp thực tế (PR riêng, chỉ docs).

## 4. Owner UAT checklist cho DOCS (PR-IOS0)
- [ ] "Floor hôm nay" (doc 3 §3) — **6 câu hỏi** có đúng là 6 điều anh cần thấy trong 5 giây?
- [ ] Bảng GO/HOLD/NO-GO (doc 1 §4) — có màn nào anh thấy sai verdict?
- [ ] Bộ **5 bottom tab** (Hôm nay/Giải đấu/Bàn/Cảnh báo/Thêm) — ổn? Tài chính KHÔNG là tab floor — đồng ý?
- [ ] Thuật ngữ tiền (Tạm tính/Đã chốt · Còn lại sau lương · Tiền chuyển hộ · Biên đóng góp ≠ Lợi nhuận) — đúng?
- [ ] 12 wireframe copy tiếng Việt (doc 4) — chữ nào cần đổi?
- [ ] Thứ tự PR-IOS1..5 + stop triggers — ổn?
- [ ] Xác nhận **không dòng code app nào** đổi trong PR này.

## 5. Rủi ro & stop triggers toàn wave
- Rò rỉ khi cờ OFF (mọi PR phải chứng minh `/ops` inert khi OFF).
- Floor chạm được tiền (cấm tuyệt đối; RoleLockedAction + gate).
- Đụng `Layout.tsx`/`/dealer/*` (cấm — subtree riêng).
- Mock hiện như thật (bắt buộc nhãn DỮ LIỆU MẪU).
- Máy 7.5GB RAM: build/tsc chạy nền + chờ; vitest là cổng nhanh.

## 6. Ranh giới triển khai (nhắc lại)
UI/client-only trước · không write mới · không DB/RPC/Edge/migration · chỉ wiring read an toàn từ nguồn hiện có ·
mọi hành động rủi ro giữ luồng hiện có tới khi được duyệt riêng · **không bắt đầu tới khi owner nói câu ở đầu doc**.
