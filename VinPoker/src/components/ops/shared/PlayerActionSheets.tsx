import { useState } from "react";
import { User, ArrowRightLeft, Coins, Receipt, UserMinus, IdCard, Loader2 } from "lucide-react";
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

/**
 * Production Floor player actions. Every displayed value comes from the selected
 * live seat; writes are delegated to audited callbacks owned by the parent.
 */
export interface PlayerTarget {
  seat: {
    seat: number;
    name: string | null;
    chip: string | null;
    entryNo?: number;
  };
  tableNo: number;
  chipCount: number;
}

type Step = "actions" | "info" | "move" | "chip" | "receipt" | "bust" | null;

const MOVE_REASONS = ["cân bàn", "gãy bàn", "yêu cầu TD"];
const CHIP_KEYS = ["1", "2", "3", "4", "5", "6", "7", "8", "9", "00", "0", "⌫"];

export function PlayerActionSheets({
  target,
  onClose,
  onSaveChip,
  onBustPlayer,
  onOpenBust,
  bustInfo,
  moveTargets,
  onMovePlayer,
  onOpenReceipt,
  infoLive,
}: {
  target: PlayerTarget | null;
  onClose: () => void;
  onSaveChip: (newChip: number) => Promise<boolean>;
  onBustPlayer: () => Promise<boolean>;
  onOpenBust: () => void;
  bustInfo: { loading: boolean; place: number | null; prize: number | null } | null;
  moveTargets: { tt_id: string; table_number: number | null; freeSeats: number[] }[];
  onMovePlayer: (toTtId: string, toSeat: number, reason: string) => Promise<boolean>;
  onOpenReceipt: () => void;
  infoLive: true;
}) {
  const [step, setStep] = useState<Step>("actions");
  const [moveSeat, setMoveSeat] = useState<number | null>(4);
  const [moveReason, setMoveReason] = useState(MOVE_REASONS[0]);
  const [chipValue, setChipValue] = useState("62500");
  const [chipBusy, setChipBusy] = useState(false);
  const [bustBusy, setBustBusy] = useState(false);
  const [moveTableId, setMoveTableId] = useState<string | null>(null);
  const [moveBusy, setMoveBusy] = useState(false);

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
  const act = (next: Step) => {
    if (next === "chip") {
      setChipValue(String(target?.chipCount ?? 0));
      go("chip");
      return;
    }
    if (next === "bust") {
      onOpenBust();            // đọc lại hạng + thưởng tạm tính ngay khi mở
      go("bust");
      return;
    }
    if (next === "move") {
      const first = moveTargets.length > 0 ? moveTargets[0] : null;
      setMoveTableId(first?.tt_id ?? null);
      setMoveSeat(first && first.freeSeats.length > 0 ? first.freeSeats[0] : null);
      go("move");
      return;
    }
    if (next === "info" && infoLive) {
      go("info");                // S8 hiện dữ liệu thật từ target — read-only
      return;
    }
    if (next === "receipt") {
      onOpenReceipt();           // màn chủ mở SeatReceiptDialog (QR + in); đọc entry_id, không ghi
      close();
      return;
    }
  };

  const chipDisplay = Number(chipValue || "0").toLocaleString("vi-VN");
  const selMoveTarget = moveTargets.find((x) => x.tt_id === moveTableId) ?? null;
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
          </SheetHeader>
          {/* Chỉ dữ liệu THẬT từ target (tên/bàn·ghế/chip/lượt vào). SĐT/hạng/thưởng/mã thẻ không có
              trên floor → không hiện số giả. Phiếu → mở SeatReceiptDialog thật; Ghế → chuyển bàn/ghế. */}
          <div className="mt-3 space-y-1.5">
            <Band cls="bg-[#241a0c]" l={<span className="text-[#d8bc85]">Phiếu</span>} r={<span className="text-[#9b8e97]">xem / in lại →</span>} onTap={() => act("receipt")} />
            <Band cls="bg-emerald-400/10" l={<span className="text-emerald-300">Ghế</span>} r={<span className="font-mono text-[#f2ece6]">{t}-{s?.seat} <span className="text-[#9b8e97]">· chạm để đổi</span></span>} onTap={() => act("move")} />
            <Band cls="bg-[#241a0c]" l={<span className="text-[#d8bc85]">Chip</span>} r={<span className="font-mono text-[#c9a86a]">{s?.chip}</span>} />
            <Band cls="bg-white/5" l={<span className="text-[#9b8e97]">Lượt vào</span>} r={<span className="font-mono text-[#f2ece6]">#{s?.entryNo ?? 1}</span>} />
          </div>
          <button disabled className="ios-fill mt-3 flex w-full cursor-not-allowed items-center justify-center gap-1.5 rounded-2xl py-2.5 text-[13px] text-[#9b8e97] opacity-70">
            <IdCard className="h-4 w-4" /> Cấp lại thẻ: dùng Cashier trên máy tính
          </button>
        </SheetContent>
      </Sheet>

      {/* S9 — chuyển bàn/ghế. onMovePlayer → THẬT (bàn/ghế trống từ moveTargets → move_player_seat) */}
      <Sheet open={sheetOpen("move")} onOpenChange={(v) => { if (!v && !moveBusy) close(); }}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-left">
            <SheetTitle className="text-[#f2ece6]">Chuyển bàn / ghế</SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-[13px] text-[#9b8e97]">{s?.name} · đang ở <span className="font-mono">Bàn {t} · Ghế {s?.seat}</span></div>

          {moveTargets.length > 0 ? (
              <>
                <div className="ios-card mt-3 p-3.5">
                  <div className="text-[12px] text-[#9b8e97]">Chọn bàn đích (còn ghế trống)</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {moveTargets.map((tb) => (
                      <button key={tb.tt_id} onClick={() => { setMoveTableId(tb.tt_id); setMoveSeat(tb.freeSeats[0] ?? null); }}
                        className={cn("ios-press-sm grid h-8 min-w-9 place-items-center rounded-lg px-2 text-[13px] font-semibold",
                          moveTableId === tb.tt_id ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
                        {tb.table_number ?? "?"}
                      </button>
                    ))}
                  </div>
                  <div className="mt-3 text-[12px] text-[#9b8e97]">Ghế trống — chạm để chọn</div>
                  <div className="mt-1.5 flex flex-wrap gap-1.5">
                    {(selMoveTarget?.freeSeats ?? []).map((seatNo) => (
                      <button key={seatNo} onClick={() => setMoveSeat(seatNo)}
                        className={cn("ios-press-sm grid h-8 w-9 place-items-center rounded-lg text-[13px] font-semibold",
                          moveSeat === seatNo ? "bg-[#c9a86a] text-[#241A08]" : "bg-emerald-400/15 text-emerald-300")}>
                        {seatNo}
                      </button>
                    ))}
                    {(selMoveTarget?.freeSeats.length ?? 0) === 0 && <span className="text-[13px] text-[#9b8e97]">Bàn này hết ghế trống.</span>}
                  </div>
                </div>
                <div className="ios-fill mt-2 rounded-2xl py-2.5 text-center text-[14px]">
                  <span className="font-mono text-[#f2ece6]">Bàn {t} · Ghế {s?.seat}</span>
                  <span className="mx-2 text-[#c9a86a]">→</span>
                  <span className="font-mono text-[#d8bc85]">Bàn {selMoveTarget?.table_number ?? "?"} · Ghế {moveSeat ?? "—"}</span>
                </div>
                <div className="mt-2 flex flex-wrap items-center gap-1.5 px-1 text-[13px] text-[#9b8e97]">
                  Lý do:
                  {MOVE_REASONS.map((r) => (
                    <button key={r} onClick={() => setMoveReason(r)}
                      className={cn("ios-press-sm rounded-full px-2.5 py-1 text-[12px]", moveReason === r ? "bg-[#c9a86a]/15 text-[#d8bc85]" : "bg-white/5 text-[#9b8e97]")}>
                      {r}
                    </button>
                  ))}
                </div>
                <div className="mt-3 flex gap-2">
                  <button onClick={close} disabled={moveBusy} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6] disabled:opacity-40">Huỷ</button>
                  <button
                    disabled={moveBusy || moveTableId === null || moveSeat === null}
                    onClick={async () => {
                      if (moveTableId === null || moveSeat === null) return;
                      setMoveBusy(true);
                      const ok = await onMovePlayer(moveTableId, moveSeat, moveReason);
                      setMoveBusy(false);
                      if (ok) close();            // refetch do màn chủ lo; không optimistic
                    }}
                    className="ios-press ios-primary flex-[2] flex items-center justify-center gap-2 rounded-2xl py-3 text-[15px] font-bold disabled:opacity-40">
                    {moveBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null} {moveBusy ? "Đang chuyển…" : "Xác nhận chuyển"}
                  </button>
                </div>
              </>
            ) : (
              <div className="ios-card mt-3 flex flex-col items-center gap-2 py-8 text-center">
                <ArrowRightLeft className="h-7 w-7 text-[#9b8e97]" />
                <div className="text-[14px] text-[#9b8e97]">Không còn ghế trống ở bàn khác — mở thêm bàn trước.</div>
                <button onClick={close} className="ios-press-sm mt-1 rounded-full bg-white/8 px-4 py-1.5 text-[13px] text-[#f2ece6]">Đóng</button>
              </div>
            )}
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
          {(() => {
              const cur = target?.chipCount ?? 0;
              const next = Number(chipValue || "0");
              const delta = next - cur;
              return (
                <div className="mt-2.5 rounded-xl bg-white/5 px-3 py-2 text-center text-[13px] text-[#9b8e97]">
                  {cur.toLocaleString("vi-VN")} → <b className="font-mono text-[#f2ece6]">{next.toLocaleString("vi-VN")}</b>
                  {delta !== 0 && <span className={delta > 0 ? " text-emerald-300" : " text-rose-300"}> ({delta > 0 ? "+" : ""}{delta.toLocaleString("vi-VN")})</span>}
                </div>
              );
            })()}
          <button
            disabled={chipBusy || !chipValue || Number(chipValue) < 0}
            onClick={async () => {
              setChipBusy(true);
              const ok = await onSaveChip(Number(chipValue || "0"));
              setChipBusy(false);
              if (ok) close();            // refetch do màn chủ lo; không optimistic
            }}
            className="ios-press ios-primary mt-3 flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[15px] font-bold disabled:opacity-40">
            {chipBusy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
            {chipBusy ? "Đang lưu…" : `Lưu ${chipDisplay}`}
          </button>
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
            <AlertDialogDescription className="text-[#9b8e97]">Kiểm tra hạng và thưởng tạm tính. Thao tác này chỉ loại người chơi, không tự trả hoặc chốt thưởng.</AlertDialogDescription>
          </AlertDialogHeader>
          <div className="ios-card p-5 text-center">
            <div className="text-[17px] font-semibold text-[#f2ece6]">{s?.name}</div>
            {!bustInfo || bustInfo.loading ? (
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
            )}
          </div>
          <AlertDialogFooter className="gap-2 sm:gap-2">
            <button onClick={close} disabled={bustBusy} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6] disabled:opacity-40">Huỷ</button>
            <button
              disabled={bustBusy || !bustInfo || bustInfo.loading}
              onClick={async () => {
                setBustBusy(true);
                const ok = await onBustPlayer();
                setBustBusy(false);
                if (ok) close();              // refetch do màn chủ lo; không optimistic
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
