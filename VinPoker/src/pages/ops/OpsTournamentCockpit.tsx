import { useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { ChevronLeft, Lock, Radio, UserMinus, ArrowRightLeft, Coins, Plus, TrendingUp, Search } from "lucide-react";
import { cn } from "@/lib/utils";
import { RoomGrid } from "@/components/ops/shared/RoomGrid";
import { PlayerActionSheets, type PlayerTarget } from "@/components/ops/shared/PlayerActionSheets";
import {
  MOCK_TOURNAMENT, MOCK_TOURNAMENT_LIST, MOCK_TABLES, MOCK_SEATS, MOCK_LEVELS, MOCK_PAYOUTS, MOCK_HISTORY,
  type MockTable,
} from "@/components/ops/mock/opsData";

/**
 * Cockpit giải (mobileOpsV2) — 6 mục kiểu Kholdem theo bản vẽ S1–S6 đã duyệt:
 * Trạng thái · Bàn · Người chơi · Levels · Trả thưởng · Lịch sử (hàng pill cuộn ngang).
 * Tap người chơi Ở BẤT KỲ ĐÂU → PlayerActionSheets. Sửa clock/blind/cơ cấu = máy tính (khoá).
 * DỮ LIỆU MẪU, read-only.
 */
const TABS = [
  { key: "status", label: "Trạng thái" },
  { key: "tables", label: "Bàn" },
  { key: "players", label: "Người chơi" },
  { key: "levels", label: "Levels" },
  { key: "payout", label: "Trả thưởng" },
  { key: "history", label: "Lịch sử" },
] as const;

type TabKey = (typeof TABS)[number]["key"];

const HISTORY_ICON: Record<string, React.ReactNode> = {
  out: <UserMinus className="h-4 w-4 text-rose-300" />,
  move: <ArrowRightLeft className="h-4 w-4 text-[#d8bc85]" />,
  level: <TrendingUp className="h-4 w-4 text-emerald-300" />,
  chip: <Coins className="h-4 w-4 text-amber-300" />,
  open: <Plus className="h-4 w-4 text-emerald-300" />,
};

export default function OpsTournamentCockpit() {
  const navigate = useNavigate();
  const { id } = useParams();
  const [params, setParams] = useSearchParams();
  const tab = (params.get("tab") as TabKey) || "status";
  const [player, setPlayer] = useState<PlayerTarget | null>(null);
  // tap 1 bàn trong pill "Bàn" → mở nhanh sheet người chơi đầu tiên của bàn đó (mock)
  const tapTable = (tb: MockTable) => {
    const s = MOCK_SEATS.find((x) => x.name);
    if (s) setPlayer({ seat: s, tableNo: tb.tableNo });
  };

  const row = MOCK_TOURNAMENT_LIST.find((r) => r.id === id);
  const name = row?.name ?? MOCK_TOURNAMENT.name;
  const t = MOCK_TOURNAMENT;

  const setTab = (k: TabKey) => {
    const p = new URLSearchParams(params);
    p.set("tab", k);
    setParams(p, { replace: true });
  };

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/ops/tournaments")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> Giải đấu
        </button>
        <div className="mt-1 flex items-center gap-2">
          <h1 className="truncate text-[24px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">{name}</h1>
          <span className="flex items-center gap-1 rounded-full bg-emerald-400/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">
            <span className="ios-pulse h-1.5 w-1.5 rounded-full bg-emerald-400" /> Live
          </span>
        </div>
      </header>

      <div className="-mx-4 overflow-x-auto px-4 [scrollbar-width:none] [&::-webkit-scrollbar]:hidden">
        <div className="flex w-max gap-1.5">
          {TABS.map((tb) => (
            <button key={tb.key} onClick={() => setTab(tb.key)}
              className={cn("ios-press-sm whitespace-nowrap rounded-full px-3.5 py-1.5 text-[13px] font-medium", tab === tb.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
              {tb.label}
            </button>
          ))}
        </div>
      </div>

      {tab === "status" && (
        <div className="space-y-3">
          <section className="ios-glow">
            <div className="ios-card p-5 text-center">
              <div className="text-[13px] text-[#9b8e97]">Level {t.level} · còn</div>
              <div className="font-mono text-[46px] font-bold leading-none text-[#c9a86a] [text-shadow:0_2px_16px_rgba(201,168,106,0.35)]">{t.timeToBreak}</div>
              <div className="mt-1 font-mono text-[16px] text-[#f2ece6]">{t.blinds} <span className="text-[#9b8e97]">· ante {t.ante}</span></div>
              <div className="mt-1 text-[13px] text-[#9b8e97]">Tiếp: L{t.level + 1} · 6.000/12.000</div>
            </div>
          </section>
          <div className="ios-card grid grid-cols-2 gap-y-3 p-4 text-center">
            <Metric label="Còn lại" v={<span>{t.remaining}<span className="text-[#9b8e97]">/{t.total}</span></span>} />
            <Metric label="TB stack" v={t.avgStack} />
            <Metric label="Entries" v={String(t.entries)} />
            <Metric label={<span>Pool <span className="text-amber-300">(Tạm tính)</span></span>} v={<span className="text-[#c9a86a]">693tr</span>} />
          </div>
          <div className="ios-fill flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[12px] text-[#7c7079]">
            <Lock className="h-3.5 w-3.5" /> Sửa clock / blind — trên máy tính
          </div>
        </div>
      )}

      {tab === "tables" && (
        <div className="space-y-3">
          <RoomGrid tables={MOCK_TABLES} onTap={tapTable} />
          <button onClick={() => navigate("/ops/tables")} className="ios-press ios-fill w-full rounded-2xl py-3 text-[14px] font-medium text-[#f2ece6]">
            Mở màn Bàn đầy đủ (thao tác)
          </button>
        </div>
      )}

      {tab === "players" && (
        <div className="space-y-3">
          <div className="ios-fill flex items-center gap-2 rounded-2xl px-4 py-3 text-[15px] text-[#9b8e97]">
            <Search className="h-[18px] w-[18px]" /> Tên / SĐT / mã thẻ…
          </div>
          <div className="ios-group">
            {MOCK_SEATS.filter((s) => s.name).map((s) => (
              <button key={s.seat} onClick={() => setPlayer({ seat: s, tableNo: 7 })}
                className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-[#f2ece6]">{s.name}</span>
                  <span className="block font-mono text-[12px] text-[#9b8e97]">Bàn 7 · Ghế {s.seat}</span>
                </span>
                <span className="font-mono text-[13px] text-[#c9a86a]">{s.chip}</span>
              </button>
            ))}
          </div>
          <div className="text-center text-[12px] text-[#7c7079]">chạm 1 người → thao tác (thông tin · chuyển · chip · phiếu · loại)</div>
        </div>
      )}

      {tab === "levels" && (
        <div className="space-y-3">
          <div className="ios-group">
            <div className="ios-row-inset grid grid-cols-4 px-4 py-2 text-[11px] uppercase tracking-wide text-[#9b8e97]">
              <span>L</span><span>Phút</span><span>SB/BB</span><span className="text-right">Ante</span>
            </div>
            {MOCK_LEVELS.map((lv, i) =>
              lv.isBreak ? (
                <div key={i} className="ios-row-inset bg-[#171122] px-4 py-2.5 text-[13px] text-[#9b8e97]">☕ Nghỉ {lv.minutes} phút</div>
              ) : (
                <div key={i} className={cn("ios-row-inset grid grid-cols-4 px-4 py-2.5 text-[13px]", lv.current && "border-l-2 border-[#c9a86a] bg-[#241a0c]")}>
                  <span className={lv.current ? "font-semibold text-[#d8bc85]" : "text-[#f2ece6]"}>{lv.label}{lv.current && " ●"}</span>
                  <span className="text-[#9b8e97]">{lv.minutes}</span>
                  <span className={cn("font-mono", lv.current ? "text-[#d8bc85]" : "text-[#f2ece6]")}>{lv.sb}/{lv.bb}</span>
                  <span className="text-right font-mono text-[#9b8e97]">{lv.ante}</span>
                </div>
              ),
            )}
          </div>
          <div className="ios-fill flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[12px] text-[#7c7079]">
            <Lock className="h-3.5 w-3.5" /> Sửa cấu trúc — trên máy tính
          </div>
        </div>
      )}

      {tab === "payout" && (
        <div className="space-y-3">
          <div className="ios-card p-4 text-center">
            <div className="text-[13px] text-[#9b8e97]">Prize pool <span className="text-amber-300">(Tạm tính)</span></div>
            <div className="font-mono text-[24px] font-semibold text-[#c9a86a]">{t.prizePool}</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">Trả 27 hạng · Tiền chuyển hộ — nợ phải trả</div>
          </div>
          <div className="ios-group">
            {MOCK_PAYOUTS.map((p) => (
              <div key={p.rank} className="ios-row-inset flex items-center justify-between px-4 py-2.5 text-[14px]">
                <span className={p.top ? "font-semibold text-[#d8bc85]" : (p as { muted?: boolean }).muted ? "text-[#9b8e97]" : "text-[#f2ece6]"}>{p.rank}</span>
                <span className={cn("font-mono", (p as { muted?: boolean }).muted ? "text-[#9b8e97]" : "text-[#f2ece6]")}>{p.amount}</span>
              </div>
            ))}
          </div>
          <div className="ios-fill flex items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[12px] text-[#7c7079]">
            <Lock className="h-3.5 w-3.5" /> Chỉ xem — sửa cơ cấu trên máy tính
          </div>
        </div>
      )}

      {tab === "history" && (
        <div className="space-y-3">
          <div className="ios-group">
            {MOCK_HISTORY.map((h, i) => (
              <div key={i} className="ios-row-inset flex items-center gap-3 px-4 py-3">
                <span className="grid h-8 w-8 shrink-0 place-items-center rounded-full bg-white/5">{HISTORY_ICON[h.icon]}</span>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[14px] text-[#f2ece6]">{h.text}</span>
                  <span className="block truncate text-[12px] text-[#9b8e97]">{h.sub}</span>
                </span>
                <span className="font-mono text-[12px] text-[#9b8e97]">{h.time}</span>
              </div>
            ))}
          </div>
          <div className="text-center text-[12px] text-[#7c7079]">mọi thao tác đều có dấu vết — ai, lúc nào</div>
        </div>
      )}

      <PlayerActionSheets target={player} onClose={() => setPlayer(null)} />

      {/* live viewer link — S1 secondary action */}
      {tab === "status" && (
        <button onClick={() => navigate("/ops/tables")} className="ios-press ios-tinted flex w-full items-center justify-center gap-1.5 rounded-2xl py-3 text-[15px] font-semibold">
          <Radio className="h-[18px] w-[18px]" /> Sơ đồ bàn
        </button>
      )}
    </div>
  );
}

function Metric({ label, v }: { label: React.ReactNode; v: React.ReactNode }) {
  return (
    <div>
      <div className="font-mono text-[22px] font-semibold leading-none text-[#f2ece6]">{v}</div>
      <div className="mt-1 text-[11px] text-[#9b8e97]">{label}</div>
    </div>
  );
}
