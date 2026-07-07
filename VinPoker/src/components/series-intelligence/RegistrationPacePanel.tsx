import { useState } from "react";
import { Users, AlertTriangle, FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { registrationPace, type RegPaceStatus } from "@/lib/series-intelligence/registrationPace";
import { ExplainHint } from "./ExplainHint";

const numOrNull = (s: string): number | null => (s.trim() === "" ? null : Number(s));

const STATUS_TONE: Record<RegPaceStatus, string> = {
  behind: "border-warning/50 bg-warning/10 text-warning",
  ahead: "border-primary/50 bg-primary/10 text-primary",
  "on-track": "border-primary/40 bg-primary/5 text-primary",
  unknown: "border-border bg-card/40 text-muted-foreground",
};
const STATUS_LABEL: Record<RegPaceStatus, string> = {
  behind: "Đang chậm",
  ahead: "Đang nhanh",
  "on-track": "Đúng nhịp",
  unknown: "Chưa đủ dữ liệu",
};

/**
 * W6 — registration-pace check. Before a giải: compare sign-ups-so-far to a CRUDE linear pace toward the
 * forecast, so the owner spots "đang chậm → đẩy bài/satellite" early. All inputs owner-entered; the pace
 * reference is an honest crude assumption (real sign-up back-loads) stated plainly. Gated seriesRegistrationPace.
 */
export function RegistrationPacePanel() {
  const [forecast, setForecast] = useState<number | null>(null);
  const [current, setCurrent] = useState<number | null>(null);
  const [daysOpen, setDaysOpen] = useState<number | null>(null);
  const [daysLeft, setDaysLeft] = useState<number | null>(null);

  const r =
    current !== null
      ? registrationPace({ forecast, current, daysOpen: daysOpen ?? 0, daysLeft: daysLeft ?? 0 })
      : null;

  return (
    <Card className="p-3 border-primary/30 space-y-2.5 text-xs">
      <div className="flex flex-wrap items-center gap-1.5 font-display text-base">
        <Users className="h-4 w-4 text-primary" /> Nhịp đăng ký vs dự báo
        <span className="inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] text-warning">
          <FlaskConical className="h-2.5 w-2.5" /> Giả thuyết
        </span>
      </div>
      <p className="text-[10px] text-muted-foreground">
        Trước giải, xem đăng ký có theo kịp dự báo không → phát hiện sớm để đẩy bài / mở satellite. Chỉ dùng cho
        giải có đăng ký online.
      </p>

      <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Đăng ký hiện tại</span>
          <Input type="number" className="h-8" value={current ?? ""} onChange={(e) => setCurrent(numOrNull(e.target.value))} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Dự báo cuối</span>
          <Input type="number" className="h-8" placeholder="(vd 170)" value={forecast ?? ""} onChange={(e) => setForecast(numOrNull(e.target.value))} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Đã mở (ngày)</span>
          <Input type="number" className="h-8" value={daysOpen ?? ""} onChange={(e) => setDaysOpen(numOrNull(e.target.value))} />
        </label>
        <label className="flex flex-col gap-0.5">
          <span className="text-[10px] text-muted-foreground">Còn (ngày)</span>
          <Input type="number" className="h-8" value={daysLeft ?? ""} onChange={(e) => setDaysLeft(numOrNull(e.target.value))} />
        </label>
      </div>

      {r && (
        <div className={cn("rounded-md border p-2 space-y-1.5", STATUS_TONE[r.status])}>
          <div className="flex items-center justify-between gap-2">
            <span className="font-medium">{STATUS_LABEL[r.status]}</span>
            {r.pctOfForecast !== null && <span className="tabular-nums text-[11px]">{r.pctOfForecast}% dự báo</span>}
          </div>
          {r.linearExpected !== null && (
            <div className="h-2 w-full overflow-hidden rounded-full bg-muted/40">
              {/* current fill vs the crude linear marker */}
              <div
                className="h-full rounded-full bg-primary/70"
                style={{ width: `${forecast && forecast > 0 ? Math.min(100, ((current ?? 0) / forecast) * 100) : 0}%` }}
              />
            </div>
          )}
          <div className="text-[11px] leading-relaxed text-foreground/90">{r.headline}</div>
          {r.status === "behind" && (
            <div className="flex items-start gap-1 text-[10px]">
              <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" /> Cân nhắc đẩy 1 bài truyền thông hoặc mở satellite, rồi theo dõi lại sau 24 giờ.
            </div>
          )}
          <div className="text-[10px] text-muted-foreground/90">{r.caveat}</div>
        </div>
      )}

      <ExplainHint term="nhịp đăng ký">
        So số đăng ký hiện tại với một <b>mốc thô</b> (giả định đăng ký rải đều theo thời gian) tính từ dự báo cuối.
        Vì poker hay dồn cuối, "chậm ở giữa" thường không đáng lo — chỉ dùng như đèn nhắc để hành động sớm, không
        phải con số chắc chắn.
      </ExplainHint>
    </Card>
  );
}
