import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronRight, Plus, Play, Activity, Edit, Trophy, History, FlagTriangleRight, Trash2, Image, Minus,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogContent, AlertDialogHeader, AlertDialogFooter, AlertDialogTitle, AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { MOCK_TOURNAMENT_LIST, type MockTournamentRow } from "@/components/ops/mock/opsData";

/**
 * Giải đấu (mobileOpsV2) — theo bản vẽ A1/A2 đã duyệt: một chuỗi danh sách, ấn 1 giải → sheet chứa MỌI
 * thao tác (Vào giải nổi bật · Cập nhật live · Sửa · Cơ cấu · Lịch sử · Chốt giải · Xoá cuối cùng).
 * "+ Tạo giải" duy nhất ở đáy → sheet 2 lựa chọn (N1 form / N2 từ ảnh lịch).
 * DỮ LIỆU MẪU — mọi ghi là toast "(bản mẫu)".
 */
const FILTERS = ["Đang chơi", "Hôm nay", "Tất cả (38)"] as const;

const STATUS_CHIP: Record<MockTournamentRow["status"], string> = {
  running: "bg-emerald-400/12 text-emerald-300",
  late: "bg-amber-400/12 text-amber-300",
  upcoming: "bg-amber-400/12 text-amber-300",
  closed: "bg-white/6 text-[#9b8e97]",
};

type SubSheet = "none" | "actions" | "create" | "form" | "updateLive" | "close" | "delete";

export default function OpsTournaments() {
  const navigate = useNavigate();
  const [filter, setFilter] = useState<(typeof FILTERS)[number]>("Đang chơi");
  const [sel, setSel] = useState<MockTournamentRow | null>(null);
  const [sub, setSub] = useState<SubSheet>("none");
  const [livePlayers, setLivePlayers] = useState(42);
  const [liveLevel, setLiveLevel] = useState(8);
  const [liveStatus, setLiveStatus] = useState("Đang chơi");

  const rows = filter === "Đang chơi" ? MOCK_TOURNAMENT_LIST.filter((r) => r.status === "running") : MOCK_TOURNAMENT_LIST;

  const openActions = (r: MockTournamentRow) => { setSel(r); setSub("actions"); };
  const go = (next: SubSheet) => { setSub("none"); requestAnimationFrame(() => setSub(next)); };
  const closeAll = () => { setSub("none"); setSel(null); };
  const done = (msg: string) => { toast.success(msg + " (bản mẫu)"); closeAll(); };

  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Giải đấu</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">Hanoi Royal · chạm 1 giải để thao tác</p>
      </header>

      <div className="flex gap-1.5 px-1">
        {FILTERS.map((f) => (
          <button key={f} onClick={() => setFilter(f)}
            className={cn("ios-press-sm rounded-full px-3 py-1.5 text-[13px] font-medium", filter === f ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            {f}
          </button>
        ))}
      </div>

      <div className="ios-group">
        {rows.map((r) => (
          <button key={r.id} onClick={() => openActions(r)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
            <span className="min-w-0 flex-1">
              <span className={cn("block truncate text-[16px] font-semibold", r.status === "closed" ? "text-[#9b8e97]" : "text-[#f2ece6]")}>{r.name}</span>
              <span className="mt-0.5 block font-mono text-[12px] text-[#9b8e97]">
                {r.time} · buy-in {r.buyIn}{r.entries ? ` · ${r.entries} người` : ""}
              </span>
            </span>
            <span className={cn("rounded-full px-2 py-0.5 text-[11px] font-semibold", STATUS_CHIP[r.status])}>{r.statusLabel}</span>
            <ChevronRight className="h-[18px] w-[18px] shrink-0 text-[#5f545c]" />
          </button>
        ))}
      </div>

      <button onClick={() => setSub("create")} className="ios-press ios-primary flex w-full items-center justify-center gap-1.5 rounded-2xl py-3.5 text-[16px] font-bold">
        <Plus className="h-5 w-5" /> Tạo giải
      </button>

      {/* A2 — sheet thao tác giải */}
      <Sheet open={sub === "actions"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">
              {sel?.name}
              <span className={cn("ml-2 rounded-full px-2 py-0.5 text-[11px] font-semibold", sel ? STATUS_CHIP[sel.status] : "")}>{sel?.statusLabel}</span>
            </SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-center font-mono text-[13px] text-[#9b8e97]">
            {sel?.time} · {sel?.entries ?? 0} người{sel?.level ? ` · L${sel.level} · ${sel.blinds}` : ""}
          </div>
          <div className="mt-4 space-y-1.5">
            <button onClick={() => { const id = sel?.id; closeAll(); navigate(`/ops/tournaments/${id}`); }}
              className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
              <Play className="h-5 w-5 shrink-0" />
              <span className="text-[15px] font-bold">Vào giải (vận hành)</span>
            </button>
            <Row icon={<Activity className="h-5 w-5 text-emerald-300" />} label="Cập nhật live — người / level / blind" onTap={() => go("updateLive")} />
            <Row icon={<Edit className="h-5 w-5 text-[#9b8e97]" />} label="Sửa thông tin giải" onTap={() => go("form")} />
            <Row icon={<Trophy className="h-5 w-5 text-[#d8bc85]" />} label="Cơ cấu thưởng" onTap={() => { const id = sel?.id; closeAll(); navigate(`/ops/tournaments/${id}?tab=payout`); }} />
            <Row icon={<History className="h-5 w-5 text-[#9b8e97]" />} label="Lịch sử thao tác" onTap={() => { const id = sel?.id; closeAll(); navigate(`/ops/tournaments/${id}?tab=history`); }} />
            <Row icon={<FlagTriangleRight className="h-5 w-5 text-amber-300" />} label={<span className="text-amber-300">Chốt giải</span>} onTap={() => go("close")} />
            <Row icon={<Trash2 className="h-5 w-5 text-rose-300" />} label={<span className="text-rose-300">Xoá giải</span>} onTap={() => go("delete")} />
          </div>
        </SheetContent>
      </Sheet>

      {/* tạo giải — 2 lựa chọn */}
      <Sheet open={sub === "create"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Tạo giải</SheetTitle></SheetHeader>
          <div className="mt-3 space-y-1.5">
            <Row icon={<Plus className="h-5 w-5 text-[#d8bc85]" />} label="Tạo mới — điền 5 ô" onTap={() => go("form")} />
            <Row icon={<Image className="h-5 w-5 text-sky-300" />} label="Tạo từ ảnh lịch — máy tự đọc" onTap={() => { closeAll(); toast("Tạo từ ảnh lịch (bản mẫu) — luồng N2"); }} />
          </div>
        </SheetContent>
      </Sheet>

      {/* N1 — form tạo/sửa giải */}
      <Sheet open={sub === "form"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">{sel ? "Sửa thông tin giải" : "Tạo giải mới"}</SheetTitle></SheetHeader>
          <div className="mt-3 space-y-2.5">
            <Field label="Tên giải" value={sel?.name ?? "Daily Turbo tối"} />
            <div className="grid grid-cols-2 gap-2">
              <Field label="Giờ bắt đầu" value={sel?.time ?? "21:00"} mono />
              <Field label="Ngày" value="07/07" mono />
            </div>
            <div className="grid grid-cols-2 gap-2">
              <Field label="Buy-in" value="1.000.000" mono />
              <Field label="Stack" value="30.000" mono />
            </div>
            <Field label="Cấu trúc blind" value="Turbo 20 phút — mẫu có sẵn ▾" muted />
          </div>
          <button onClick={() => done(sel ? "Đã lưu thông tin giải" : "Đã tạo giải")} className="ios-press ios-primary mt-4 w-full rounded-2xl py-3 text-[15px] font-bold">
            {sel ? "Lưu thay đổi" : "Tạo giải"}
          </button>
        </SheetContent>
      </Sheet>

      {/* N3 — cập nhật live: bấm ± thay vì gõ */}
      <Sheet open={sub === "updateLive"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Cập nhật live — {sel?.name}</SheetTitle></SheetHeader>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <Stepper label="Người còn" value={livePlayers} onDec={() => setLivePlayers((v) => Math.max(0, v - 1))} onInc={() => setLivePlayers((v) => v + 1)} />
            <Stepper label="Level" value={liveLevel} onDec={() => setLiveLevel((v) => Math.max(1, v - 1))} onInc={() => setLiveLevel((v) => v + 1)} />
          </div>
          <div className="mt-2.5">
            <div className="px-1 text-[12px] text-[#9b8e97]">Blind (tự theo level {liveLevel})</div>
            <div className="ios-fill mt-1 rounded-xl py-2.5 text-center font-mono text-[15px] text-[#f2ece6]">2.000 / 4.000 · ante 4.000</div>
          </div>
          <div className="mt-2.5 px-1 text-[12px] text-[#9b8e97]">Trạng thái</div>
          <div className="mt-1 flex flex-wrap gap-1.5 px-1">
            {["Đang chơi", "Giải lao", "Final", "Kết thúc"].map((st) => (
              <button key={st} onClick={() => setLiveStatus(st)}
                className={cn("ios-press-sm rounded-full px-3 py-1.5 text-[13px] font-medium", liveStatus === st ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-[#9b8e97]")}>
                {st}
              </button>
            ))}
          </div>
          <button onClick={() => done("Đã lưu cập nhật live")} className="ios-press ios-primary mt-4 w-full rounded-2xl py-3 text-[15px] font-bold">Lưu cập nhật</button>
          <div className="mt-2 text-center text-[12px] text-[#7c7079]">đồng hồ và TV cập nhật theo ngay</div>
        </SheetContent>
      </Sheet>

      {/* chốt giải — amber confirm */}
      <AlertDialog open={sub === "close"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <AlertDialogContent className="max-w-[340px] rounded-[24px] border-none bg-[#0d0913]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#f2ece6]">Chốt giải {sel?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#9b8e97]">
              Khoá kết quả và số liệu của giải. Số tiền trả thưởng sẽ chuyển sang trạng thái Đã chốt.
            </AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <button onClick={closeAll} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6]">Huỷ</button>
            <button onClick={() => done("Đã chốt giải")} className="ios-press flex-1 rounded-2xl bg-amber-400/90 py-3 text-[15px] font-bold text-[#241A08]">Chốt giải</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      {/* xoá giải — red confirm */}
      <AlertDialog open={sub === "delete"} onOpenChange={(v) => { if (!v) closeAll(); }}>
        <AlertDialogContent className="max-w-[340px] rounded-[24px] border-none bg-[#0d0913]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#f2ece6]">Xoá giải {sel?.name}?</AlertDialogTitle>
            <AlertDialogDescription className="text-[#9b8e97]">Không hoàn tác được. Giải có người đăng ký sẽ không xoá được.</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <button onClick={closeAll} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6]">Huỷ</button>
            <button onClick={() => done("Đã xoá giải")} className="ios-press flex-1 rounded-2xl bg-rose-500/90 py-3 text-[15px] font-bold text-white">Xoá giải</button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}

function Row({ icon, label, onTap }: { icon: React.ReactNode; label: React.ReactNode; onTap: () => void }) {
  return (
    <button onClick={onTap} className="ios-press ios-fill flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
      {icon}
      <span className="text-[15px] text-[#f2ece6]">{label}</span>
    </button>
  );
}

function Field({ label, value, mono, muted }: { label: string; value: string; mono?: boolean; muted?: boolean }) {
  return (
    <div>
      <div className="px-1 text-[12px] text-[#9b8e97]">{label}</div>
      <div className={cn("ios-fill mt-1 rounded-xl px-3 py-2.5 text-[15px]", mono && "font-mono text-center", muted ? "text-[#9b8e97]" : "text-[#f2ece6]")}>{value}</div>
    </div>
  );
}

function Stepper({ label, value, onDec, onInc }: { label: string; value: number; onDec: () => void; onInc: () => void }) {
  return (
    <div className="ios-fill rounded-xl px-2 py-2 text-center">
      <div className="text-[11px] text-[#9b8e97]">{label}</div>
      <div className="mt-1 flex items-center justify-center gap-3">
        <button onClick={onDec} className="ios-press-sm grid h-8 w-8 place-items-center rounded-lg bg-white/6 text-[#f2ece6]"><Minus className="h-4 w-4" /></button>
        <span className="min-w-[2.5rem] font-mono text-[20px] font-semibold text-[#f2ece6]">{value}</span>
        <button onClick={onInc} className="ios-press-sm grid h-8 w-8 place-items-center rounded-lg bg-white/6 text-[#f2ece6]"><Plus className="h-4 w-4" /></button>
      </div>
    </div>
  );
}
