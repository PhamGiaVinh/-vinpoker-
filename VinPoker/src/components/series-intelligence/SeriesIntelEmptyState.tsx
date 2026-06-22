import { Sparkles, Upload, FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";

/**
 * SeriesIntelEmptyState — the "Bắt đầu tại đây" call-to-action shown when no series is loaded. Guides the owner
 * to load data so the analysis steps (②–④) come alive. Pure presentational; both buttons call handlers from the
 * page (which reuse the EXISTING upload + sample-CSV pipeline — no new data/logic). PokerVN / Stitch Dark.
 */
export function SeriesIntelEmptyState({ onUpload, onSample }: { onUpload: () => void; onSample: () => void }) {
  return (
    <Card className="p-5 gradient-card border-primary/40 text-center space-y-3">
      <div className="mx-auto grid place-items-center h-11 w-11 rounded-full bg-primary/15 text-primary">
        <Sparkles className="h-5 w-5" />
      </div>
      <div className="space-y-1">
        <h3 className="font-display text-lg">Bắt đầu tại đây</h3>
        <p className="mx-auto max-w-md text-xs text-muted-foreground">
          Nạp dữ liệu các series đã chạy (file CSV) để xem CLB của bạn từng đông thế nào, rủi ro ở đâu — rồi lên
          lịch &amp; kiểm rủi ro cho mùa tới. Dữ liệu chỉ nằm trên trình duyệt này, không lưu hệ thống.
        </p>
      </div>
      <div className="flex flex-wrap items-center justify-center gap-2">
        <Button size="sm" className="gap-2" onClick={onUpload}>
          <Upload className="h-4 w-4" /> Tải lên CSV
        </Button>
        <Button size="sm" variant="outline" className="gap-2" onClick={onSample}>
          <FlaskConical className="h-4 w-4" /> Dùng dữ liệu mẫu
        </Button>
      </div>
      <p className="text-[10px] text-muted-foreground/80">
        Chưa có file? Bấm “Dùng dữ liệu mẫu” để xem thử dashboard với một series mẫu.
      </p>
    </Card>
  );
}
