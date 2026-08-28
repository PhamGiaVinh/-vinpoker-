-- ============================================================================
-- Satellite payout — cột lưu cơ cấu trả thưởng NHẬP TAY cho giải vé (satellite)
-- ============================================================================
-- Use case (owner): giải satellite trả VÉ (ticket/seat) + 1 phần "tiền thừa" (bubble). Payout engine
-- hiện money-only + Σ=pool bắt buộc → KHÔNG chứa được vé. Owner muốn ĐƠN GIẢN: operator TỰ NHẬP TAY,
-- tự tính. Nên lưu tách khỏi engine: 1 cột jsonb tự do trên tournaments, không đụng tournament_prizes /
-- prepare_payout_snapshot / apply_payout_run (không Σ=pool, không snapshot/close).
--
-- Giá trị = { "rows": [ { "label": "1–12", "prize": "1 vé" }, { "label": "13", "prize": "4.500.000" } ] }
-- (label + prize đều là text tự do — operator gõ gì cũng được).
--
-- Ghi/đọc qua RLS UPDATE/SELECT sẵn có của tournaments (is_club_dealer_control = chủ CLB/TD/floor-control)
-- — KHÔNG cần RPC/policy mới. SOURCE-ONLY: owner apply qua controlled runbook (BEGIN..COMMIT).
-- ============================================================================

ALTER TABLE public.tournaments
  ADD COLUMN IF NOT EXISTS satellite_payout jsonb;

COMMENT ON COLUMN public.tournaments.satellite_payout IS
  'Cơ cấu trả thưởng satellite nhập tay (vé + tiền): { rows: [{ label, prize }] } text tự do; NULL = không dùng satellite. Không qua payout engine (không Σ=pool).';
