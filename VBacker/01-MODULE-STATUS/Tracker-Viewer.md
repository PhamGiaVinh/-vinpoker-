---
title: Tracker Live Viewer
updated: 2026-07-09
status: LIVE (Hand-Edit G3 UI pending)
---

# Tracker Viewer Integration

## Current Status
- **Live realtime** LIVE (T1/T3A/T2a/T4 merged)
- **Tracker Undo** #91 APPLIED LIVE (delete_last_action + Edge v10)
- **Hand Input tablet** #82/#81 LIVE (table-map redesign)
- **Tracker Engine Mode** flag OFF, DRAFT #310 (pure engine, HU/3+/settlement)
- **Hole-card visibility** INTENDED (Triton broadcast standard, not a bug)

## Hand-Edit + Resettle-Forward (Đợt F/G) — sửa ván đã hoàn thành
- **F2 "Sửa hand" (DISPLAY-ONLY) LIVE** — #806 merged + migration `20261225000000` applied + flag `trackerHandHistoryEdit` ON (#807). Sửa board/hole/action; chip KHÔNG đổi; `hand_edit_log` bất biến; `void_last_hand` guard (chỉ void ván mới nhất). Owner UAT ✅.
- **G1 resettle engine LIVE (INERT)** — #813. Pure `src/lib/tracker-poker/resettleForward.ts` tính lại winner + dời chip xuôi các ván sau; `reduceHand` injected; 10 tests; 6 block reason (dừng khi lệch cấu trúc, không ghi phần nào).
- **G2 apply RPC APPLIED LIVE 2026-07-09** — #815, migration `20261226000000`. `apply_resettle_forward` ghi chip atomic (chips-only, bảo toàn tổng, từ chối lật bust) + `resettle_forward_log` audit. Auditor PASS. Flag `trackerResettleForward` OFF. (Deadlock lần đầu do FK clubs → đã bỏ FK.)
- **⏳ G3 (UI) CHƯA build** — nút "Sửa & tính lại chip" nối engine G1 → gọi RPC G2. Cần client-copy `reduceHand` (vite-walled). Owner UAT giải TEST trước khi bật cờ. Chi tiết: [[project-resettle-forward-engine]] + [[CLAUDE_LATEST]].

## Live Components
- `/live/:id` per-action stream
- Public `/live` hub (mobile-first viewer)
- Action Engine inc1+inc2+inc3 LIVE
- Event Hub inc A DRAFT, B/C owner-gated

## Phase 2 (Deferred)
- Evaluator + side-pot logic
- Settlement history
- Multi-table replay

## Risks
- Realtime lag on slow networks
- Hole-card replay visible to all (design requirement, not vulnerability)

## Next
- Owner visual UAT on mobile viewer
- Phase 2 scope + timeline

---
Link: [[MODULE_STATUS]]
