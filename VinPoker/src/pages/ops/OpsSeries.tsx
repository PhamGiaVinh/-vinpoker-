import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { ChevronLeft, Monitor, TrendingUp, Gauge, ClipboardCheck } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { vnd, BADGE_META, SI_REPORT, SI_DECISIONS, SI_DECISION_OPTIONS } from "@/components/ops/mock/finData";

/**
 * Trí tuệ Series (mobileOpsV2) — theo bản vẽ đã duyệt SI1/SI2. Đọc báo cáo + ghi quyết định.
 * Doctrine: dự báo là KHOẢNG (P5–P95) + baseline, KHÔNG phải con số điểm; sử liệu mỏng → "giả thuyết".
 * Ghi quyết định = nhật ký phán đoán (KHÔNG phải đường tiền). Phân tích/sinh lịch/Monte-Carlo/xuất = máy tính.
 * DỮ LIỆU MẪU.
 */
const PILLS = [
  { key: "report", label: "Báo cáo" },
  { key: "decide", label: "Quyết định" },
] as const;
type Pill = (typeof PILLS)[number]["key"];

export default function OpsSeries() {
  const navigate = useNavigate();
  const [pill, setPill] = useState<Pill>("report");
  const [decideOpen, setDecideOpen] = useState(false);
  const [confirm, setConfirm] = useState<string | null>(null);
  const r = SI_REPORT;

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Trí tuệ Series</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">{r.series} · <span className="text-[#d8bc85]">hỗ trợ quyết định</span></p>
      </header>

      <div className="flex gap-1.5 px-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm rounded-full px-3.5 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>{p.label}</button>
        ))}
      </div>

      {/* SI1 — Báo cáo */}
      {pill === "report" && (
        <div className="space-y-3">
          <div className="ios-card p-4">
            <div className="text-[13px] text-[#9b8e97]">{r.nextEvent}</div>
            <div className="mt-1 flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[#f2ece6]">Đảm bảo (GTD)</span>
              <span className="font-mono text-[18px] font-bold text-[#d8bc85]">{vnd(r.gtd)}</span>
            </div>
          </div>

          {/* Dự báo entries — KHOẢNG, không phải điểm */}
          <div className="ios-card p-4">
            <div className="flex items-center gap-1.5 text-[13px] text-[#9b8e97]"><TrendingUp className="h-3.5 w-3.5" /> Dự báo lượt tham gia</div>
            <div className="mt-1.5 flex items-baseline gap-2">
              <span className="font-mono text-[28px] font-bold text-sky-300">{r.forecastLow}–{r.forecastHigh}</span>
              <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", BADGE_META.forecast.cls)}>{BADGE_META.forecast.label}</span>
            </div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">thường gặp ~<b className="text-[#f2ece6]">{r.forecastMedian}</b> · khoảng P5–P95, không phải con số chắc chắn</div>
            {/* thanh khoảng dự báo + mốc hòa vốn */}
            <div className="relative mt-3 h-2 rounded-full bg-white/6">
              <div className="absolute inset-y-0 rounded-full bg-sky-400/40" style={{ left: "12%", right: "18%" }} />
              <div className="absolute inset-y-[-3px] w-0.5 bg-amber-300" style={{ left: `${((r.breakeven - 40) / 80) * 100}%` }} />
            </div>
            <div className="mt-1 flex items-center justify-between text-[11px]">
              <span className="text-[#9b8e97]">so với giải trước: <b className="text-[#f2ece6]">{r.baseline}</b> lượt</span>
              <span className="text-amber-300">hòa vốn ~{r.breakeven}</span>
            </div>
            {r.thinHistory && <div className="mt-2 rounded-lg bg-amber-400/8 px-3 py-2 text-[12px] text-amber-300">giả thuyết · chưa đủ dữ liệu để backtest</div>}
          </div>

          {/* Rủi ro overlay */}
          <div className="ios-card p-4">
            <div className="flex items-center gap-1.5 text-[13px] text-[#9b8e97]"><Gauge className="h-3.5 w-3.5" /> Rủi ro phải bù GTD (overlay)</div>
            <div className={cn("mt-1 font-mono text-[24px] font-bold", r.overlayRiskPct > 50 ? "text-rose-300" : r.overlayRiskPct > 25 ? "text-amber-300" : "text-emerald-300")}>{r.overlayRiskPct}%</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">khả năng field không đủ phủ đảm bảo → CLB bù phần thiếu</div>
          </div>

          <DesktopNote text="Nạp CSV, sinh lịch, mô phỏng Monte-Carlo, chỉnh tham số và xuất poster/Excel làm trên máy tính." />
        </div>
      )}

      {/* SI2 — Quyết định */}
      {pill === "decide" && (
        <div className="space-y-3">
          <button onClick={() => setDecideOpen(true)} className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
            <ClipboardCheck className="h-5 w-5 shrink-0" />
            <span><span className="block text-[15px] font-bold">Ghi quyết định GTD</span><span className="block text-[12px] font-normal opacity-80">dựa trên dự báo {r.forecastLow}–{r.forecastHigh} · rủi ro {r.overlayRiskPct}%</span></span>
          </button>
          <div className="ios-card p-4">
            <div className="text-[13px] text-[#9b8e97]">Nhật ký quyết định</div>
            <div className="mt-2 space-y-2.5">
              {SI_DECISIONS.map((d, i) => (
                <div key={i} className="border-l-2 border-[#c9a86a]/40 pl-3">
                  <div className="text-[14px] text-[#f2ece6]">{d.text}</div>
                  <div className="mt-0.5 text-[11px] text-[#7c7079]">{d.who} · {d.when}</div>
                </div>
              ))}
            </div>
          </div>
          <DesktopNote text="Ghi quyết định ở đây là ghi chú phán đoán (không phải chuyển tiền). Phân tích đầy đủ trên máy tính." />
        </div>
      )}

      {/* SI2 — decision picker sheet */}
      <Sheet open={decideOpen} onOpenChange={setDecideOpen}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Ghi quyết định — {r.nextEvent}</SheetTitle></SheetHeader>
          <div className="mt-1 text-center text-[12px] text-[#9b8e97]">dự báo {r.forecastLow}–{r.forecastHigh} (~{r.forecastMedian}) · hòa vốn {r.breakeven} · rủi ro {r.overlayRiskPct}%</div>
          <div className="ios-group mt-3">
            {SI_DECISION_OPTIONS.map((o) => (
              <button key={o} onClick={() => { setDecideOpen(false); setConfirm(o); }}
                className="ios-press-sm ios-row-inset flex w-full items-center px-4 py-3.5 text-left text-[15px] text-[#f2ece6]">{o}</button>
            ))}
          </div>
          <div className="mt-2 text-center text-[12px] text-[#7c7079]">chỉ ghi phán đoán vào nhật ký — không đổi tiền/đảm bảo</div>
        </SheetContent>
      </Sheet>

      {/* decision confirm (restate) */}
      <AlertDialog open={confirm !== null} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
        <AlertDialogContent className="max-w-[340px] rounded-3xl border-white/10 bg-[#0d0913]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#f2ece6]">Ghi vào nhật ký?</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line text-[14px] text-[#c7bcc4]">{r.nextEvent}{"\n"}Quyết định: <b>{confirm}</b>{"\n"}Chỉ là ghi chú phán đoán, không đổi GTD hay tiền.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="ios-press-sm mt-0 rounded-2xl border-white/12 bg-white/5 text-[#f2ece6]">Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => { toast.success("Đã ghi quyết định (bản mẫu)"); setConfirm(null); }}
              className="ios-press rounded-2xl bg-[#c9a86a] font-bold text-[#241A08] hover:bg-[#d8bc85]">Ghi lại</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function DesktopNote({ text }: { text: string }) {
  return (
    <div className="ios-card flex items-start gap-2 p-3.5 text-[12px] text-[#9b8e97]">
      <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-[#9b8e97]" /> <span>{text}</span>
    </div>
  );
}
