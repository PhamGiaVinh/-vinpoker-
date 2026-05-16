## Group Chat — 4 tính năng mới

### 1. Database (1 migration)

**`chat_group_messages` — thêm cột attachment**
- `attachment_url text`, `attachment_type text` (`image` | `file`), `attachment_name text`, `attachment_size int`
- Nới CHECK content: cho phép rỗng nếu có attachment (`content <> '' OR attachment_url IS NOT NULL`).

**`chat_group_invites` (mới)**
- `id uuid PK`, `group_id uuid FK chat_groups`, `token text UNIQUE` (random 16 ký tự), `created_by uuid`, `created_at`, `expires_at` (mặc định +7 ngày, có thể null = vô hạn), `max_uses int null`, `uses int default 0`, `revoked_at timestamptz`.
- RLS: thành viên nhóm đọc/tạo/thu hồi link của nhóm mình (qua `is_group_member`); ai cũng `select` được 1 row theo `token` (để xem trước nhóm trước khi join) — dùng RPC security definer `get_invite_preview(token)` trả `group_id, name, avatar_url, valid`.
- RPC security definer `accept_group_invite(_token text)` → kiểm tra token còn hạn / chưa hết lượt / chưa bị revoke → insert vào `chat_group_members` (idempotent), tăng `uses`, trả `group_id`.

**`chat_group_typing` (ephemeral, dùng Supabase Realtime broadcast/presence — KHÔNG cần bảng).** Sẽ dùng `channel.broadcast` thay vì DB để tránh ghi spam.

**Storage bucket `chat-uploads` (đã tồn tại, public)** — tái sử dụng. Path: `groups/{group_id}/{uid}-{timestamp}-{filename}`.

### 2. Routes & Pages

- Thêm route `/invite/:token` → `src/pages/GroupInvite.tsx`:
  - Gọi `get_invite_preview` → hiển thị tên/avatar nhóm + nút "Tham gia nhóm".
  - Nếu chưa đăng nhập → redirect `/auth?redirect=/invite/:token`.
  - Click join → gọi RPC `accept_group_invite` → `nav('/group/:id')`.
  - Trạng thái: hết hạn / hết lượt / đã bị thu hồi / nhóm đã xoá → thông báo lỗi.

### 3. Components

**`MessageAttachment.tsx` (mới)**
- Image: thumbnail click mở Dialog full-screen, có nút download.
- File: icon + tên + size + nút download (dùng `<a download href>`).

**`GroupChat.tsx` — cập nhật:**
- Nút đính kèm (Paperclip + Image icon) cạnh ô nhập. Upload trực tiếp lên `chat-uploads` qua Supabase Storage, rồi insert message với `attachment_*`. Hiển thị tiến trình + preview thumbnail trước khi gửi.
- Render `MessageAttachment` trong từng tin nhắn nếu có.
- Typing indicator: subscribe `channel.on('broadcast', { event: 'typing' })`. Khi user gõ → debounce gửi `broadcast` (chỉ gửi 1 lần / 3s, kèm tên). Hiển thị "X đang nhập…" phía trên ô input, tự ẩn sau 4s không nhận event.
- Header: thêm nút "Mời" (Link icon) → mở `InviteLinkDialog`.

**`InviteLinkDialog.tsx` (mới)**
- Hiển thị link hiện tại của nhóm (`/invite/:token`) — tạo mới nếu chưa có.
- Nút Copy link, Share (Web Share API fallback copy), nút "Tạo link mới" (revoke cũ + tạo mới).
- Tuỳ chọn ngắn: hết hạn 1h / 1 ngày / 7 ngày / không hết hạn; max_uses optional.

**`AddMemberDialog.tsx` (mới)** — mở từ `GroupMembersDialog` qua nút "Thêm thành viên" (mọi member đều thấy):
- Search profile theo `display_name` (ilike, limit 20, loại trừ thành viên hiện tại).
- Click "Thêm" → insert `chat_group_members(group_id, user_id)`.
- RLS sẽ cho phép member thêm người (xem mục 4).

### 4. RLS & Security

- `chat_group_members` INSERT policy: cho phép `auth.uid() = user_id` (self-join nhóm public/qua invite) **HOẶC** `is_group_member(auth.uid(), group_id)` (member thêm người khác).
- `chat_group_invites`: select/insert/update giới hạn cho member của nhóm; select-by-token mở qua RPC.
- Storage `chat-uploads` đã public (xem ảnh không cần token); upload yêu cầu authenticated.

### 5. Edge cases

- File size client-side ≤ 10MB; type whitelist: image/* + pdf + zip + doc/docx/xls/xlsx + txt.
- Optimistic message với attachment: hiển thị `_optimistic` overlay loading.
- Invite link: nếu token không hợp lệ → trang lỗi rõ ràng.
- Typing event không gửi nếu nội dung rỗng / đang gửi attachment.

### 6. Không thay đổi
- DM/booking chat, schema cũ.
- Không thêm push notification cho attachment/invite.

### File changes (dự kiến)
- migration mới (cột attachment + bảng invites + 2 RPC + RLS update)
- new: `src/pages/GroupInvite.tsx`, `src/components/groups/InviteLinkDialog.tsx`, `src/components/groups/AddMemberDialog.tsx`, `src/components/groups/MessageAttachment.tsx`
- edit: `src/pages/GroupChat.tsx`, `src/components/groups/GroupMembersDialog.tsx`, `src/App.tsx` (route /invite/:token)
