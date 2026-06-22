import { useRef, useState, type ReactNode } from "react";
import { FileImage, FileSpreadsheet } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import type { ScheduleEvent } from "@/lib/series-intelligence/scheduleGenerator";
import { SchedulePosterDocument } from "@/components/series-intelligence/SchedulePosterDocument";
import { exportScheduleExcel, slugify, type SchedulePosterHeader } from "@/lib/series-intelligence/scheduleExport";
import { captureNodeToPng } from "@/lib/series-intelligence/exportSchedulePng";

/**
 * ScheduleExportPanel — Step ⑤ (export happens AFTER the risk check). Lifted out of ScheduleGeneratorPanel;
 * reads the lifted `draft` via props. The poster/Excel logic is IDENTICAL — only the data source moved. Owner
 * types all header fields; the poster carries a DRAFT footer until "Đã TD review" is switched on.
 */
export function ScheduleExportPanel({ draft }: { draft: ScheduleEvent[] | null }) {
  const [poster, setPoster] = useState<SchedulePosterHeader>({});
  const [published, setPublished] = useState(false);
  const [pngBusy, setPngBusy] = useState(false);
  const posterRef = useRef<HTMLDivElement>(null);

  const setPosterField = (k: keyof SchedulePosterHeader, v: string): void => setPoster((p) => ({ ...p, [k]: v }));
  const downloadPng = async (): Promise<void> => {
    if (!draft || !posterRef.current) return;
    setPngBusy(true);
    try {
      await captureNodeToPng(posterRef.current, `${slugify(poster.title?.trim() || "lich-festival")}-poster`);
    } finally {
      setPngBusy(false);
    }
  };
  const downloadExcel = (): void => {
    if (!draft) return;
    exportScheduleExcel(draft, poster);
  };

  return (
    <Card className="p-3 border-primary/40 space-y-2 text-xs">
      <div className="flex items-center gap-1.5 font-medium">
        <FileImage className="h-3.5 w-3.5 text-primary" /> Xuất lịch (poster PNG + Excel)
      </div>
      {!draft ? (
        <p className="text-[11px] text-muted-foreground border border-dashed border-border rounded-md p-3">
          Hãy <strong>Sinh lịch</strong> ở Bước ③ trước, rồi quay lại đây để xuất poster &amp; Excel.
        </p>
      ) : (
        <>
          <p className="text-[10px] text-muted-foreground">Bạn tự nhập tiêu đề/địa điểm/ngày. Poster mặc định dán nhãn <span className="text-warning">DRAFT</span>; bật "đã TD review" để xuất bản chính thức.</p>
          <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
            <Field label="Tên giải"><Input className="h-7" placeholder="VD: VinPoker Summer Series" value={poster.title ?? ""} onChange={(e) => setPosterField("title", e.target.value)} /></Field>
            <Field label="Phụ đề (tùy chọn)"><Input className="h-7" value={poster.subtitle ?? ""} onChange={(e) => setPosterField("subtitle", e.target.value)} /></Field>
            <Field label="Địa điểm (tùy chọn)"><Input className="h-7" value={poster.venue ?? ""} onChange={(e) => setPosterField("venue", e.target.value)} /></Field>
            <Field label="Ngày bắt đầu (tùy chọn)"><Input type="date" className="h-7" value={poster.startDate ?? ""} onChange={(e) => setPosterField("startDate", e.target.value)} /></Field>
            <Field label="Ghi chú chân trang (tùy chọn)"><Input className="h-7" value={poster.footer ?? ""} onChange={(e) => setPosterField("footer", e.target.value)} /></Field>
          </div>
          <div className="flex items-center gap-2 pt-0.5">
            <Switch checked={published} onCheckedChange={setPublished} />
            <Label className="text-[11px]">Đã TD review · xuất bản chính thức <span className="text-muted-foreground">(gỡ nhãn DRAFT)</span></Label>
          </div>
          <div className="flex flex-wrap gap-2">
            <Button size="sm" className="gap-1.5" onClick={downloadPng} disabled={pngBusy}>
              <FileImage className="h-4 w-4" /> {pngBusy ? "Đang tạo PNG…" : "Tải PNG (poster)"}
            </Button>
            <Button size="sm" variant="outline" className="gap-1.5" onClick={downloadExcel}>
              <FileSpreadsheet className="h-4 w-4" /> Tải Excel
            </Button>
          </div>
          <p className="text-[10px] text-muted-foreground/80">Xem trước poster thật (rộng 960px — cuộn ngang/dọc). PNG chụp đúng khung này.</p>
          <div className="overflow-auto rounded-md border border-border/60" style={{ maxHeight: 480 }}>
            <SchedulePosterDocument ref={posterRef} events={draft} header={poster} published={published} />
          </div>
        </>
      )}
    </Card>
  );
}

function Field({ label, children }: { label: string; children: ReactNode }) {
  return (
    <label className="flex flex-col gap-0.5">
      <span className="text-[10px] text-muted-foreground">{label}</span>
      {children}
    </label>
  );
}
