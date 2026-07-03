import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { formatVND } from "@/lib/format";
import { MOCK_ALERTS } from "../mock/mockData";
import { ALERT_STATUS_LABEL, type AlertBucket, type AlertSeverity, type AlertStatus, type VarianceItem } from "../mock/types";
import { TabShell } from "../shared/TabShell";

const BUCKET_LABEL: Record<AlertBucket, string> = {
  bank: "Bank",
  cash: "Két tiền mặt",
  payroll: "Lương",
  payout: "Trả thưởng",
  fnb: "F&B",
  staking: "Ký quỹ",
  forecast: "Dự báo",
};

const SEVERITY_CLASS: Record<AlertSeverity, string> = {
  P0: "border-red-500/40 text-red-400 bg-red-500/10",
  P1: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  P2: "border-muted-foreground/40 text-muted-foreground bg-transparent",
};

const STATUS_CLASS: Record<AlertStatus, string> = {
  open: "border-amber-500/40 text-amber-400 bg-amber-500/10",
  investigating: "border-[#378ADD]/40 text-[#378ADD] bg-[#378ADD]/10",
  explained: "border-muted-foreground/40 text-muted-foreground bg-transparent",
};

const SEVERITY_ORDER: Record<AlertSeverity, number> = { P0: 0, P1: 1, P2: 2 };
const STATUS_ORDER: Record<AlertStatus, number> = { open: 0, investigating: 1, explained: 2 };

const chip = "text-[10px] font-semibold px-1.5 py-0.5 rounded-full border tracking-wide";

/** Hàng chờ ngoại lệ CHỈ ĐỌC — không có nút xử lý/đóng cảnh báo nào ở đây. */
export function VarianceAlertsTab({
  onNavigate,
  items = MOCK_ALERTS,
}: {
  onNavigate: (id: string) => void;
  items?: VarianceItem[];
}) {
  const sorted = [...items].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      STATUS_ORDER[a.status] - STATUS_ORDER[b.status],
  );
  const openCount = sorted.filter((i) => i.status !== "explained").length;

  return (
    <TabShell
      title="Cảnh báo lệch số"
      question="Số nào đang không khớp và ai cần xử lý?"
      doctrine={[
        "Chênh lệch là sự thật cần phân loại, không phải con số cần làm biến mất.",
        "Leo thang theo mức độ: P0 xử lý ngay trong ngày · P1 trước khi chốt sổ ngày · P2 trước khi chốt sổ tháng.",
      ]}
    >
      <p className="text-[12px] text-muted-foreground">
        {sorted.length} mục — <span className="text-amber-400 font-semibold">{openCount}</span> chưa
        giải thích xong. Sắp theo mức độ nghiêm trọng, mục đã giải thích xếp cuối.
      </p>

      <div className="space-y-2">
        {sorted.map((item) => (
          <Card key={item.id} className="p-3 space-y-1.5">
            <div className="flex flex-wrap items-center gap-1.5">
              <span className={`${chip} ${SEVERITY_CLASS[item.severity]}`}>{item.severity}</span>
              <span className={`${chip} border-border text-foreground/80 bg-card`}>
                {BUCKET_LABEL[item.bucket]}
              </span>
              {item.sample && (
                <span className={`${chip} border-dashed border-muted-foreground/50 text-muted-foreground bg-transparent`}>
                  Cảnh báo mẫu
                </span>
              )}
            </div>
            <p className="text-sm font-medium text-foreground">{item.title}</p>
            <p className="text-[12px] leading-relaxed text-muted-foreground">{item.detail}</p>
            <div className="flex flex-wrap items-center justify-between gap-x-3 gap-y-1.5 pt-0.5">
              <div className="flex flex-wrap items-center gap-2">
                {item.amount !== undefined && (
                  <span className="text-sm font-semibold tabular-nums text-amber-400">
                    {formatVND(item.amount)}
                  </span>
                )}
                <span className={`${chip} ${STATUS_CLASS[item.status]}`}>
                  {ALERT_STATUS_LABEL[item.status]}
                </span>
              </div>
              <Button
                variant="ghost"
                size="sm"
                className="h-7 px-2 text-[12px] text-primary hover:text-primary"
                onClick={() => onNavigate(item.tabRef)}
              >
                Xem tab →
              </Button>
            </div>
          </Card>
        ))}
      </div>
    </TabShell>
  );
}
