import { useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, Coins, Receipt, UserMinus } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { TableStatusCard } from "@/components/ops/shared/TableStatusCard";
import { RoleLockedAction } from "@/components/ops/shared/RoleLockedAction";
import { MOCK_TABLES, MOCK_SEATS, type MockTable, type MockSeat } from "@/components/ops/mock/opsData";

/**
 * Bàn (mobileOpsV2) — sơ đồ bàn (card iOS 2 cột) → sheet chi tiết bàn → sheet hành động → xác nhận Loại.
 * DỮ LIỆU MẪU, read-only: mọi hành động là no-op toast. Money = RoleLockedAction. Spec §5–6.
 */
const ACTIONS = [
  { key: "move", icon: ArrowRightLeft, label: "Chuyển", sub: "bàn / ghế", cls: "ios-tinted" },
  { key: "chip", icon: Coins, label: "Sửa chip", sub: "điều chỉnh", cls: "ios-fill", ic: "text-amber-300" },
  { key: "receipt", icon: Receipt, label: "Phiếu", sub: "xem / in", cls: "ios-fill", ic: "text-sky-300" },
  { key: "bust", icon: UserMinus, label: "Loại", sub: "bust out", cls: "bg-rose-500/12 text-rose-300" },
] as const;

export default function OpsTables() {
  const [openTable, setOpenTable] = useState<MockTable | null>(null);
  const [actionSeat, setActionSeat] = useState<MockSeat | null>(null);
  const [confirmBust, setConfirmBust] = useState<MockSeat | null>(null);

  const openAction = (s: MockSeat) => { setOpenTable(null); requestAnimationFrame(() => setActionSeat(s)); };
  const onAction = (key: string) => {
    if (key === "bust") { const s = actionSeat; setActionSeat(null); requestAnimationFrame(() => setConfirmBust(s)); return; }
    setActionSeat(null);
    toast(key === "move" ? "Chuyển bàn/ghế (bản mẫu)" : key === "chip" ? "Sửa chip (bản mẫu)" : "Phiếu (bản mẫu)");
  };

  return (
    <div className="ios-in space-y-5 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Bàn</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">Sơ đồ bàn · chạm để xem</p>
      </header>

      <div className="grid grid-cols-2 gap-2.5">
        {MOCK_TABLES.map((tb) => (
          <TableStatusCard key={tb.tableNo} table={tb} onTap={() => setOpenTable(tb)} />
        ))}
      </div>

      <RoleLockedAction label="Bốc lại / Mở bàn" reason="thao tác thật ở luồng floor hiện có" />

      {/* Chi tiết bàn */}
      <Sheet open={openTable !== null} onOpenChange={(v) => { if (!v) setOpenTable(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">Bàn {openTable?.tableNo} · {openTable?.occ}/{openTable?.max} ghế</SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {MOCK_SEATS.map((s) =>
              s.name ? (
                <button key={s.seat} onClick={() => openAction(s)} className="ios-press ios-card p-3.5 text-left">
                  <div className="text-[11px] text-[#9b8e97]">Ghế {s.seat}</div>
                  <div className="truncate text-[15px] font-semibold text-[#f2ece6]">{s.name}</div>
                  <div className="font-mono text-[13px] text-[#c9a86a]">{s.chip}</div>
                </button>
              ) : (
                <div key={s.seat} className="ios-fill grid place-items-center rounded-2xl p-3.5 text-[13px] text-[#7c7079]">
                  Ghế {s.seat} · trống
                </div>
              ),
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Hành động người chơi */}
      <Sheet open={actionSeat !== null} onOpenChange={(v) => { if (!v) setActionSeat(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">Ghế {actionSeat?.seat} — {actionSeat?.name}</SheetTitle>
          </SheetHeader>
          <div className="mt-4 grid grid-cols-2 gap-2.5">
            {ACTIONS.map((a) => (
              <button
                key={a.key}
                onClick={() => onAction(a.key)}
                className={`ios-press flex items-center gap-3 rounded-2xl p-4 text-left ${a.cls}`}
              >
                <a.icon className={`h-6 w-6 shrink-0 ${"ic" in a ? a.ic : ""}`} />
                <span>
                  <span className="block text-[15px] font-semibold">{a.label}</span>
                  <span className="block text-[11px] opacity-80">{a.sub}</span>
                </span>
              </button>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* Xác nhận Loại — restate hạng (mẫu) */}
      <AlertDialog open={confirmBust !== null} onOpenChange={(v) => { if (!v) setConfirmBust(null); }}>
        <AlertDialogContent className="max-w-[340px] rounded-[24px] border-none bg-[#0d0913]">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2 text-[#f2ece6]">
              <span className="grid h-9 w-9 place-items-center rounded-full bg-rose-500/14 text-rose-300">
                <UserMinus className="h-[18px] w-[18px]" />
              </span>
              Xác nhận loại người chơi
            </AlertDialogTitle>
            <AlertDialogDescription className="text-[#9b8e97]">Kiểm tra hạng và tiền thưởng trước khi xác nhận.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="ios-card p-5 text-center">
            <div className="text-[17px] font-semibold text-[#f2ece6]">{confirmBust?.name}</div>
            <div className="mt-2 text-[13px] uppercase tracking-wider text-[#9b8e97]">Về hạng</div>
            <div className="font-mono text-[40px] font-bold leading-none text-[#f2ece6]">84</div>
            <div className="mx-auto my-3 h-px w-16 bg-white/8" />
            <div className="text-[14px] text-[#9b8e97]">Ngoài cơ cấu giải — chưa tới hạng có thưởng (mẫu)</div>
          </div>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <button onClick={() => setConfirmBust(null)} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6]">
              Huỷ
            </button>
            <button
              onClick={() => { setConfirmBust(null); toast.success("Đã loại (bản mẫu)"); }}
              className="ios-press flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-rose-500/90 py-3 text-[15px] font-bold text-white"
            >
              <UserMinus className="h-4 w-4" /> Xác nhận
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </div>
  );
}
