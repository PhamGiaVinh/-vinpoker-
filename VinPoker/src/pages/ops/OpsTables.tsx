import { useState } from "react";
import { toast } from "sonner";
import { Search, Plus, Shuffle, PauseCircle, XCircle } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import { RoomGrid } from "@/components/ops/shared/RoomGrid";
import { PlayerActionSheets, type PlayerTarget } from "@/components/ops/shared/PlayerActionSheets";
import { MOCK_TABLES, MOCK_SEATS, MOCK_WAITLIST, type MockTable, type MockSeat } from "@/components/ops/mock/opsData";

/**
 * Bàn (mobileOpsV2) — theo bản vẽ B1/B2 đã duyệt: cả phòng 1 màn (RoomGrid) → sheet bàn (ghế + người +
 * thao tác) → tap ghế/người = PlayerActionSheets (S7…). Nút phụ: Tìm · +Bàn · Bốc lại ở đáy (thumb-zone).
 * DỮ LIỆU MẪU, read-only — mọi xác nhận là toast "(bản mẫu)".
 */
type SubSheet = "none" | "addPlayer" | "openTable" | "redraw" | "closeTable";

export default function OpsTables() {
  const [openTable, setOpenTable] = useState<MockTable | null>(null);
  const [player, setPlayer] = useState<PlayerTarget | null>(null);
  const [sub, setSub] = useState<SubSheet>("none");
  const [searchOn, setSearchOn] = useState(false);
  const [addSeat, setAddSeat] = useState<number | null>(3);
  const [redrawMode, setRedrawMode] = useState("Final table");

  const openPlayer = (s: MockSeat) => {
    const tableNo = openTable?.tableNo ?? 7;
    setOpenTable(null);
    requestAnimationFrame(() => setPlayer({ seat: s, tableNo }));
  };
  const openSub = (which: SubSheet) => {
    setOpenTable(null);
    requestAnimationFrame(() => setSub(which));
  };
  const done = (msg: string) => {
    toast.success(msg + " (bản mẫu)");
    setSub("none");
  };
  const emptySeats = MOCK_SEATS.filter((s) => !s.name);

  return (
    <div className="ios-in space-y-4 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Bàn</h1>
        <p className="mt-0.5 text-[15px] text-[#9b8e97]">Cả phòng trong một màn · chạm 1 bàn để thao tác</p>
      </header>

      {searchOn && (
        <div className="ios-fill flex items-center gap-2 rounded-2xl px-4 py-3">
          <Search className="h-[18px] w-[18px] text-[#9b8e97]" />
          <input autoFocus placeholder="Số bàn / tên người chơi…" className="flex-1 bg-transparent text-[15px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
        </div>
      )}

      <RoomGrid tables={MOCK_TABLES} onTap={setOpenTable} />

      {/* hàng nút đáy — thumb zone */}
      <div className="flex items-center gap-2">
        <button onClick={() => setSearchOn((v) => !v)} className="ios-press ios-fill grid h-12 w-12 shrink-0 place-items-center rounded-2xl text-[#f2ece6]">
          <Search className="h-5 w-5" />
        </button>
        <button onClick={() => openSub("openTable")} className="ios-press ios-fill flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-medium text-[#f2ece6]">
          <Plus className="h-[18px] w-[18px]" /> Bàn
        </button>
        <button onClick={() => openSub("redraw")} className="ios-press ios-fill flex h-12 flex-1 items-center justify-center gap-1.5 rounded-2xl text-[15px] font-medium text-[#f2ece6]">
          <Shuffle className="h-[18px] w-[18px]" /> Bốc lại
        </button>
      </div>

      {/* B2 — sheet bàn: ghế + người + thao tác */}
      <Sheet open={openTable !== null} onOpenChange={(v) => { if (!v) setOpenTable(null); }}>
        <SheetContent side="bottom" className="max-h-[88vh] overflow-y-auto rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">
              Bàn {openTable?.tableNo}
              {openTable?.needsFloor && <span className="ml-2 rounded-full bg-amber-400/12 px-2 py-0.5 text-[11px] font-semibold text-amber-300">Cần xử lý</span>}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-center font-mono text-[13px] text-[#9b8e97]">
            {openTable?.occ}/{openTable?.max} ghế · dealer {openTable?.dealer ?? "—"}
          </div>

          <div className="mt-3 flex justify-center gap-1">
            {MOCK_SEATS.map((s) => (
              <button key={s.seat} onClick={() => s.name && openPlayer(s)} disabled={!s.name}
                className={cn("ios-press-sm grid h-7 w-7 place-items-center rounded-md text-[12px] font-semibold",
                  s.name ? "bg-[#2c2135] text-[#f2ece6]" : "bg-white/4 text-[#5f545c]")}>
                {s.seat}
              </button>
            ))}
          </div>
          <div className="mt-1 text-center text-[11px] text-[#7c7079]">chạm 1 ghế → thao tác người chơi</div>

          <div className="ios-group mt-3">
            {MOCK_SEATS.filter((s) => s.name).map((s) => (
              <button key={s.seat} onClick={() => openPlayer(s)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="w-5 font-mono text-[13px] text-[#9b8e97]">{s.seat}</span>
                <span className="flex-1 truncate text-[15px] text-[#f2ece6]">{s.name}</span>
                <span className="font-mono text-[13px] text-[#c9a86a]">{s.chip}</span>
              </button>
            ))}
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2">
            <button onClick={() => openSub("addPlayer")} className="ios-press ios-tinted flex items-center justify-center gap-1 rounded-2xl py-3 text-[13px] font-semibold">
              <Plus className="h-4 w-4" /> Thêm người
            </button>
            <button onClick={() => { setOpenTable(null); toast("Đã tạm dừng bàn (bản mẫu)"); }} className="ios-press ios-fill flex items-center justify-center gap-1 rounded-2xl py-3 text-[13px] font-medium text-amber-300">
              <PauseCircle className="h-4 w-4" /> Tạm dừng
            </button>
            <button onClick={() => openSub("closeTable")} className="ios-press flex items-center justify-center gap-1 rounded-2xl bg-rose-500/12 py-3 text-[13px] font-semibold text-rose-300">
              <XCircle className="h-4 w-4" /> Đóng bàn
            </button>
          </div>
        </SheetContent>
      </Sheet>

      {/* N4 — thêm người từ hàng chờ */}
      <Sheet open={sub === "addPlayer"} onOpenChange={(v) => { if (!v) setSub("none"); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">Thêm người</SheetTitle>
          </SheetHeader>
          <div className="text-center text-[13px] text-[#9b8e97]">lấy từ hàng chờ đã đóng tiền</div>
          <div className="ios-group mt-3">
            {MOCK_WAITLIST.map((w, i) => (
              <div key={w.ref} className={cn("ios-row-inset flex items-center gap-3 px-4 py-3", i === 0 && "bg-[#c9a86a]/8")}>
                <span className="min-w-0 flex-1">
                  <span className="block truncate text-[15px] text-[#f2ece6]">{w.name} <span className="font-mono text-[12px] text-[#9b8e97]">{w.ref}</span></span>
                  <span className="block text-[12px] text-[#9b8e97]">{w.note}</span>
                </span>
                {i === 0 && <span className="rounded-full bg-[#c9a86a]/15 px-2 py-0.5 text-[11px] font-semibold text-[#d8bc85]">đã chọn</span>}
              </div>
            ))}
          </div>
          <div className="mt-3 px-1 text-[12px] text-[#9b8e97]">Ghế trống — chạm để xếp</div>
          <div className="mt-1.5 flex gap-1.5 px-1">
            {emptySeats.map((s) => (
              <button key={s.seat} onClick={() => setAddSeat(s.seat)}
                className={cn("ios-press-sm grid h-9 w-10 place-items-center rounded-lg text-[14px] font-semibold",
                  addSeat === s.seat ? "bg-[#c9a86a] text-[#241A08]" : "bg-emerald-400/15 text-emerald-300")}>
                {s.seat}
              </button>
            ))}
          </div>
          <button onClick={() => done(`Đã xếp ${MOCK_WAITLIST[0].name} vào ghế ${addSeat}`)} className="ios-press ios-primary mt-4 w-full rounded-2xl py-3 text-[15px] font-bold">
            Xếp {MOCK_WAITLIST[0].name} vào ghế {addSeat}
          </button>
        </SheetContent>
      </Sheet>

      {/* mở bàn — form 2 ô */}
      <Sheet open={sub === "openTable"} onOpenChange={(v) => { if (!v) setSub("none"); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">Mở bàn mới</SheetTitle>
          </SheetHeader>
          <div className="mt-3 grid grid-cols-2 gap-2">
            <div>
              <div className="px-1 text-[12px] text-[#9b8e97]">Số bàn</div>
              <div className="ios-fill mt-1 rounded-xl py-2.5 text-center font-mono text-[16px] text-[#f2ece6]">21</div>
            </div>
            <div>
              <div className="px-1 text-[12px] text-[#9b8e97]">Số ghế</div>
              <div className="ios-fill mt-1 rounded-xl py-2.5 text-center font-mono text-[16px] text-[#f2ece6]">9</div>
            </div>
          </div>
          <button onClick={() => done("Đã mở bàn 21")} className="ios-press ios-primary mt-4 w-full rounded-2xl py-3 text-[15px] font-bold">Mở bàn 21</button>
        </SheetContent>
      </Sheet>

      {/* bốc lại — kiểu → xem trước → xác nhận */}
      <Sheet open={sub === "redraw"} onOpenChange={(v) => { if (!v) setSub("none"); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">Bốc lại bàn</SheetTitle>
          </SheetHeader>
          <div className="mt-2 flex flex-wrap justify-center gap-1.5">
            {["Final table", "ITM", "Ngưỡng", "Thủ công"].map((m) => (
              <button key={m} onClick={() => setRedrawMode(m)}
                className={cn("ios-press-sm rounded-full px-3 py-1.5 text-[13px] font-medium", redrawMode === m ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
                {m}
              </button>
            ))}
          </div>
          <div className="ios-card mt-3 p-3.5 text-[13px]">
            <div className="mb-1 text-[12px] uppercase tracking-wide text-[#9b8e97]">Xem trước</div>
            <div className="flex justify-between border-b border-white/6 py-1.5"><span className="text-[#f2ece6]">Bàn 1</span><span className="font-mono text-[#9b8e97]">A · B · C · D…</span></div>
            <div className="flex justify-between border-b border-white/6 py-1.5"><span className="text-[#f2ece6]">Bàn 2</span><span className="font-mono text-[#9b8e97]">E · F · G…</span></div>
            <div className="pt-1.5 text-[#d8bc85]">→ 9 bàn · 84 người</div>
          </div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setSub("none")} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6]">Huỷ</button>
            <button onClick={() => done("Đã bốc lại 9 bàn")} className="ios-press flex-[2] rounded-2xl bg-rose-500/90 py-3 text-[15px] font-bold text-white">Xác nhận bốc lại</button>
          </div>
        </SheetContent>
      </Sheet>

      {/* R1 — đóng bàn: máy chia sẵn, xem trước rồi đóng */}
      <Sheet open={sub === "closeTable"} onOpenChange={(v) => { if (!v) setSub("none"); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">Đóng bàn 12 <span className="ml-1 rounded-full bg-amber-400/12 px-2 py-0.5 text-[11px] font-semibold text-amber-300">5 người phải chuyển</span></SheetTitle>
          </SheetHeader>
          <div className="ios-card mt-3 p-3.5 text-[13px]">
            <div className="mb-1 text-[12px] text-[#9b8e97]">Máy chia tự động vào ghế trống</div>
            <div className="flex justify-between border-b border-white/6 py-1.5"><span className="text-[#f2ece6]">Phạm D</span><span className="font-mono text-[#9b8e97]">→ Bàn 8 · ghế 4</span></div>
            <div className="flex justify-between border-b border-white/6 py-1.5"><span className="text-[#f2ece6]">Võ E</span><span className="font-mono text-[#9b8e97]">→ Bàn 9 · ghế 2</span></div>
            <div className="flex justify-between border-b border-white/6 py-1.5"><span className="text-[#f2ece6]">Đinh F</span><span className="font-mono text-[#9b8e97]">→ Bàn 8 · ghế 7</span></div>
            <div className="flex justify-between pt-1.5"><span className="text-[#9b8e97]">+ 2 người nữa</span><span className="text-[#d8bc85]">sửa tay ▾</span></div>
          </div>
          <div className="mt-2 px-1 text-[12px] text-[#9b8e97]">Sau khi đóng: in phiếu ghế mới cho từng người.</div>
          <div className="mt-3 flex gap-2">
            <button onClick={() => setSub("none")} className="ios-press ios-fill flex-1 rounded-2xl py-3 text-[15px] font-medium text-[#f2ece6]">Huỷ</button>
            <button onClick={() => done("Đã đóng bàn và chuyển 5 người")} className="ios-press flex-[2] rounded-2xl bg-rose-500/90 py-3 text-[15px] font-bold text-white">Đóng bàn &amp; chuyển 5 người</button>
          </div>
        </SheetContent>
      </Sheet>

      <PlayerActionSheets target={player} onClose={() => setPlayer(null)} />
    </div>
  );
}
