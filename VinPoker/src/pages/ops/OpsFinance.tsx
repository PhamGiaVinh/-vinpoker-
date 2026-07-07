import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { ChevronLeft, Monitor, Info } from "lucide-react";
import { cn } from "@/lib/utils";
import {
  vnd, BADGE_META, FIN_RANGES, FIN_SUMMARY, FIN_EVENTS, type Badge,
} from "@/components/ops/mock/finData";

/**
 * Tài chính (mobileOpsV2) — theo bản vẽ đã duyệt T1/T2. CHỈ XEM (read-only), không nút chuyển tiền.
 * Doctrine kế toán quản trị (vinpoker-business-quant):
 *  · Doanh thu giữ lại (phí) TÁCH khỏi Tiền qua tay (giải thưởng người chơi = pass-through, KHÔNG phải doanh thu).
 *  · Bù đắp GTD là 1 dòng riêng. Chi phí liệt kê từng dòng.
 *  · "Biên đóng góp (chưa trừ vận hành chung)" — KHÔNG gọi lợi nhuận.
 *  · Badge Tạm tính / Đã chốt. Lọc sâu + xuất Excel = máy tính.
 * DỮ LIỆU MẪU.
 */
const PILLS = [
  { key: "overview", label: "Tổng quan" },
  { key: "events", label: "Theo giải" },
] as const;
type Pill = (typeof PILLS)[number]["key"];

function BadgePill({ b }: { b: Badge }) {
  const m = BADGE_META[b];
  return <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", m.cls)}>{m.label}</span>;
}

export default function OpsFinance() {
  const navigate = useNavigate();
  const [pill, setPill] = useState<Pill>("overview");
  const [range, setRange] = useState<string>(FIN_RANGES[2]);

  const costTotal = FIN_SUMMARY.costs.reduce((s, c) => s + c.value, 0);
  const contribution = FIN_SUMMARY.retainedFee + costTotal; // costs are negative

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Tài chính</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">Hanoi Royal · quản trị · <span className="text-[#d8bc85]">chỉ xem</span></p>
      </header>

      <div className="flex gap-1.5 px-1">
        {FIN_RANGES.map((r) => (
          <button key={r} onClick={() => setRange(r)}
            className={cn("ios-press-sm rounded-full px-3 py-1 text-[12px]", range === r ? "bg-white/12 text-[#f2ece6]" : "bg-white/5 text-[#9b8e97]")}>{r}</button>
        ))}
      </div>

      <div className="flex gap-1.5 px-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm rounded-full px-3.5 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>{p.label}</button>
        ))}
      </div>

      {/* T1 — Tổng quan */}
      {pill === "overview" && (
        <div className="space-y-3">
          {/* Câu hỏi số 1: giữ lại được bao nhiêu từ phí */}
          <div className="ios-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[13px] text-[#9b8e97]">Doanh thu giữ lại (phí) · {range}</span>
              <BadgePill b="provisional" />
            </div>
            <div className="mt-1 font-mono text-[30px] font-bold text-emerald-300">{vnd(FIN_SUMMARY.retainedFee)}</div>
            <div className="mt-1 text-[12px] text-[#9b8e97]">phần CLB thực sự giữ lại — chưa gồm tiền giải thưởng của người chơi</div>
          </div>

          {/* Tiền qua tay — pass-through, KHÔNG phải doanh thu */}
          <div className="rounded-2xl border border-white/8 bg-white/[0.02] p-4">
            <div className="flex items-center gap-1.5 text-[13px] text-[#9b8e97]"><Info className="h-3.5 w-3.5" /> Tiền qua tay — giải thưởng người chơi</div>
            <div className="mt-1 font-mono text-[20px] font-semibold text-[#c7bcc4]">{vnd(FIN_SUMMARY.passThrough)}</div>
            <div className="mt-0.5 text-[12px] text-[#7c7079]">tiền của người chơi, CLB giữ hộ rồi trả lại — <b>không phải doanh thu</b></div>
          </div>

          {/* Chi phí trực tiếp từng dòng → biên đóng góp */}
          <div className="ios-card p-4">
            <div className="text-[13px] text-[#9b8e97]">Chi phí trực tiếp</div>
            <div className="mt-2 space-y-1">
              {FIN_SUMMARY.costs.map((c) => (
                <div key={c.label} className="flex items-center justify-between py-0.5 text-[14px]">
                  <span className="text-[#f2ece6]">{c.label}</span>
                  <span className="font-mono text-rose-300">{vnd(c.value)}</span>
                </div>
              ))}
              {!FIN_SUMMARY.fnbEnabled && (
                <div className="flex items-center justify-between py-0.5 text-[14px]">
                  <span className="text-[#7c7079]">Doanh thu F&B</span>
                  <span className="text-[12px] text-[#7c7079]">chưa bật</span>
                </div>
              )}
              <div className="my-1.5 border-t border-white/8" />
              <div className="flex items-center justify-between">
                <span className="text-[14px] font-semibold text-[#f2ece6]">Biên đóng góp</span>
                <span className={cn("font-mono text-[18px] font-bold", contribution >= 0 ? "text-emerald-300" : "text-rose-300")}>{vnd(contribution)}</span>
              </div>
              <div className="text-[11px] text-[#7c7079]">chưa trừ chi phí vận hành chung (mặt bằng, điện, quản lý) — <b>không phải lợi nhuận</b></div>
            </div>
          </div>

          <DesktopNote text="Lọc theo ngày tuỳ chọn, tách theo CLB và xuất Excel làm trên máy tính." />
        </div>
      )}

      {/* T2 — Theo giải */}
      {pill === "events" && (
        <div className="space-y-3">
          {FIN_EVENTS.map((e) => (
            <div key={e.name} className="ios-card p-4">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold text-[#f2ece6]">{e.name} <span className="text-[12px] font-normal text-[#9b8e97]">· {e.date}</span></span>
                <BadgePill b={e.badge} />
              </div>
              <div className="mt-2 space-y-1 text-[14px]">
                <Line l="Doanh thu giữ lại (phí)" v={vnd(e.retained)} vCls="text-emerald-300" />
                {e.gtdSubsidy < 0 && <Line l="Bù đắp đảm bảo GTD" v={vnd(e.gtdSubsidy)} vCls="text-rose-300" />}
                <Line l="Biên đóng góp" v={vnd(e.contribution)} vCls={e.contribution >= 0 ? "text-emerald-300" : "text-rose-300"} bold />
              </div>
              <div className={cn("mt-2 rounded-xl px-3 py-2 text-[12px]", e.entries >= e.breakeven ? "bg-emerald-400/8 text-emerald-300" : "bg-amber-400/8 text-amber-300")}>
                Hòa vốn cần <b>{e.breakeven}</b> lượt · đạt <b>{e.entries}</b> {e.entries >= e.breakeven ? "✓ vượt hòa vốn" : `· còn thiếu ${e.breakeven - e.entries}`}
              </div>
            </div>
          ))}
          <DesktopNote text="P&L chi tiết từng dòng, so sánh nhiều kỳ và xuất báo cáo làm trên máy tính." />
        </div>
      )}
    </div>
  );
}

function Line({ l, v, vCls, bold }: { l: string; v: string; vCls?: string; bold?: boolean }) {
  return (
    <div className="flex items-center justify-between">
      <span className={cn(bold ? "font-semibold text-[#f2ece6]" : "text-[#9b8e97]")}>{l}</span>
      <span className={cn("font-mono", bold && "text-[16px] font-bold", vCls ?? "text-[#f2ece6]")}>{v}</span>
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
