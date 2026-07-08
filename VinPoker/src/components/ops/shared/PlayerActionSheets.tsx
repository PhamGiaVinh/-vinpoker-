import { useState } from "react";
import { toast } from "sonner";
import { User, ArrowRightLeft, Coins, Receipt, UserMinus, IdCard, Printer, Loader2 } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import type { MockSeat } from "../mock/opsData";

/**
 * PlayerActionSheets — luồng người chơi đầy đủ theo bản vẽ đã duyệt:
 * S7 sheet thao tác (Thông tin / Chuyển / Sửa chip / Phiếu / Loại) → S8 thẻ thông tin band ·
 * S9 chuyển bàn-ghế (chọn ghế trống trực quan) · N5 sửa chip (numpad + lý do) · N6 phiếu · S10 xác nhận Loại.
 * "Ấn vào người chơi ở BẤT KỲ đâu đều thao tác được" — mọi list người chơi đều mở component này.
 * DỮ LIỆU MẪU, read-only: mọi xác nhận là toast "(bản mẫu)".
 */
export interface PlayerTarget {
  seat: MockSeat;
  tableNo: number;
  /** Chip HIỆN TẠI (số thật) để khởi tạo numpad khi nối thật; bỏ trống = mock. */
  chipCount?: number;
}

type Step = "actions" | "info" | "move" | "chip" | "receipt" | "bust" | null;

const MOVE_TABLES = [8, 9, 10];
const MOVE_SEATS = [1, 3, 4, 5, 7, 9];
const FREE_SEATS = new Set([3, 4, 7]);
const MOVE_REASONS = ["cân bàn", "gãy bàn", "yêu cầu TD"];
const CHIP_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

export function PlayerActionSheets({
  target,
  onClose,
  pendingNotice,
  onSaveChip,
  onBustPlayer,
  onOpenBust,
  bustInfo,
}: {
  target: PlayerTarget | null;
  onClose: () => void;
  /** Khi màn chủ chạy DỮ LIỆU THẬT nhưng hành động CHƯA nối: mọi nút con (Thông tin/Chuyển/
   *  Sửa chip/Phiếu/Loại) chỉ toast notice này và đóng — KHÔNG mở các sheet con (chúng còn
   *  scaffold mẫu, không được hiện như thật). Bỏ trống = hành vi mock cũ "(bản mẫu)". */
  pendingNotice?: string;
  /** Nếu có → nút "Sửa chip" mở numpad THẬT; xác nhận gọi callback này (màn chủ ghi update_seats
   *  với identity ghế thật) và trả về true nếu thành công. Các nút khác vẫn theo pendingNotice. */
  onSaveChip?: (newChip: number) => Promise<boolean>;
  /** Nếu có → nút "Loại" mở xác nhận THẬT (💰 ITM). onOpenBust: màn chủ ĐỌC LẠI hạng+thưởng tạm
   *  tính ngay lúc mở (P0-5, không dùng cache). bustInfo: kết quả đọc lại. onBustPlayer: ghi
   *  update_seats is_active:false, trả true nếu thành công. */
  onBustPlayer?: () => Promise<boolean>;
  onOpenBust?: () => void;
  bustInfo?: { loading: boolean; place: number | null; prize: number | null } | null;
}) {
  const [step, setStep] = useState<Step>("actions");
  const [moveSeat, setMoveSeat] = useState<number | null>(4);
  const [moveReason, setMoveReason] = useState(MOVE_REASONS[0]);
  const [chipValue, setChipValue] = useState("62500");
  const [chipBusy, setChipBusy] = useState(false);
  const [bustBusy, setBustBusy] = useState(false);

  const open = target !== null;
  const s = target?.seat;
  const t = target?.tableNo ?? 0;
  const title = s ? `Ghế ${t}-${s.seat} — ${s.name}` : "";

  const go = (next: Step) => {
    setStep(null);
    requestAnimationFrame(() => setStep(next));
  };
  const close = () => {
    setStep("actions");
    setMoveSeat(4);
    setChipValue("62500");
    onClose();
  };
  const done = (msg: string) => {
    toast.success(msg + " (bản mẫu)");
    close();
  };
  /** Điều hướng nút con: chip có onSaveChip → mở numpad THẬT (init = chip hiện tại);
   *  còn lại pendingNotice set → toast + đóng (không mở sheet con mock). */
  const act = (next: Step) => {
    if (next === "chip" && onSaveChip) {
      setChipValue(String(target?.chipCount ?? 0));
      go("chip");
      return;
    }
    if (next === "bust" && onBustPlayer) {
      onOpenBust?.();          // P0-5: đọc lại hạng + thưởng tạm tính NGAY khi mở
      go("bust");
      return;
    }
    if (pendingNotice) {
      toast(pendingNotice);
      close();
      return;
    }
    go(next);
  };

  const chipDisplay = Number(chipValue || "0").toLocaleString("vi-VN");
  const pressKey = (k: string) => {
    if (k === "⌫") setChipValue((v) => v.slice(0, -1));
    else setChipValue((v) => (v + k).replace(/^0+(?=\d)/, "").slice(0, 9));
  };

  const sheetOpen = (which: Step) => open && step === which;

  return (
    <>
      {/* S7 — sheet thao tác */}
      <Sheet open={sheetOpen("actions")} onOpenChange={(v) => { if (!v) close(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">{title}</SheetTitle>
          </SheetHeader>
          <div className="mt-1 text-center text-[13px] text-[#9b8e97]">
            <span className="font-mono">{s?.chip}</span> chip · lượt vào #{s?.entryNo ?? 1}
          </div>
          <div className="mt-4 space-y-1.5">
            <button onClick={() => act("info")} className="ios-press ios-tinted flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
              <User className="h-5 w-5 shrink-0" />
              <span className="text-[15px] font-semibold">Thông tin người chơi</span>
            </button>
            <div className="grid grid-cols-2 gap-1.5">
              <button onClick={() => act("move")} className="ios-press ios-fill flex items-center gap-3 rounded-2xl p-3.5 text-left">
                <ArrowRightLeft className="h-5 w-5 shrink-0 text-[#d8bc85]" />
                <span><span className="block text-[15px] font-semibold text-[#f2ece6]">Chuyển</span><span className="block text-[11px] text-[#9b8e97]">bàn / ghế</span></span>
              </button>
              <button onClick={() => act("chip")} className="ios-press ios-fill flex items-center gap-3 rounded-2xl p-3.5 text-left">
                <Coins className="h-5 w-5 shrink-0 text-amber-300" />
                <span><span className="block text-[15px] font-semibold text-[#f2ece6]">Sửa chip</span><span className="block text-[11px] text-[#9b8e97]">điều chỉnh</span></span>
              </button>
              <button onClick={() => act("receipt")} className="ios-press ios-fill flex items-center gap-3 rounded-2xl p-3.5 text-left">
                <Receipt className="h-5 w-5 shrink-0 text-sky-300" />
                <span><span className="block text-[15px] font-semibold text-[#f2ece6]">Phiếu</span><span className="block text-[11px] text-[#9b8e97]">xem / in lại</span></span>
              </button>
              <button onClick={() => act("bust")} className="ios-press flex items-center gap-3 rounded-2xl bg-rose-500/12 p-3.5 text-left text-rose-300">
                <UserMinus className="h-5 w-5 shrink-0" />
                <span><span className="block text-[15px] font-semibold">Loại</span><span className="block text-[11px] opacity-80">bust out</span></span>
              </button>
            </div>
          </div>
        </SheetContent>
      </Sheet>

      {/* S8 — thẻ thông tin band */}
      <Sheet open={sheetOpen("info")} onOpenChange={(v) => { if (!v) close(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="items-center text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-[#c9a86a] bg-[#241A2C] text-[15px] font-semibold text-[#c9a86a]">
              {(s?.name ?? "?").split(" ").map((w) => w[0]).slice(-2).join("")}
            </div>
            <SheetTitle className="mt-1.5 text-[16px] font-semibold text-[#f2ece6]">{s?.name}</SheetTitle>
            <div className="font-mono text-[12px] text-[#9b8e97]">090•••••23 · vào 13:20</div>
          </SheetHeader>
          <div className="mt-3 space-y-1.5">
            <Band cls="bg-[#241a0c]" l={<span className="text-[#d8bc85]">Phiếu</span>} r={<span className="font-mono text-[#f2ece6]">#72</span>} />
            <Band cls="bg-emerald-400/10" l={<span className="text-emerald-300">Ghế</span>} r={<span className="font-mono text-[#f2ece6]">{t}-{s?.seat} <span className="text-[#9b8e97]">· chạm để đổi</span></span>} onTap={() => go("move")} />
            <Band cls="bg-white/5" l={<span className="text-[#9b8e97]">Vị trí hiện tại</span>} r={<span className="font-mono text-[#f2ece6]">#31/84</span>} />
            <Band cls="bg-[#241a0c]" l={<span className="text-[#d8bc85]">Chip</span>} r={<span className="font-mono text-[#c9a86a]">{s?.chip}</span>} />
            <Band cls="bg-white/5" l={<span className="text-[#9b8e97]">Tiền thưởng <span className="text-amber-300">(Tạm tính)</span></span>} r={<span className="font-mono text-[#f2ece6]">0 đ</span>} />
            <Band cls="bg-white/5" l={<span className="text-[#9b8e97]">Mã thẻ hội viên</span>} r={<span className="font-mono text-[#f2ece6]">VB-2607-A3F2</span>} />
            <Band cls="bg-white/5" l={<span className="text-[#9b8e97]">Lượt vào</span>} r={<span className="font-mono text-[#f2ece6]">#{s?.entryNo ?? 1} · re-entry 0</span>} />
          </div>
          <button onClick={() => toast("Cấp lại thẻ — mở Cashier (bản mẫu)")} className="ios-press ios-fill mt-3 flex w-full items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[13px] text-[#9b8e97]">
            <IdCard className="h-4 w-4" /> Cấp lại thẻ — mở Cashier
          </button>
        </SheetContent>
      </Sheet>

      {/* S9 — chuyển bàn/ghế */}
      <Sheet open={sheetOpen("move")} onOpenChange={(v) => { if (!v) close(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-left">
            <SheetTitle className="text-[#f2ece6]">Chuyển bàn / ghế</SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-[13px] text-[#9b8e97]">{s?.name} · đang ở <span className="font-mono">Bàn {t} · Ghế {s?.seat}</span></div>
          <div className="ios-card mt-3 p-3.5">
            <div className="text-[12px] text-[#9b8e97]">Chọn bàn đích</div>
            <div className="mt-1.5 flex gap-1.5">
              {MOVE_TABLES.map((tb, i) => (
                <span key={tb} className={cn("grid h-8 w-9 place-items-center rounded-lg text-[13px] font-semibold", i === 0 ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-[#9b8e97]")}>{tb}</span>
              ))}
            </div>
            <div className="mt-3 text-[12px] text-[#9b8e97]">Ghế trống ở bàn 8 — chạm để chọn</div>
            <div className="mt-1.5 flex gap-1.5">
              {MOVE_SEATS.map((seatNo) => {
                const free = FREE_SEATS.has(seatNo);
                const sel = moveSeat === seatNo;
                return (
                  <button key={seatNo} disabled={!free} onClick={() => setMoveSeat(seatNo)}
                    className={cn("ios-press-sm grid h-8 w-9 place-items-center rounded-lg text-[13px] font-semibold",
                      sel ? "bg-[#c9a86a] text-[#241A08]" : free ? "bg-emerald-400/15 text-emerald-300" : "bg-white/5 text-[#5f545c]")}>
                    {seatNo}
                  </button>
                );
              })}
            </div>
          </div>
          <div className="ios-fill mt-2 rounded-2xl py-2.5 text-center text-[14px]">
            <span className="font-mono text-[#f2ece6]">Bàn {t} · Ghế {s?.seat}</span>
            <span className="mx-2 text-[#c9a86a]">→</span>
            <span className="font-mono text-[#d8bc85]">Bàn 8 · Ghế {moveSeat ?? "—"}</span>
          </div>
          <div className="mt-2 flex items-center gap-1.5 px-1 text-[13px] text-[#9b8e97]">
            Lý do:
            {MOVE_REASONS.map((r) => (
              <button key={r} onClick={() => setMoveReason(r)}
                className={cn("ios-press-sm rounded-full px-2.5 py-1 text-[12px]", moveReason === r ? "bg-[#c9a86a]/15 text-[#d8bc85]" : "bg-white/5 text-[#9b8e97]")}>
                {r}
              </button>
            ))}
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={close} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6]">Huỷ</button>
            <button onClick={() => done(`Đã chuyển tới bàn 8 ghế ${moveSeat}`)} disabled={moveSeat === null}
              className="ios-press ios-primary flex-[2] rounded-2xl py-3 text-[15px] font-bold">
              Xác nhận chuyển
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* N5 — sửa chip (numpad); nối thật qua onSaveChip (update_seats identity ghế thật) */}
      <Sheet open={sheetOpen("chip")} onOpenChange={(v) => { if (!v && !chipBusy) close(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">Sửa chip — {s?.name}</SheetTitle>
          </SheetHeader>
          <div className="text-center text-[13px] text-[#9b8e97]">hiện tại <span className="font-mono">{s?.chip}</span></div>
          <div className="ios-fill mt-3 rounded-2xl py-3 text-center font-mono text-[22px] font-semibold text-[#c9a86a]">{chipDisplay}</div>
          <div className="mt-2 grid grid-cols-3 gap-1.5">
            {CHIP_KEYS.map((k) => (
              <button key={k} onClick={() => pressKey(k)} className="ios-press-sm rounded-xl bg-white/5 py-2.5 text-center text-[16px] text-[#f2ece6]">{k}</button>
            ))}
          </div>
          {onSaveChip ? (
            (() => {
              const cur = target?.chipCount ?? 0;
              const next = Number(chipValue || "0");
              const delta = next - cur;
              return (
                <div className="mt-2.5 rounded-xl bg-white/5 px-3 py-2 text-center text-[13px] text-[#9b8e97]">
                  {cur.toLocaleString("vi-VN")} → <b className="font-mono text-[#f2ece6]">{next.toLocaleString("vi-VN")}</b>
                  {delta !== 0 && <span className={delta > 0 ? " text-emerald-300" : " text-rose-300"}> ({delta > 0 ? "+" : ""}{delta.toLocaleString("vi-VN")})</span>}
                </div>
              );
            })()
          ) : (
            <div className="mt-2.5 rounded-xl bg-amber-400/10 px-3 py-2 text-[13px] text-amber-300">
              Chênh lệch so với hiện tại — lý do: <b className="text-[#f2ece6]">đếm lại</b>
            </div>
          )}
          <button
            disabled={chipBusy || !chipValue || Number(chipValue) < 0}
            onClick={async () => {
              if (onSaveChip) {
                setChipBusy(true);
                const ok = await onSaveChip(Number(chipValue || "0"));
                setChipBusy(false);
                if (ok) close();            // refetch do màn chủ lo; không optimistic
              } else {
                done(`Đã lưu ${chipDisplay} chip`);
              }
            }}
            className="ios-press ios-primary mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[15px] font-bold disabled:opacity-40">
            {chipBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {chipBusy ? "Đang lưu…" : `Lưu ${chipDisplay}`}
          </button>
        </SheetContent>
      </Sheet>

      {/* N6 — phiếu */}
      <Sheet open={sheetOpen("receipt")} onOpenChange={(v) => { if (!v) close(); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">Phiếu #72 <span className="ml-1 rounded-full bg-emerald-400/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">Đã thu</span></SheetTitle>
          </SheetHeader>
          <div className="mt-3 rounded-xl bg-[#F5F1E8] p-3.5 text-[#241A08]">
            <div className="flex justify-between text-[12px] font-semibold"><span>HANOI ROYAL</span><span className="font-mono font-normal">07/07 13:20</span></div>
            <div className="my-2 border-t border-dashed border-[#b8ad9a]" />
            <div className="flex justify-between text-[12px]"><span>{s?.name}</span><span className="font-mono">HSOP Main</span></div>
            <div className="flex justify-between text-[12px]"><span>Buy-in + phí</span><b className="font-mono">5.500.000</b></div>
            <div className="flex justify-between text-[12px]"><span>Bàn · ghế</span><b className="font-mono">{t} · {s?.seat}</b></div>
            <div className="mt-2 text-center">
              <span className="inline-block h-9 w-9 rounded bg-[#241A08]" />
              <div className="font-mono text-[11px]">#72</div>
            </div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => toast("Đã gửi lệnh in (bản mẫu)")} className="ios-press ios-fill flex flex-1 items-center justify-center gap-1.5 rounded-2xl py-3 text-[14px] text-[#f2ece6]">
              <Printer className="h-4 w-4" /> In lại
            </button>
            <button onClick={close} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[14px] text-[#9b8e97]">Đóng</button>
          </div>
        </SheetContent>
      </Sheet>

      {/* S10 — xác nhận Loại (restate hạng + tiền tạm tính). onBustPlayer → THẬT (💰). */}
      <AlertDialog open={sheetOpen("bust")} onOpenChange={(v) => { if (!v && !bustBusy) close(); }}>
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
            <div className="text-[17px] font-semibold text-[#f2ece6]">{s?.name}</div>
            {onBustPlayer ? (
              !bustInfo || bustInfo.loading ? (
                <div className="flex flex-col items-center gap-2 py-4"><Loader2 className="h-6 w-6 animate-spin text-[#c9a86a]" /><span className="text-[13px] text-[#9b8e97]">Đang đọc lại hạng…</span></div>
              ) : (
                <>
                  <div className="mt-2 text-[13px] uppercase tracking-wider text-[#9b8e97]">Về hạng (tạm tính)</div>
                  <div className="font-mono text-[40px] font-bold leading-none text-[#f2ece6]">{bustInfo.place ?? "—"}</div>
                  <div className="mx-auto my-3 h-px w-16 bg-white/8" />
                  {bustInfo.prize && bustInfo.prize > 0 ? (
                    <div className="text-[14px] text-[#9b8e97]">Thưởng <span className="text-amber-300">(tạm tính)</span>: <b className="font-mono text-[#c9a86a]">{bustInfo.prize.toLocaleString("vi-VN")}</b></div>
                  ) : (
                    <div className="text-[14px] text-[#9b8e97]">Ngoài cơ cấu giải — chưa tới hạng có thưởng</div>
                  )}
                </>
              )
            ) : (
              <>
                <div className="mt-2 text-[13px] uppercase tracking-wider text-[#9b8e97]">Về hạng</div>
                <div className="font-mono text-[40px] font-bold leading-none text-[#f2ece6]">84</div>
                <div className="mx-auto my-3 h-px w-16 bg-white/8" />
                <div className="text-[14px] text-[#9b8e97]">Ngoài cơ cấu giải — chưa tới hạng có thưởng (mẫu)</div>
              </>
            )}
          </div>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <button onClick={close} disabled={bustBusy} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6] disabled:opacity-40">Huỷ</button>
            <button
              disabled={bustBusy || (!!onBustPlayer && (!bustInfo || bustInfo.loading))}
              onClick={async () => {
                if (onBustPlayer) {
                  setBustBusy(true);
                  const ok = await onBustPlayer();
                  setBustBusy(false);
                  if (ok) close();              // refetch do màn chủ lo; không optimistic
                } else {
                  done("Đã loại");
                }
              }}
              className="ios-press flex flex-1 items-center justify-center gap-1.5 rounded-2xl bg-rose-500/90 py-3 text-[15px] font-bold text-white disabled:opacity-40">
              {bustBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : <UserMinus className="h-4 w-4" />} {bustBusy ? "Đang loại…" : "Xác nhận loại"}
            </button>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
    </>
  );
}

function Band({ cls, l, r, onTap }: { cls: string; l: React.ReactNode; r: React.ReactNode; onTap?: () => void }) {
  const C = onTap ? "button" : "div";
  return (
    <C onClick={onTap} className={cn("flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-[13px]", cls, onTap && "ios-press-sm text-left")}>
      <span>{l}</span>
      <span>{r}</span>
    </C>
  );
}
