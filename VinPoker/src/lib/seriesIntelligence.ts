// Club Admin → "Series Intelligence" demo entry (frontend-only shell).
// Static owner-facing content only — no engine, no data, no backend. The screen
// just explains the Club Intelligence flow (CSV → Data Readiness → Economics
// Mini Audit → Series Workflow) so it feels native inside VinPoker Club Admin.

export const SERIES_INTEL = {
  title: 'Series Intelligence',
  subtitle: 'Chuẩn bị dữ liệu, kiểm tra độ sẵn sàng và theo dõi quy trình vận hành series.',
  cardLabel: 'Trí tuệ vận hành Series',
  cardDescription: 'Kiểm tra dữ liệu, đọc số gộp từ CSV và theo dõi quy trình vận hành series.',
  safetyBoundary:
    'Các số liệu được tính trực tiếp từ CSV đã tải lên. Đây không phải dự báo, không tự giải thích vì sao các con số xảy ra, và không thay thế báo cáo kế toán.',
  previewNote: 'Bản demo nội bộ — chưa bật trong menu Club Admin.',
  steps: [
    { n: 1, label: 'Chuẩn bị file CSV', desc: 'Gom dữ liệu các sự kiện trong series theo đúng các cột bên dưới.' },
    { n: 2, label: 'Upload & kiểm tra Data Readiness', desc: 'Tải CSV lên, xem mức độ sẵn sàng và các lỗi cần sửa trước.' },
    { n: 3, label: 'Đọc Tournament Economics Mini Audit', desc: 'Xem các số gộp tính trực tiếp từ CSV cho từng sự kiện.' },
    {
      n: 4,
      label: 'Theo dõi Workflow trước / trong / sau series',
      desc: 'Đi theo checklist chuẩn bị, vận hành hằng ngày và rà soát sau series.',
    },
  ],
  requiredColumns: [
    'event_name',
    'event_date',
    'buy_in',
    'fee',
    'gtd',
    'prize_pool_actual',
    'total_entries',
    'unique_entries',
    'reentries',
  ],
  eventIdNote: 'event_id — chỉ là tham chiếu nội bộ để đối chiếu, chưa dùng để tính toán.',
  demoNotes: [
    'Bản demo hiện chạy bằng CSV local, chưa lưu dữ liệu lên hệ thống.',
    'Dữ liệu thật sẽ được đưa vào sau khi pilot xác nhận quy trình.',
  ],
  ctaDisabledLabel: 'Demo CSV sẽ được kết nối sau',
} as const;
