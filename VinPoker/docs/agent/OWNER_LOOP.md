# Owner Loop — 🟢 GREEN / 🔴 RED (cho người non-tech)

Triết lý: **Claude Code làm hết phần kỹ thuật. Chủ chỉ (1) duyệt plan và (2) test.** Chủ không bao giờ
phải đọc code hay SQL.

Có **hai chế độ**, vì một lỗi ở màn hình khác hẳn một lỗi ở tiền:
- 🟢 **GREEN** — *không* đụng tiền / bài / kết quả → full automation. Chủ duyệt plan 1 dòng + test.
- 🔴 **RED** — *có* đụng tiền / bài / kết quả → Claude giải thích plan bằng tiếng Việt đời thường +
  tự chạy **test tấn công**, chủ duyệt *logic* (không đọc SQL), Claude **dừng trước production**.

> Đây là **cửa ngõ của chủ**. Bên trong, agent vẫn chạy kỷ luật FAST/SAFE/CRITICAL — xem bảng ánh xạ
> cuối file. Chủ chỉ cần nghĩ GREEN/RED.

## Phân biệt trong 5 giây

Hỏi một câu: **"Việc này có đụng tới tiền, bài, hay kết quả game không?"**

| Nếu… | Chế độ | Ví dụ |
|---|---|---|
| KHÔNG đụng tiền/bài/kết quả | 🟢 GREEN | đổi màu, sửa layout, thêm màn hình, sửa nút, báo cáo hiển thị, tính năng xem |
| CÓ đụng tiền/bài/kết quả | 🔴 RED | payroll, cashier, rút tiền, chia tiền staking, đếm chip, ai thắng, settlement, giá/phí |

> **Không chắc? → coi là 🔴 RED.** Luôn chọn phía an toàn.

---

## 🟢 GREEN — full automation

**Chủ làm:** duyệt plan 1 dòng → Claude làm hết → chủ bấm test → xong.

### Prompt copy sẵn (GREEN)

```
## TASK — CHẾ ĐỘ NHANH (GREEN)
Tôi muốn: <mô tả bằng tiếng Việt điều bạn muốn thấy>
  Ví dụ: "Thêm màn hình xem lịch sử giải đấu cho chủ club, có filter theo tháng."

Rules (Claude tự tuân):
  - Additive only, no broad refactor.
  - KHÔNG đụng: tiền/payroll/cashier/bankroll/staking/settlement, kết quả game, RPC tài chính.
  - No secrets in files. No schema_migrations changes.

AUTONOMY: GREEN → làm TRỌN VẸN, tự động, không dừng hỏi giữa chừng.
  Tự viết code, tự build, tự xem UI chạy được (Playwright MCP nếu là UI). Lỗi thì tự sửa và thử lại.

TRÌNH TÔI DUYỆT TRƯỚC KHI LÀM:
  Plan NGẮN tiếng Việt (2-3 dòng): sẽ làm gì, thêm màn hình nào. KHÔNG dán code. Đợi tôi gõ "OK làm đi".

KHI XONG, báo cáo tiếng Việt:
  - Đã làm gì (1-2 dòng)
  - Cách tôi test: bấm vào đâu, sẽ thấy gì
  - VERDICT: XONG_RỒI / CẦN_XEM_LẠI
```

### Luồng
1. Chủ gõ điều muốn. 2. Claude đưa plan 2-3 dòng → chủ gõ **"OK làm đi"**. 3. Claude làm hết, tự sửa
lỗi, báo **XONG_RỒI** + cách test. 4. Chủ bấm thử. Chạy tốt → xong.

---

## 🔴 RED — plan tiếng Việt + test tấn công

Vẫn **không cần đọc SQL** — nhưng chủ duyệt *logic tiền* bằng ngôn ngữ dễ hiểu, và Claude test kỹ hơn
nhiều. Lý do: lỗi tiền không hiện lúc test một lần — nó hiện 3 tuần sau khi nhiều người rút cùng lúc,
hoặc một số làm tròn sai lặp 500 lần. "Test" ở đây nghĩa là **tấn công đúng các tình huống đó**.

### Prompt copy sẵn (RED)

```
## TASK — CHẾ ĐỘ TIỀN (RED)
Tôi muốn: <mô tả bằng tiếng Việt>
  Ví dụ: "Khi người chơi thắng giải, tự động chia phần cho backer tại cage."

Rules (Claude tự tuân):
  - Server là nguồn sự thật; client không bao giờ quyết tiền/bài/kết quả.
  - Additive & flag-gated. Migration MỚI, version SAU head hiện tại.
  - KHÔNG đụng object cũ, Payroll/Cashier/Bankroll hiện có, schema_migrations.
  - Được dùng token (GitHub Secrets) để chạy migration additive MỚI ĐÃ DUYỆT.
  - KHÔNG deploy_db=true. KHÔNG supabase db push (migration cũ chưa reconcile). KHÔNG in token.
  - No secrets in files.

## BƯỚC 1 — GIẢI THÍCH CHO TÔI DUYỆT (tiếng Việt, KHÔNG code):
  1. Đường đi của tiền: tiền vào đâu, chia thế nào, ai nhận bao nhiêu.
  2. Nếu HAI người rút/thắng CÙNG LÚC thì sao?
  3. Nếu bấm nhầm HAI LẦN thì sao? (có bị chia đôi không?)
  4. Chỗ nào có thể sai, và cách nó được chặn.
  Đợi tôi gõ "OK logic đúng" TRƯỚC KHI viết bất cứ gì.

## BƯỚC 2 — VIẾT + TỰ CHẠY TEST TẤN CÔNG (sau khi tôi duyệt):
  - Nhiều người thao tác cùng lúc (concurrency).
  - Bấm/gọi lặp lại (idempotency — không chi hai lần).
  - Làm tròn tiền lặp nhiều lần (không lệch dần).
  - Tổng tiền vào = tổng chia ra (không thất thoát).
  Báo PASS/FAIL từng cái bằng tiếng Việt.

## BƯỚC 3 — DỪNG. KHÔNG tự đẩy lên production.
  Chuẩn bị migration + test + cách hoàn tác (rollback). Cờ mặc định TẮT.
  Đợi tôi gõ "OK đẩy lên" (hoặc tôi nhờ người kỹ thuật xem phần tiền).

BÁO CÁO cuối bằng tiếng Việt:
  - Logic tiền (nhắc lại 2-3 dòng)
  - Kết quả test tấn công: từng tình huống PASS/FAIL
  - VERDICT: CHỜ_TÔI_DUYỆT_ĐẨY / TEST_FAIL_KHÔNG_ĐƯỢC_ĐẨY
```

### Luồng
1. Chủ gõ điều muốn. 2. Claude giải thích **đường đi tiền + tình huống nguy hiểm** → chủ gõ **"OK logic
đúng"**. 3. Claude viết + chạy **test tấn công**, báo PASS/FAIL. 4. Tất cả PASS → Claude **dừng, chờ**
chủ gõ "OK đẩy lên". 5. Chủ quyết đẩy (hoặc nhờ người kỹ thuật xem phần tiền trước).

---

## Ánh xạ GREEN/RED → FAST/SAFE/CRITICAL (agent nội bộ)

| Chủ chọn | Nghĩa | Agent chạy |
|---|---|---|
| 🟢 GREEN | không tiền/bài/kết quả | **FAST** (UI/text) hoặc **SAFE** (logic thường) — full automation |
| 🔴 RED | có tiền/bài/kết quả | **CRITICAL** — giải thích logic tiền → duyệt → test tấn công → DỪNG trước prod |

Chủ chỉ nghĩ GREEN/RED; agent tự dịch sang FAST/SAFE/CRITICAL. Chi tiết mode: `../CLAUDE.md`. Kỷ luật
DB + safety hook: `LIVE_DB_RULES.md`. Checklist tiền: `REVIEW_CHECKLIST.md` (mục "Money changes").

## Quy tắc token (Supabase / Vercel)

- Token sống trong **biến môi trường / GitHub Secrets** — **tuyệt đối không** dán vào file `.md`,
  `.sql`, chat, log, commit, hay code.
- Token cho phép chạy **migration additive MỚI đã duyệt** (một lần `supabase db query --linked` trong
  mô hình controlled apply). **KHÔNG** bật `supabase db push` / `deploy_db=true` (migration cũ chưa
  reconcile — push mù sẽ apply nhầm lịch sử hỏng). Safety hook chặn sẵn dù có allowlist.
- Token = *ai gõ SQL* (tự động hóa được). Cổng RED = *SQL đúng chưa* (vẫn cần chủ duyệt). Hai chuyện
  khác nhau — có token không bỏ được cổng.

## Lưới an toàn cho phần tiền (đọc một lần)

Chủ là người non-tech xây sản phẩm **giữ tiền của người khác**. Chế độ RED bảo vệ rất nhiều, nhưng lưới
an toàn thật sự nhất là: **một người kỹ thuật review riêng phần tài chính** (payroll, cashier,
settlement, staking) trước khi lên production. Hiện code tiền chưa có ai ngoài Claude xem — đó là rủi ro
thật. Khi tiền thật chạy qua, đây là chỗ đầu tiên nên có mắt người kỹ thuật.

Mọi phần **không phải tiền** → cứ 🟢 GREEN, chạy nhanh hết cỡ.
