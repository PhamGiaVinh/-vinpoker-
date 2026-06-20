import { useState } from "react";
import { ChevronDown, Settings, CalendarIcon, FileSpreadsheet, DollarSign, Send, List } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

interface Props {
  onOpenSwingConfig: () => void;
  onOpenSpecialDates: () => void;
  onExportShift: () => void;
  onExportPayroll: () => void;
  onTestTelegram: () => void;
  onViewFullAuditLog: () => void;
}

export default function QuickLinksCard({
  onOpenSwingConfig, onOpenSpecialDates,
  onExportShift, onExportPayroll,
  onTestTelegram, onViewFullAuditLog,
}: Props) {
  const [open, setOpen] = useState(false);

  return (
    <div className="border border-border rounded-sm">
      <button
        onClick={() => setOpen(!open)}
        className="w-full flex items-center justify-between px-2.5 py-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground hover:text-foreground transition-colors"
      >
        <span>Liên kết nhanh</span>
        <ChevronDown className={cn("w-3 h-3 transition-transform", open && "rotate-180")} />
      </button>

      {open && (
        <div className="px-2 pb-2 space-y-0.5">
          <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pt-1 pb-0.5">
            Cấu hình
          </div>
          <Button size="sm" variant="ghost" className="w-full justify-start text-[11px] h-7" onClick={onOpenSwingConfig}>
            <Settings className="w-3 h-3 mr-1.5" /> Cấu hình Swing
          </Button>
          <Button size="sm" variant="ghost" className="w-full justify-start text-[11px] h-7" onClick={onOpenSpecialDates}>
            <CalendarIcon className="w-3 h-3 mr-1.5" /> Ngày đặc biệt
          </Button>

          <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pt-1 pb-0.5">
            Báo cáo
          </div>
          <Button size="sm" variant="ghost" className="w-full justify-start text-[11px] h-7" onClick={onExportShift}>
            <FileSpreadsheet className="w-3 h-3 mr-1.5" /> Xuất báo cáo ca
          </Button>
          <Button size="sm" variant="ghost" className="w-full justify-start text-[11px] h-7" onClick={onExportPayroll}>
            <DollarSign className="w-3 h-3 mr-1.5" /> Mở bảng lương
          </Button>

          <div className="text-[9px] font-semibold text-muted-foreground uppercase tracking-wider pt-1 pb-0.5">
            Công cụ
          </div>
          <Button size="sm" variant="ghost" className="w-full justify-start text-[11px] h-7" onClick={onTestTelegram}>
            <Send className="w-3 h-3 mr-1.5" /> Gửi Telegram test
          </Button>
          <Button size="sm" variant="ghost" className="w-full justify-start text-[11px] h-7" onClick={onViewFullAuditLog}>
            <List className="w-3 h-3 mr-1.5" /> Nhật ký đầy đủ
          </Button>
        </div>
      )}
    </div>
  );
}
