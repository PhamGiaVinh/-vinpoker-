import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Monitor, AlertTriangle, CheckCircle2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { MockChip } from "@/components/ops/shared/MockChip";
import { vnd, FIN_VARIANCE, FIN_RECON } from "@/components/ops/mock/finData";

/**
 * Tài chính & Đối soát (mobileOpsV2) — theo bản vẽ đã duyệt AC1/AC2. CHỈ XEM.
 * Tên owner-facing LUÔN "Tài chính & Đối soát" — không bao giờ "Kế toán".
 * AC1 = tổng quan đối soát (Tạm tính vs Đã chốt). AC2 = danh sách cảnh báo lệch (kỳ vọng vs thực tế).
 * Cockpit 11 tab đầy đủ (chốt sổ, Event/Series P&L…) = máy tính. DỮ LIỆU MẪU.
 */
const PILLS = [
  { key: "recon", label: "Đối soát" },
  { key: "alerts", label: "Cảnh báo lệch" },
] as const;
type Pill = (typeof PILLS)[number]["key"];

export default function OpsAccounting() {
  const navigate = useNavigate();
  const [pill, setPill] = useState<Pill>("recon");

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-[24px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Tài chính &amp; Đối soát</h1>
          <MockChip />
        </div>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">Hanoi Royal · quản trị · <span className="text-[#d8bc85]">chỉ xem</span></p>
      </header>

      <div className="flex gap-1.5 px-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm rounded-full px-3.5 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            {p.label}{p.key === "alerts" && FIN_RECON.alerts > 0 && <span className="ml-1.5 rounded-full bg-rose-400/20 px-1.5 text-[11px] text-rose-300">{FIN_RECON.alerts}</span>}
          </button>
        ))}
      </div>

      {/* AC1 — Đối soát tổng quan */}
      {pill === "recon" && (
        <div className="space-y-3">
          <div className="grid grid-cols-2 gap-2">
            <div className="ios-card p-3.5">
              <div className="text-[12px] text-[#9b8e97]">Đang tạm tính</div>
              <div className="mt-0.5 font-mono text-[24px] font-bold text-amber-300">{FIN_RECON.provisionalCount}</div>
              <div className="text-[11px] text-[#7c7079]">ngày/giải chưa chốt</div>
            </div>
            <div className="ios-card p-3.5">
              <div className="text-[12px] text-[#9b8e97]">Đã chốt</div>
              <div className="mt-0.5 font-mono text-[24px] font-bold text-emerald-300">{FIN_RECON.finalCount}</div>
              <div className="text-[11px] text-[#7c7079]">chốt gần nhất {FIN_RECON.lastClose}</div>
            </div>
          </div>

          <div className="ios-card p-4">
            <div className="text-[13px] text-[#9b8e97]">Quỹ kỳ vọng vs thực tế</div>
            <div className="mt-2 space-y-2">
              {FIN_VARIANCE.map((v) => {
                const diff = v.actual - v.expected;
                const ok = diff === 0;
                return (
                  <div key={v.label} className="flex items-start gap-2.5">
                    {ok ? <CheckCircle2 className="mt-0.5 h-4 w-4 shrink-0 text-emerald-300" /> : <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0 text-amber-300" />}
                    <div className="min-w-0 flex-1">
                      <div className="text-[13px] text-[#f2ece6]">{v.label}</div>
                      {!ok && <div className="text-[11px] text-[#9b8e97]">{v.note ?? "cần đối soát"}</div>}
                    </div>
                    <div className="text-right">
                      {ok ? <span className="text-[12px] text-emerald-300">khớp</span>
                        : <span className="font-mono text-[13px] font-semibold text-amber-300">lệch {v.label.toLowerCase().includes("chip") ? `${diff} chip` : vnd(diff)}</span>}
                    </div>
                  </div>
                );
              })}
            </div>
          </div>
          <DesktopNote text='Chốt sổ, xử lý lệch và cockpit 11 tab đầy đủ (Event P&L, Series P&L, chênh lệch quỹ…) làm trên máy tính.' />
        </div>
      )}

      {/* AC2 — Cảnh báo lệch (chỉ những dòng ≠ 0) */}
      {pill === "alerts" && (
        <div className="space-y-3">
          {FIN_VARIANCE.filter((v) => v.actual - v.expected !== 0).length === 0 ? (
            <div className="ios-card flex flex-col items-center gap-2 py-10 text-center">
              <CheckCircle2 className="h-8 w-8 text-emerald-300" />
              <div className="text-[15px] text-[#f2ece6]">Không có lệch nào</div>
              <div className="text-[12px] text-[#9b8e97]">mọi quỹ khớp kỳ vọng</div>
            </div>
          ) : (
            <div className="ios-group">
              {FIN_VARIANCE.filter((v) => v.actual - v.expected !== 0).map((v) => {
                const diff = v.actual - v.expected;
                const isChip = v.label.toLowerCase().includes("chip");
                return (
                  <div key={v.label} className="ios-row-inset flex items-start gap-3 px-4 py-3">
                    <AlertTriangle className={cn("mt-0.5 h-5 w-5 shrink-0", Math.abs(diff) > 1_000_000 ? "text-rose-300" : "text-amber-300")} />
                    <div className="min-w-0 flex-1">
                      <div className="text-[14px] text-[#f2ece6]">{v.label}</div>
                      <div className="mt-0.5 font-mono text-[12px] text-[#9b8e97]">kỳ vọng {isChip ? v.expected : vnd(v.expected)} → thực {isChip ? v.actual : vnd(v.actual)}</div>
                      {v.note && <div className="mt-0.5 text-[11px] text-[#9b8e97]">{v.note}</div>}
                    </div>
                    <span className={cn("shrink-0 font-mono text-[13px] font-semibold", Math.abs(diff) > 1_000_000 ? "text-rose-300" : "text-amber-300")}>lệch {isChip ? `${diff} chip` : vnd(diff)}</span>
                  </div>
                );
              })}
            </div>
          )}
          <DesktopNote text="Đối soát chi tiết, ghi điều chỉnh và chốt sổ làm trên máy tính — đây chỉ liệt kê cảnh báo." />
        </div>
      )}
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
