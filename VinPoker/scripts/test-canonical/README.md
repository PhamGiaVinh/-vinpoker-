# VinPoker TEST Canonical Environment V1

Môi trường này dựng schema VinPoker hiện tại bằng dữ liệu tổng hợp, không dùng
production data, production credential hoặc người nhận notification thật.

## Chuẩn bị

```powershell
cd "D:\Quy trình"
powershell -ExecutionPolicy Bypass -File .\VinPoker\scripts\test-canonical\Prepare-VinPokerTestCanonical.ps1 -ResetTarget
```

Script chỉ được phép xóa lại target dùng một lần dưới `.local-data`, copy migration
catalog hiện tại, áp compatibility patch có kiểm tra, bỏ hai artifact được đánh dấu
repair-reverted/owner-gated, thay production URL bằng localhost và quét target.

## Replay, seed và kiểm tra

```powershell
$w = "D:\Quy trình\.local-data\vinpoker-test-canonical-v1"
supabase start --workdir $w --exclude "edge-runtime,imgproxy,logflare,mailpit,postgres-meta,realtime,storage-api,studio,supavisor,vector" --ignore-health-check
supabase db reset --local --workdir $w
docker exec supabase_db_vinpoker-test-canonical-v1 psql -U postgres -d postgres -v ON_ERROR_STOP=1 -f /dev/stdin < .\VinPoker\scripts\test-canonical\validate.sql
```

Trên PowerShell thuần, có thể validate bằng:

```powershell
Get-Content .\VinPoker\scripts\test-canonical\validate.sql -Raw |
  docker exec -i supabase_db_vinpoker-test-canonical-v1 psql -U postgres -d postgres -v ON_ERROR_STOP=1
```

Expected totals:

| Club | Registrations | Attendance | Entries | Staff | Rake | F&B | Pending liabilities | Provisional payroll |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| TEST_CLUB_A | 12 | 12 | 12 | 2 | 1,200,000 | 300,000 | 3,000,000 | 1,500,000 |
| TEST_CLUB_B | 5 | 5 | 5 | 1 | 250,000 | 125,000 | 500,000 | 700,000 |

## Giới hạn

- Đây là local canonical source, chưa phải hosted TEST project dùng chung.
- Supabase CLI local hiện publish API/DB trên mọi interface Docker Desktop; chỉ
  chạy trên máy phát triển tin cậy. Không dùng làm shared TEST endpoint.
- `--ignore-health-check` chỉ bỏ qua analytics không dùng trên Windows; replay, seed và validation
  vẫn dừng ngay khi PostgreSQL hoặc câu lệnh SQL lỗi.
- Không link project, không `db push`, không deploy Edge/Vercel và không gửi notification.
- Tạo hosted TEST project là cổng owner riêng vì phát sinh chi phí định kỳ.
