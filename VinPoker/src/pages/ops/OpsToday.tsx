import { useNavigate } from "react-router-dom";
import { ChevronRight, LayoutGrid, Radio, AlertTriangle, Lock } from "lucide-react";
import { OperationStatusChip, type OpStatus } from "@/components/ops/shared/OperationStatusChip";
import {
  MOCK_TOURNAMENT,
  MOCK_TABLE_COUNTS,
  MOCK_NEXT_TASK,
  MOCK_ALERTS,
} from "@/components/ops/mock/floorToday";

/**
 * "Floor hôm nay" — cockpit mở đầu mobileOpsV2 (WF1), phong cách native-iOS: large title, hero LIVE có
 * glow + pulse, dải chỉ số grouped, CTA vàng tactile, danh sách "cần xử lý" inset grouped.
 * READ-ONLY · DỮ LIỆU MẪU · KHÔNG thao tác tiền. Spec §1.
 */
const COUNTS: { key: keyof typeof MOCK_TABLE_COUNTS; label: string; tone: string }[] = [
  { key: "running", label: "Chạy", tone: "text-emerald-300" },
  { key: "open", label: "Mở", tone: "text-[#d8bc85]" },
  { key: "paused", label: "Dừng", tone: "text-amber-300" },
  { key: "closed", label: "Đóng", tone: "text-[#9b8e97]" },
];
const ALERT_STATUS: Record<string, OpStatus> = { todo: "todo", late: "late", provisional: "provisional" };

const WD = ["Chủ nhật", "Thứ hai", "Thứ ba", "Thứ tư", "Thứ năm", "Thứ sáu", "Thứ bảy"];

export default function OpsToday() {
  const navigate = useNavigate();
  const now = new Date();
  const dateLabel = `${WD[now.getDay()]} · ${now.getDate()} tháng ${now.getMonth() + 1}`;
  const t = MOCK_TOURNAMENT;

  return (
    <div className="ios-in space-y-6 pt-2">
      {/* Large title */}
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Hôm nay</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">{dateLabel}</p>
      </header>

      {/* LIVE hero — peak moment */}
      <section className="ios-glow">
        <div className="ios-card overflow-hidden p-5">
          <div className="flex items-center gap-2">
            <span className="relative flex h-2.5 w-2.5">
              <span className="ios-pulse absolute inline-flex h-full w-full rounded-full bg-emerald-400" />
              <span className="relative inline-flex h-2.5 w-2.5 rounded-full bg-emerald-400" />
            </span>
            <span className="text-[13px] font-semibold uppercase tracking-[0.14em] text-emerald-300">Trực tiếp</span>
            <span className="ml-auto text-[13px] text-[#9b8e97]">Còn {t.remaining}/{t.total}</span>
          </div>

          <h2 className="mt-2 text-[19px] font-semibold text-[#f2ece6]">{t.name}</h2>

          <div className="mt-3 flex items-end gap-3">
            <div className="leading-none">
              <div className="text-[11px] uppercase tracking-wider text-[#9b8e97]">Level</div>
              <div className="mt-1 font-mono text-[44px] font-bold leading-none text-[#c9a86a] [text-shadow:0_2px_16px_rgba(201,168,106,0.35)]">
                {t.level}
              </div>
            </div>
            <div className="mb-1 flex-1 text-[15px] text-[#c8bcc4]">
              <div className="font-mono text-[#f2ece6]">{t.blinds}</div>
              <div className="text-[13px] text-[#9b8e97]">ante {t.ante} · TB {t.avgStack}</div>
              <div className="text-[13px] text-[#9b8e97]">⏱ {t.timeToBreak} tới nghỉ</div>
            </div>
          </div>

          <div className="mt-4 flex items-center gap-2.5">
            <button
              onClick={() => navigate("/ops/tables")}
              className="ios-press ios-tinted flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-[15px] font-semibold"
            >
              <LayoutGrid className="h-[18px] w-[18px]" /> Sơ đồ bàn
            </button>
            <button className="ios-press ios-fill flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6]">
              <Radio className="h-[18px] w-[18px] text-sky-300" /> Trực tiếp
            </button>
          </div>
          <div className="mt-2.5 flex items-center justify-center gap-1 text-[12px] text-[#7c7079]">
            <Lock className="h-3 w-3" /> Sửa blind/level — mở trên máy tính
          </div>
        </div>
      </section>

      {/* Table counts — grouped strip */}
      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Bàn</h3>
        <div className="ios-card grid grid-cols-4 divide-x divide-white/6 p-1">
          {COUNTS.map((c) => (
            <div key={c.key} className="px-1 py-2.5 text-center">
              <div className={`font-mono text-[26px] font-semibold leading-none ${c.tone}`}>
                {MOCK_TABLE_COUNTS[c.key]}
              </div>
              <div className="mt-1.5 text-[11px] text-[#9b8e97]">{c.label}</div>
            </div>
          ))}
        </div>
      </section>

      {/* Việc kế tiếp — accent card with tactile CTA */}
      <section className="ios-card overflow-hidden">
        <div className="flex items-start gap-3 p-4">
          <span className="mt-0.5 grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400/14 text-amber-300">
            <AlertTriangle className="h-[18px] w-[18px]" />
          </span>
          <div className="min-w-0">
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[#9b8e97]">Việc kế tiếp</div>
            <div className="mt-0.5 text-[16px] font-semibold leading-snug text-[#f2ece6]">{MOCK_NEXT_TASK.title}</div>
            <div className="mt-0.5 text-[13px] text-[#9b8e97]">{MOCK_NEXT_TASK.context}</div>
          </div>
        </div>
        <button
          onClick={() => navigate("/ops/alerts")}
          className="ios-press ios-primary m-4 mt-0 flex w-[calc(100%-2rem)] items-center justify-center gap-1 rounded-2xl py-3.5 text-[16px] font-bold"
        >
          Xử lý ngay <ChevronRight className="h-[18px] w-[18px]" strokeWidth={2.6} />
        </button>
      </section>

      {/* Cần xử lý — inset grouped list */}
      <section>
        <div className="mb-2 flex items-center justify-between px-1">
          <h3 className="text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">
            Cần xử lý ({MOCK_ALERTS.length})
          </h3>
          <button onClick={() => navigate("/ops/alerts")} className="ios-press-sm text-[14px] text-[#c9a86a]">
            Tất cả
          </button>
        </div>
        <div className="ios-group">
          {MOCK_ALERTS.map((a) => (
            <button
              key={a.id}
              onClick={() => navigate("/ops/alerts")}
              className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 text-left"
            >
              <span className="flex-1 truncate py-3.5 text-[16px] text-[#f2ece6]">{a.subject}</span>
              <OperationStatusChip status={ALERT_STATUS[a.status]} />
              <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#5f545c]" />
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
