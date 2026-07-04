import { useState } from "react";
import { toast } from "sonner";
import { ArrowRightLeft, Coins, Receipt, UserMinus, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { TableStatusCard } from "@/components/ops/shared/TableStatusCard";
import { RoleLockedAction } from "@/components/ops/shared/RoleLockedAction";
import { MOCK_TABLES, MOCK_SEATS, type MockTable, type MockSeat } from "@/components/ops/mock/opsData";

/**
 * Bàn (mobileOpsV2) — sơ đồ bàn (card 2 cột) → sheet chi tiết bàn → sheet hành động người chơi →
 * xác nhận Loại (restate). DỮ LIỆU MẪU, read-only: mọi hành động là no-op toast. Money = RoleLockedAction.
 * docs/design/ios-floor-ux-spec.md §5–6 · wireframes WF3/WF4.
 */
export default function OpsTables() {
  const [openTable, setOpenTable] = useState<MockTable | null>(null);
  const [actionSeat, setActionSeat] = useState<MockSeat | null>(null);
  const [confirmBust, setConfirmBust] = useState<MockSeat | null>(null);

  const openAction = (s: MockSeat) => {
    setOpenTable(null);
    requestAnimationFrame(() => setActionSeat(s));
  };
  const requestBust = (s: MockSeat) => {
    setActionSeat(null);
    requestAnimationFrame(() => setConfirmBust(s));
  };

  return (
    <div className="space-y-3">
      <h1 className="text-base font-semibold text-foreground">Sơ đồ bàn</h1>
      <div className="grid grid-cols-2 gap-2">
        {MOCK_TABLES.map((tb) => (
          <TableStatusCard key={tb.tableNo} table={tb} onTap={() => setOpenTable(tb)} />
        ))}
      </div>

      {/* Chi tiết bàn */}
      <Sheet open={openTable !== null} onOpenChange={(v) => { if (!v) setOpenTable(null); }}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-center">
            <SheetTitle>Bàn {openTable?.tableNo} · {openTable?.occ}/{openTable?.max} ghế</SheetTitle>
          </SheetHeader>
          <div className="mt-3 grid grid-cols-2 gap-2">
            {MOCK_SEATS.map((s) =>
              s.name ? (
                <button
                  key={s.seat}
                  onClick={() => openAction(s)}
                  className="rounded-xl border border-border bg-card p-3 text-left"
                >
                  <div className="text-[11px] text-muted-foreground">Ghế {s.seat}</div>
                  <div className="truncate text-sm font-medium text-foreground">{s.name}</div>
                  <div className="font-mono text-xs text-primary">{s.chip}</div>
                </button>
              ) : (
                <div key={s.seat} className="rounded-xl border border-dashed border-border p-3 text-center text-xs text-muted-foreground">
                  Ghế {s.seat} · trống
                </div>
              ),
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Hành động người chơi */}
      <Sheet open={actionSeat !== null} onOpenChange={(v) => { if (!v) setActionSeat(null); }}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-center">
            <SheetTitle>Ghế {actionSeat?.seat} — {actionSeat?.name}</SheetTitle>
          </SheetHeader>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <button
              onClick={() => { setActionSeat(null); toast("Chuyển bàn/ghế (bản mẫu)"); }}
              className="flex items-center gap-3 rounded-xl border border-primary/45 bg-primary/10 p-3.5 text-left text-primary"
            >
              <ArrowRightLeft className="h-6 w-6 shrink-0" />
              <span><span className="block text-[15px] font-medium">Chuyển</span><span className="block text-[11px] opacity-80">bàn / ghế</span></span>
            </button>
            <button
              onClick={() => { setActionSeat(null); toast("Sửa chip (bản mẫu)"); }}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left"
            >
              <Coins className="h-6 w-6 shrink-0 text-amber-400" />
              <span><span className="block text-[15px] font-medium">Sửa chip</span><span className="block text-[11px] text-muted-foreground">điều chỉnh stack</span></span>
            </button>
            <button
              onClick={() => { setActionSeat(null); toast("Phiếu (bản mẫu)"); }}
              className="flex items-center gap-3 rounded-xl border border-border bg-card p-3.5 text-left"
            >
              <Receipt className="h-6 w-6 shrink-0 text-sky-400" />
              <span><span className="block text-[15px] font-medium">Phiếu</span><span className="block text-[11px] text-muted-foreground">xem / in lại</span></span>
            </button>
            <button
              onClick={() => actionSeat && requestBust(actionSeat)}
              className="flex items-center gap-3 rounded-xl border border-destructive/45 bg-destructive/10 p-3.5 text-left text-destructive"
            >
              <UserMinus className="h-6 w-6 shrink-0" />
              <span><span className="block text-[15px] font-medium">Loại</span><span className="block text-[11px] opacity-80">bust out</span></span>
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* Xác nhận Loại — restate hạng + tiền (mẫu) */}
      <AlertDialog open={confirmBust !== null} onOpenChange={(v) => { if (!v) setConfirmBust(null); }}>
        <AlertDialogContent className="max-w-sm">
          <AlertDialogHeader>
            <AlertDialogTitle className="flex items-center gap-2">
              <span className="grid h-8 w-8 place-items-center rounded-full bg-destructive/15 text-destructive">
                <UserMinus className="h-4 w-4" />
              </span>
              Xác nhận loại người chơi
            </AlertDialogTitle>
            <AlertDialogDescription>Kiểm tra hạng và tiền thưởng trước khi xác nhận.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="rounded-xl border border-border bg-card p-4 text-center">
            <div className="text-base font-medium text-foreground">{confirmBust?.name}</div>
            <div className="mt-2 flex items-baseline justify-center gap-1.5">
              <span className="text-sm text-muted-foreground">Về hạng</span>
              <span className="font-mono text-3xl font-semibold text-foreground">84</span>
            </div>
            <div className="my-3 border-t border-border" />
            <div className="text-sm text-muted-foreground">Ngoài cơ cấu giải — chưa tới hạng có thưởng (mẫu)</div>
          </div>
          <AlertDialogFooter>
            <Button variant="outline" onClick={() => setConfirmBust(null)}>Huỷ</Button>
            <Button onClick={() => { setConfirmBust(null); toast.success("Đã loại (bản mẫu)"); }}>
              <UserMinus className="mr-1.5 h-4 w-4" /> Xác nhận loại
            </Button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>

      <RoleLockedAction label="Bốc lại / Mở bàn" reason="thao tác thật ở luồng floor hiện có" />
    </div>
  );
}
