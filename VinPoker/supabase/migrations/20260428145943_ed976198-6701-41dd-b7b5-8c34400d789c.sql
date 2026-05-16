ALTER TABLE public.clubs
  ADD COLUMN IF NOT EXISTS bot_enabled boolean NOT NULL DEFAULT true,
  ADD COLUMN IF NOT EXISTS bot_qr_url text,
  ADD COLUMN IF NOT EXISTS bot_welcome_message text NOT NULL DEFAULT 'Đây là mã QR thanh toán phí tập huấn bên CLB, anh/chị thanh toán xong vui lòng gửi lại hình ảnh thanh toán thành công!';