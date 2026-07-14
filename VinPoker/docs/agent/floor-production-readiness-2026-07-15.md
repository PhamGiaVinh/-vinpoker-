# Floor production readiness — checkpoint 2026-07-15

## Kết luận hiện tại

**CRITICAL / RED — CHƯA ĐỦ ĐIỀU KIỆN production.** Bản vá source và kiểm tra cục bộ đã sẵn sàng để review, nhưng chưa được phép merge/apply/deploy/flip flag. Không có dữ liệu giải, người chơi, payout hoặc production database nào bị sửa trong phiên này.

Hai cổng bắt buộc đang chặn rollout:

1. Checkpoint credential chưa được xác nhận hoàn tất. Kiểm tra names-only vẫn thấy `SUPABASEACCESTOKEN`, `VBACKER`, `VBACKER1`, `VERCELTOKEN` trong GitHub Actions Variables. Không đọc hoặc ghi giá trị. Các tên trùng cũng tồn tại trong Secrets, nhưng việc còn Variables nghĩa là chưa thể xác nhận containment/rotation đã hoàn tất.
2. Migration/RPC và hai Edge Function mới chỉ ở source. Cần owner duyệt theo runbook sau khi credential checkpoint được đóng.

## Sáu lớp sự thật live

| Lớp | Trạng thái kiểm tra | Kết luận |
|---|---|---|
| Source | Nhánh `codex/floor-production-readiness`, base ban đầu `1587bd06`; `origin/main` đã tiến tới `0a7944f8` trong lúc làm và phải được đồng bộ trước PR | Bản vá source có, chưa nằm trong main |
| Migration | Migration mới `20261240000000_floor_production_hardening.sql`; forward-only, không sửa migration cũ, có rollback notes | Chưa apply, không có trong live ledger |
| DB live | Core RPC có một overload và đã khóa `anon`; `restore_busted_player_to_seat` live trùng source `20261237000000` nhưng migration đó không hiện trong ledger. `open_tournament_table` live có patch tên bàn chưa có trong main, còn main có dealer-release fix chưa live | Có drift; tuyệt đối không `db push` hoặc sửa `schema_migrations` |
| Edge live | `tournament-live-draw` v35; `tournament-live-clock` v32 tại thời điểm audit | Chưa có hardening của nhánh này |
| Frontend live | Workflow deploy `main` gần nhất thành công cho SHA `0a7944f8` | Chưa có UI/route guard của nhánh này |
| Feature flag / consumer | `floorTableOps`, `mobileOpsV2`, `cockpitFloorActions`, `closeReport`, `tournamentClockV2` đang `true`; `floorAtomicPayout` giữ `false` | Không bật thêm flag; payout tự động vẫn tắt |

## P0/P1 đã xử lý trong source

- Khóa `/ops` theo user/capability thật; membership Floor lấy từ `floor_club_ids`, không phụ thuộc enum role không tồn tại.
- Hợp nhất phạm vi CLB owner/cashier/floor cho màn Floor; route `/ops/cashier` có guard riêng và không cho Floor đọc trực tiếp dữ liệu thu ngân.
- Loại bỏ dữ liệu mẫu có thể truy cập ở Alerts, More, Tournaments, Dealer Schedule và Player Action sheets. Module mobile chưa nối trả trạng thái “dùng máy tính”, không giả lập thao tác thành công.
- `move_player_seat`, close table và redraw fail-closed khi ghế orphan/mismatch; không fallback theo `player_id`, không vô hiệu hóa ghế để “chữa cháy”.
- `close_tournament` idempotent nhưng chặn khi còn ghế active trước khi tổng hợp tiền.
- Restore chỉ dùng đúng seat `status='busted'`, chặn sau close report/prize payment, yêu cầu xác nhận UI lần hai và không tự đoán chip.
- Thêm `floor_bust_player`: RPC nguyên tử không payout, khóa tournament/seat/entry, bắt chip bằng 0, chặn active hand, cập nhật seat + entry + players remaining trong một transaction và ghi audit. Edge không còn dựa vào trigger best-effort để hoàn tất entry.
- Edge draw/clock dùng JWT user, xác thực club capability ở server, không dùng service-role, không tin identity/current level từ client, dùng compare-and-set và báo stale state.
- UI bust ghi rõ hạng/thưởng là **tạm tính — chưa chốt** khi `floorAtomicPayout=false`.
- Sửa chip gửi `expected_chip_count`; stale concurrent edit bị từ chối.

## Kiểm tra cục bộ

- `npm run build`: PASS, 5,396 modules; chỉ còn cảnh báo chunk/dynamic-import hiện hữu.
- Focused TypeScript config kế thừa `tsconfig.app.json`: PASS. Config tạm đã xoá sau khi chạy.
- `npx tsc -b --pretty false`: **không kết luận**; không in lỗi nhưng timeout sau 184 giây và tiến trình dùng khoảng 1.9 GB RAM đã được dừng đúng PID.
- ESLint mục tiêu cho các file Floor mới/sửa: PASS.
- Vitest contract: PASS 10/10.
- Playwright E2E unauthenticated `/ops`, `/ops/tables`, `/ops/cashier`: PASS 6/6 on 390px mobile and 1280px desktop. Playwright tự cấp dummy local Supabase URL/key khi môi trường chưa có, chỉ để boot client; không gọi production.
- `deno check` cho `tournament-live-draw` và `tournament-live-clock`: PASS.
- `git diff --check`: PASS.
- Database integration test: CHƯA CHẠY. Docker Desktop service có mặt nhưng không thể start với quyền hiện tại; không dùng live DB làm test fixture.
- Browser visual UAT: CHƯA CHẠY. Browser plugin thiếu file bắt buộc `docs/browser-safety.md`; không bypass quy trình an toàn của plugin. Preview Vercel của PR trả PASS nhưng bị Vercel SSO khi mở từ môi trường này, nên chưa có bằng chứng UAT giao diện tương tác.
- `npm ci --ignore-scripts` báo 21 advisory trong dependency lock hiện tại (7 moderate, 13 high, 1 critical). Không chạy `npm audit fix` vì ngoài phạm vi và có thể gây đổi dependency lớn.

## Rollout bắt buộc sau khi đóng checkpoint credential

1. Re-verify `origin/main`, live migration ledger, exact RPC source, Edge versions, frontend deploy và flag consumers.
2. Review độc lập migration CRITICAL và chạy SQL integration test trên DB disposable/TEST.
3. Owner nói đúng câu: `Apply migration 20261240000000 to live database orlesggcjamwuknxwcpk now.`
4. Verify function signatures/privileges/source hash; smoke test bằng tournament/player TEST, không dùng dữ liệu thật.
5. Re-check next Edge versions ngay trước deploy, rồi owner nói riêng từng câu: `Deploy tournament-live-draw version [version] to live Edge now.` và `Deploy tournament-live-clock version [version] to live Edge now.`
6. Merge frontend chỉ sau CI + preview UAT owner/cashier/floor trên desktop và mobile `/ops`.
7. Giữ `floorAtomicPayout=false`. Không bật cho đến khi migration payout riêng, test tấn công và owner gate hoàn tất.

## Rollback/containment

- Nếu migration fail trước commit: transaction rollback toàn bộ.
- Nếu smoke test fail sau apply: dừng Edge/frontend rollout, giữ flag payout tắt, dùng rollback function bodies đã snapshot theo controlled runbook; không sửa ledger thủ công.
- Nếu Edge fail: rollback từng function về version live đã xác minh trước deploy (draw v35 / clock v32 tại thời điểm audit), sau đó verify log và health.
- Nếu frontend fail: rollback deployment/commit; không thay đổi DB hoặc flag để che lỗi UI.

## An toàn

- `schema_migrations` đổi: **KHÔNG**
- `supabase db push/reset/migration up`: **KHÔNG**
- Edge deploy / Vercel production deploy: **KHÔNG**
- Merge / feature-flag flip: **KHÔNG**
- Đọc/in/commit secret values: **KHÔNG**
- Sửa dữ liệu tournament/player/payout thật: **KHÔNG**
