# Owner Daily Digest V2 — hợp đồng snapshot canonical

> **CRITICAL / SOURCE-ONLY.** Tài liệu này mô tả nghĩa nghiệp vụ của source. Nó không xác nhận
> migration, Cron, RPC hoặc giao diện đã được áp dụng lên production.

## Một nguồn tính duy nhất

`private.generate_owner_daily_digest_snapshot_v2` là bộ máy duy nhất được phép tính Owner Daily
Digest. Web và Automation chỉ đọc snapshot bất biến đã được hàm này tạo. n8n không tự cộng lại
rake, phí dịch vụ, F&B, payout hoặc payroll.

## Ngày vận hành

- `business_date` là ngày địa phương tại đầu cửa sổ.
- Cửa sổ mặc định là `[business_date 06:00, ngày kế tiếp 06:00)` theo timezone IANA của CLB.
- Snapshot lưu nguyên `effective_timezone`, `window_start_utc` và `window_end_utc`; đổi timezone sau
  này không làm đổi nghĩa snapshot cũ.
- Global due-runner xét mỗi 5 phút, tạo báo cáo ngày vừa kết thúc từ 07:00 địa phương và chỉ catch-up
  tối đa 24 giờ. Mỗi CLB mặc định `enabled=false`.

## Metric contract

| Metric | Nguồn canonical | Gán thời gian/phạm vi | Bao gồm | Loại |
|---|---|---|---|---|
| Người đăng ký | `tournament_registrations` + `tournaments` | Tournament bắt đầu trong business window | distinct player, registration `confirmed` | pending/rejected/cancelled, tournament soft-deleted |
| Người tham dự | `tournament_entries` + cohort registration | Cùng cohort tournament | distinct player có check-in/seat hoặc entry đã chạy | entry cancelled |
| Entries | `tournament_entries` + cohort registration | Cùng cohort tournament | entry/re-entry gắn registration confirmed | entry cancelled |
| Nhân sự | `staff_attendance` + `dealer_attendance` | Ca giao với `[start,end)` | distinct staff/dealer có attendance | attendance cancelled/no-show |
| Rake thuần | split đã lưu trên registration | Cùng cohort tournament | tổng `rake_paid_vnd` của registration confirmed | legacy row chưa có split → `UNAVAILABLE`, không đoán |
| Phí dịch vụ | split đã lưu trên registration | Cùng cohort tournament | tổng `service_fee_paid_vnd` | legacy row chưa có split → `UNAVAILABLE`, không đoán |
| F&B thuần | `fnb_orders` | dòng tiền được ghi trong business window | paid/shipped không comp trừ cancelled/refund đã ghi | pending/expired/comp |
| Payout CLB đang chờ | `tournament_prizes`, applied payout run, `tournament_prize_payments` | point-in-time tại `source_as_of`, toàn CLB | nghĩa vụ cho finisher đã xác định trừ payment `paid` | draft payout, tournament chưa có finisher |
| Lương dealer đang chờ | `payroll_periods`, `dealer_payroll`, `payment_records` | point-in-time tại `source_as_of`, toàn CLB | submitted/approved/locked/payment_prepared | draft/rejected/paid/reconciled |

`0` nghĩa là nguồn khỏe và thật sự không có giá trị. `NULL + UNAVAILABLE` nghĩa là chưa đủ dữ liệu
canonical. Lỗi truy vấn tạo generation run `FAILED` và không tạo snapshot giả bằng số 0.

## Split rake và phí dịch vụ

Hai cột nullable được bổ sung vào `tournament_registrations`:

- `rake_paid_vnd`
- `service_fee_paid_vnd`

Trigger server tự lấy cấu hình tournament tại thời điểm **INSERT**, không tin giá trị client gửi.
`used_free_rake=true` chỉ được chấp nhận từ đường service-role đã tiêu thụ một slot canonical;
authenticated client tự gửi cờ này sẽ bị từ chối.
Với registration mới:

```text
total_pay = buy_in + rake_paid_vnd + service_fee_paid_vnd
```

Free-rake làm `rake_paid_vnd=0`, phí dịch vụ vẫn theo cấu hình canonical. Split đã lưu là bất biến.
Row lịch sử giữ `NULL`; không backfill bằng cấu hình hiện tại.

## Snapshot và revision

- Snapshot đã tạo là immutable.
- Unique logical content: `club_id + business_date + calculation_version + source_hash`.
- Cùng hash trả snapshot hiện có; hash khác tạo revision mới và giữ revision cũ.
- Web đọc latest successful revision và luôn hiển thị `snapshot_version`, `generated_at`,
  `source_as_of`.
- `source_hash` không chứa `generated_at` hoặc `source_as_of`.
- `money_state` V1 luôn `PROVISIONAL`; không tuyên bố `CLOSED` khi chưa có Daily Close canonical
  bao phủ rake, F&B, payout và payroll.

## Trigger và automation

Snapshot mới và outbox event `owner.daily_digest.snapshot_created` được insert trong cùng
transaction. Nếu hash không đổi thì không tạo outbox event mới. Automation nhận snapshot đã tạo,
format notification và delivery; nó không tính metric.

## Rollback production sau này

- Tắt `owner_daily_digest_settings_v2.enabled`.
- Unschedule global Cron theo runbook được duyệt.
- Giữ nguyên snapshot, generation run và outbox audit.
- Sửa function/RLS bằng migration append-only mới; không sửa migration đã apply.
