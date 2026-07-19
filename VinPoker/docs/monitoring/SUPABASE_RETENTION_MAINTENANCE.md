# Supabase retention maintenance — owner-gated runbook

Status: source-only. Không có bước nào trong tài liệu này đã được chạy trên production.

## Mục tiêu và giới hạn

Đợt này chỉ xóa log/kế hoạch đã hết hạn theo batch tối đa 5.000 dòng. Không xóa trạng thái rotation đang sống (`predicted`, `announced`, `executing`) và không xóa cron còn `running`/`connecting`.

Không dùng `TRUNCATE`, `VACUUM FULL`, `db push` hoặc deploy tự động. `net._http_response` không nằm trong cleanup này.

## Thứ tự rollout bắt buộc

1. Theo dõi PR1 và PR2 đủ 24 giờ; project phải liên tục `ACTIVE_HEALTHY`.
2. Owner tạo backup và ghi lại CPU/RAM, disk trống, kích thước bốn relation.
3. Apply migration `20270103000003_retention_cleanup_functions.sql`. Migration này chưa schedule và chưa xóa dữ liệu.
4. Chạy riêng statement trong `supabase/maintenance/20270103000000_cron_run_details_index.sql`; không bọc transaction.
5. Xác nhận index trả về đúng tên:

   ```sql
   SELECT to_regclass('cron.idx_job_run_details_start_time');
   ```

6. Trên TEST/disposable DB, chạy các SQL contract test retention. Trên production, owner chạy từng function một lần và kiểm tra `deleted <= 5000`:

   ```sql
   SELECT public.cleanup_next_dealer_rotation_schedule(5000);
   SELECT public.cleanup_cron_job_run_details(5000);
   SELECT public.cleanup_diagnostic_logs(5000);
   SELECT public.cleanup_next_cron_metrics(5000);
   ```

7. Kiểm tra không có live rotation state hoặc cron đang chạy bị xóa. Nếu đúng, apply migration `20270103000004_retention_cleanup_schedules.sql` để bật bốn job hourly đã stagger.
8. Sau batch đầu, chạy từng statement trong `20270103000001_retention_post_cleanup_vacuum.sql` riêng lẻ.
9. Theo dõi cron failure, lock wait, CPU/RAM và tốc độ giảm dead tuples trong 24 giờ tiếp theo.

## Dừng và rollback

Nếu có lock wait kéo dài, cron failed/connecting tăng, hoặc dữ liệu live bị ảnh hưởng, owner unschedule ngay:

```sql
SELECT cron.unschedule(jobid)
FROM cron.job
WHERE jobname IN (
  'retention-rotation-schedule',
  'retention-cron-job-runs',
  'retention-diagnostic-logs',
  'retention-cron-metrics'
);
```

Không thể “undo” row đã cleanup bằng rollback function; phục hồi cần backup. Vì vậy schedule chỉ được bật sau canary batch và đối soát.

## Cổng pg_repack

Chạy script assessment read-only `20270103000002_pg_repack_assessment.sql`, rồi kiểm tra disk trống trong Supabase Dashboard. Chỉ tiếp tục nếu:

- extension available từ version 1.5.2 trở lên;
- target có primary key/unique total index phù hợp;
- disk trống ít nhất gấp đôi tổng kích thước table + indexes;
- không có DDL khác chạy trên target;
- owner duyệt maintenance window và rollback.

Theo tài liệu Supabase, enable extension trong Dashboard, cài `pg_repack` CLI tương thích và luôn dùng `-k` vì Supabase không cấp superuser. Chạy tuần tự từng table, không chạy song song:

```text
pg_repack -k -h db.<PROJECT_REF>.supabase.co -p 5432 -U postgres -d postgres --no-order --table public.dealer_rotation_schedule
pg_repack -k -h db.<PROJECT_REF>.supabase.co -p 5432 -U postgres -d postgres --no-order --table cron.job_run_details
```

Không ghi database password vào command, file, terminal history hoặc PR. Tham chiếu: [Supabase pg_repack](https://supabase.com/docs/guides/database/extensions/pg_repack).
