-- ============================================================
-- SEED TEST DEAL — chạy trong Cloud → SQL Editor
-- Tạo 1 deal sạch ở trạng thái "listing, approved" để chạy E2E.
--
-- Tham số mẫu:
--   buy_in = 10,000,000 VND
--   percentage_sold = 20%
--   markup = 1.20
-- => asking_price = 10,000,000 * 0.20 * 1.20 = 2,400,000 VND
--
-- Khi result_prize = 30,000,000 VND:
--   backer_share = (30,000,000 * 20 / 100) / 1.20 = 5,000,000
--   fee          = 30,000,000 * 0.02            = 600,000
--   player_share = 30,000,000 - 5,000,000 - 600,000 = 24,400,000
-- ============================================================

-- 1) Cần ít nhất 2 super_admin (Admin #1 = requester, Admin #2 = co-signer)
SELECT user_id FROM public.user_roles WHERE role='super_admin';

-- 2) Cần ít nhất 1 player (player_id) và 1 backer (backer sẽ commit qua API)
--    -> Chọn 2 user_id tùy ý từ profiles, KHÔNG trùng với super_admin nếu muốn test sạch.
SELECT user_id, display_name FROM public.profiles ORDER BY created_at DESC LIMIT 5;

-- 3) Tạo deal (THAY <PLAYER_USER_ID> bên dưới):
INSERT INTO public.staking_deals (
  player_id, custom_event_name, custom_event_date,
  percentage_sold, markup, buy_in_amount_vnd,
  admin_review_status, status
)
VALUES (
  '<PLAYER_USER_ID>'::uuid,
  'TEST E2E Tournament',
  now() + interval '1 day',
  20, 1.20, 10000000,
  'approved', 'listing'
)
RETURNING id, asking_price_vnd, escrow_amount_vnd, escrow_bank_reference;
-- => Lưu lại id (DEAL_ID) để dùng trong test script
