import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronLeft, Repeat, Users, Coffee, ArrowRightLeft, History, Lightbulb, QrCode,
  Monitor, LogOut, ArrowRight, Clock, FlagTriangleRight,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { cn } from "@/lib/utils";
import {
  SWING_TABLES, SWING_DEALERS, SWING_STAFF, SWING_CHECKIN_LIST, SWING_CHECKOUT_LIST, BREAK_PRESETS,
  type SwingTable, type SwingDealer,
} from "@/components/ops/mock/swingData";

/**
 * Dealer Swing (mobileOpsV2) — theo bản vẽ đã duyệt D1–D6 + P1/P2:
 * pills Bàn(D1) · Dealer(D3) · Nhân sự(D5) · Kết ca(D6). Việc gấp (OT / thiếu) nổi lên đầu.
 * Tap bàn → D2 (swing 1-chạm + gợi ý người kế tiếp, chọn dealer khác P1, cho nghỉ, sửa nhầm bàn).
 * Tap dealer → D4 (đưa vào bàn, cho nghỉ, ca hôm nay, check-out). Đóng tour = gõ "DONG TOUR" 2 lớp khoá.
 * DỮ LIỆU MẪU, read-only — mọi xác nhận là toast "(bản mẫu)". Cấu hình/planner/lương = máy tính.
 */
const PILLS = [
  { key: "tables", label: "Bàn" },
  { key: "dealers", label: "Dealer" },
  { key: "staff", label: "Nhân sự" },
  { key: "close", label: "Kết ca" },
] as const;
type Pill = (typeof PILLS)[number]["key"];

function countdown(t: SwingTable) {
  if (t.missing) return { text: "thiếu dealer", cls: "text-rose-300" };
  if (t.remainMin < 0) return { text: `OT +${String(Math.abs(t.remainMin)).padStart(2, "0")}:12`, cls: "text-rose-300" };
  if (t.remainMin < 5) return { text: `còn 0${t.remainMin}:10`, cls: "text-amber-300" };
  return { text: `còn ${t.remainMin}:30`, cls: "text-emerald-300" };
}

const DEALER_CHIP: Record<SwingDealer["state"], { label: string; cls: string }> = {
  active: { label: "Đang bàn", cls: "bg-sky-400/12 text-sky-300" },
  ready: { label: "Sẵn sàng", cls: "bg-emerald-400/12 text-emerald-300" },
  rest: { label: "Nghỉ", cls: "bg-white/6 text-[#9b8e97]" },
  preassign: { label: "Sắp vào", cls: "bg-pink-400/12 text-pink-300" },
  missing: { label: "Thiếu", cls: "bg-rose-400/12 text-rose-300" },
  pending: { label: "Chờ duyệt", cls: "bg-amber-400/12 text-amber-300" },
};

export default function OpsDealerSwing() {
  const navigate = useNavigate();
  const [pill, setPill] = useState<Pill>("tables");
  const [tableSheet, setTableSheet] = useState<SwingTable | null>(null);
  const [dealerSheet, setDealerSheet] = useState<SwingDealer | null>(null);
  const [pickFor, setPickFor] = useState<number | null>(null); // chọn dealer khác cho bàn N
  const [breakFor, setBreakFor] = useState<string | null>(null);
  const [checkinOpen, setCheckinOpen] = useState(false);
  const [dongTour, setDongTour] = useState("");
  const [checkout, setCheckout] = useState(() => new Set(SWING_CHECKOUT_LIST.filter((d) => d.checked).map((d) => d.name)));

  const sortedTables = [...SWING_TABLES].sort((a, b) => (a.missing ? -2 : a.remainMin) - (b.missing ? -2 : b.remainMin));

  const go = <T,>(setter: (v: T) => void, v: T) => {
    setTableSheet(null); setDealerSheet(null);
    requestAnimationFrame(() => setter(v));
  };
  const doneToast = (m: string) => { setTableSheet(null); setDealerSheet(null); setPickFor(null); setBreakFor(null); setCheckinOpen(false); toast.success(m + " (bản mẫu)"); };

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Dealer Swing</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">Hanoi Royal · việc gấp tự nổi lên đầu</p>
      </header>

      <div className="flex gap-1.5 px-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm rounded-full px-3.5 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            {p.label}
          </button>
        ))}
      </div>

      {/* D1 — Bàn + đếm ngược */}
      {pill === "tables" && (
        <div className="space-y-3">
          <div className="ios-card flex items-center justify-between px-4 py-3 text-[13px]">
            <span><span className="text-sky-300">12 đang bàn</span> · <span className="text-[#9b8e97]">4 nghỉ</span></span>
            <span className="rounded-full bg-rose-400/12 px-2 py-0.5 text-[11px] font-semibold text-rose-300">thiếu 1</span>
          </div>
          <div className="ios-group">
            {sortedTables.map((t) => {
              const c = countdown(t);
              return (
                <button key={t.tableNo} onClick={() => setTableSheet(t)}
                  className={cn("ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left", (t.missing || t.remainMin < 0) && "bg-rose-500/6")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">Bàn {t.tableNo} <span className="text-[#9b8e97]">· {t.dealer ?? "—"}</span></span>
                    <span className="block text-[12px] text-[#9b8e97]">{t.missing ? "6 phút chưa có người" : t.next ? `kế tiếp: ${t.next}` : `vào ${t.since}`}</span>
                  </span>
                  {t.missing
                    ? <span className="rounded-full bg-rose-400/12 px-2.5 py-1 text-[11px] font-semibold text-rose-300">Gán ngay</span>
                    : <span className={cn("font-mono text-[13px]", c.cls)}>{c.text}</span>}
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* D3 — Dealer pool */}
      {pill === "dealers" && (
        <div className="ios-group">
          {SWING_DEALERS.map((d) => {
            const chip = DEALER_CHIP[d.state];
            return (
              <button key={d.name} onClick={() => setDealerSheet(d)}
                className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-[#f2ece6]">{d.name.replace(/\d$/, "")}</span>
                  <span className="block font-mono text-[12px] text-[#9b8e97]">{d.info}</span>
                </span>
                <span className={cn("rounded-full px-2.5 py-1 text-[11px] font-semibold", chip.cls)}>{chip.label}</span>
              </button>
            );
          })}
        </div>
      )}

      {/* D5 — Nhân sự ca */}
      {pill === "staff" && (
        <div className="space-y-3">
          <div className="ios-card p-4">
            <Line l="Cần theo nhịp xoay" v={String(SWING_STAFF.need)} />
            <Line l="Đang có" v={String(SWING_STAFF.have)} vCls="text-emerald-300" />
            <Line l="Dư — có thể cho về" v={String(SWING_STAFF.surplus)} vCls="text-amber-300" />
          </div>
          <div className="ios-card flex items-start gap-2 p-3.5">
            <Lightbulb className="mt-0.5 h-4 w-4 shrink-0 text-[#d8bc85]" />
            <div className="text-[13px]">
              <span className="text-[#d8bc85]">Gợi ý cho về: <b>{SWING_STAFF.suggestRelease}</b></span>
              <div className="text-[#9b8e97]">{SWING_STAFF.suggestReason} · chỉ gợi ý — anh quyết</div>
            </div>
          </div>
          <div className="ios-group">
            <button onClick={() => setCheckinOpen(true)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <QrCode className="h-5 w-5 text-[#d8bc85]" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Check-in dealer mới</span><span className="block text-[12px] text-[#9b8e97]">quét QR hoặc chọn từ danh sách</span></span>
            </button>
            <button onClick={() => toast("Duyệt nghỉ ưu tiên (bản mẫu)")} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <Clock className="h-5 w-5 text-amber-300" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Duyệt nghỉ ưu tiên</span><span className="block text-[12px] text-[#9b8e97]">Sơn xin nghỉ 13:55</span></span>
              <span className="rounded-full bg-amber-400/12 px-2 py-0.5 text-[11px] font-semibold text-amber-300">1 chờ</span>
            </button>
            <button onClick={() => toast("Mở planner trên máy tính")} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <Monitor className="h-5 w-5 text-[#9b8e97]" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Xếp lịch dealer (planner)</span><span className="block text-[12px] text-[#9b8e97]">bản đầy đủ trên máy tính</span></span>
            </button>
          </div>
        </div>
      )}

      {/* D6 — Kết ca */}
      {pill === "close" && (
        <div className="space-y-3">
          <div className="ios-card p-3.5">
            <div className="text-[15px] font-semibold text-[#f2ece6]">Check-out hàng loạt</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">chọn dealer đã xong ca</div>
            <div className="mt-2.5 space-y-1">
              {SWING_CHECKOUT_LIST.map((d) => {
                const on = checkout.has(d.name);
                return (
                  <button key={d.name} onClick={() => setCheckout((s) => { const n = new Set(s); n.has(d.name) ? n.delete(d.name) : n.add(d.name); return n; })}
                    className="ios-press-sm flex w-full items-center gap-2.5 rounded-lg px-2 py-2 text-left">
                    <span className={cn("grid h-5 w-5 place-items-center rounded-md border", on ? "border-[#c9a86a] bg-[#c9a86a] text-[#241A08]" : "border-white/20 text-transparent")}>✓</span>
                    <span className="flex-1 text-[14px] text-[#f2ece6]">{d.name}</span>
                    <span className="font-mono text-[12px] text-[#9b8e97]">{d.hours}</span>
                  </button>
                );
              })}
            </div>
            <button onClick={() => doneToast(`Đã check-out ${checkout.size} người`)} disabled={checkout.size === 0}
              className="ios-press ios-fill mt-2.5 w-full rounded-2xl py-2.5 text-[14px] font-medium text-[#f2ece6] disabled:opacity-40">
              Check-out {checkout.size} người đã chọn
            </button>
          </div>

          <div className="ios-card border border-rose-500/20 p-3.5">
            <div className="flex items-center gap-1.5 text-[15px] font-semibold text-rose-300"><FlagTriangleRight className="h-4 w-4" /> Đóng tour</div>
            <div className="mt-0.5 text-[12px] text-[#9b8e97]">lưu trữ toàn bộ ca + trả bàn về trống. Không hoàn tác.</div>
            <input value={dongTour} onChange={(e) => setDongTour(e.target.value.toUpperCase())} placeholder="gõ  DONG TOUR  để mở khoá"
              className="ios-fill mt-2.5 w-full rounded-xl px-3 py-2.5 text-center font-mono text-[14px] tracking-wider text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
            <button onClick={() => { doneToast("Đã đóng tour"); setDongTour(""); }} disabled={dongTour.trim() !== "DONG TOUR"}
              className={cn("ios-press mt-2.5 w-full rounded-2xl py-3 text-[15px] font-bold", dongTour.trim() === "DONG TOUR" ? "bg-rose-500/90 text-white" : "bg-white/5 text-[#5f545c]")}>
              Đóng tour {dongTour.trim() !== "DONG TOUR" && "(đang khoá)"}
            </button>
          </div>
        </div>
      )}

      {/* D2 — sheet bàn: swing 1-chạm */}
      <Sheet open={tableSheet !== null} onOpenChange={(v) => { if (!v) setTableSheet(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">
              Bàn {tableSheet?.tableNo}
              {tableSheet && (tableSheet.missing || tableSheet.remainMin < 0) && <span className="ml-2 rounded-full bg-rose-400/12 px-2 py-0.5 text-[11px] font-semibold text-rose-300">{tableSheet.missing ? "Thiếu dealer" : "OT"}</span>}
            </SheetTitle>
          </SheetHeader>
          <div className="mt-0.5 text-center font-mono text-[13px] text-[#9b8e97]">
            {tableSheet?.dealer ?? "—"} · vào {tableSheet?.since} · chuẩn 40p
          </div>
          {tableSheet?.next && (
            <div className="ios-card mt-3 flex items-center gap-2 px-3.5 py-2.5 text-[13px]">
              <Lightbulb className="h-4 w-4 text-[#d8bc85]" />
              <span className="text-[#d8bc85]">Kế tiếp theo lịch: <b>{tableSheet.next}</b></span>
              <span className="text-[#9b8e97]">· đã nghỉ đủ 15p</span>
            </div>
          )}
          <div className="mt-3 space-y-1.5">
            <button onClick={() => doneToast(`Swing — ${tableSheet?.next ?? "dealer mới"} vào bàn ${tableSheet?.tableNo}`)}
              className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
              <Repeat className="h-5 w-5 shrink-0" />
              <span className="text-[15px] font-bold">{tableSheet?.missing ? "Gán dealer ngay" : `Swing ngay — ${tableSheet?.next ?? "chọn"} vào thay`}</span>
            </button>
            <SheetRow icon={<Users className="h-5 w-5 text-sky-300" />} label="Chọn dealer khác…" onTap={() => go(setPickFor, tableSheet?.tableNo ?? 0)} />
            <SheetRow icon={<Coffee className="h-5 w-5 text-amber-300" />} label={`Cho ${tableSheet?.dealer ?? "dealer"} nghỉ sau khi thay`} onTap={() => go(setBreakFor, tableSheet?.dealer ?? "")} />
            <SheetRow icon={<ArrowRightLeft className="h-5 w-5 text-[#9b8e97]" />} label="Sửa nhầm bàn (đổi chéo)" onTap={() => doneToast("Mở sửa nhầm bàn")} />
            <SheetRow icon={<History className="h-5 w-5 text-[#9b8e97]" />} label="Lịch sử bàn này" onTap={() => doneToast("Lịch sử bàn")} />
          </div>
        </SheetContent>
      </Sheet>

      {/* D4 — sheet dealer */}
      <Sheet open={dealerSheet !== null} onOpenChange={(v) => { if (!v) setDealerSheet(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="items-center text-center">
            <div className="mx-auto grid h-11 w-11 place-items-center rounded-full border border-sky-400 bg-[#241A2C] text-[15px] font-semibold text-sky-300">
              {(dealerSheet?.name ?? "?").replace(/\d$/, "").slice(0, 2)}
            </div>
            <SheetTitle className="mt-1.5 text-[16px] font-semibold text-[#f2ece6]">
              {dealerSheet?.name.replace(/\d$/, "")} {dealerSheet && <span className={cn("ml-1 rounded-full px-2 py-0.5 text-[11px] font-semibold", DEALER_CHIP[dealerSheet.state].cls)}>{DEALER_CHIP[dealerSheet.state].label}</span>}
            </SheetTitle>
            <div className="font-mono text-[12px] text-[#9b8e97]">check-in 09:00 · {dealerSheet?.info}</div>
          </SheetHeader>
          <div className="mt-3 space-y-1.5">
            <button onClick={() => doneToast(`Đưa ${dealerSheet?.name.replace(/\d$/, "")} vào bàn`)}
              className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
              <ArrowRight className="h-5 w-5 shrink-0" />
              <span className="text-[15px] font-bold">Đưa vào bàn…</span>
              <span className="ml-auto text-[12px] font-normal opacity-80">gợi ý: bàn 9 (OT)</span>
            </button>
            <SheetRow icon={<Coffee className="h-5 w-5 text-amber-300" />} label="Cho nghỉ ưu tiên" onTap={() => go(setBreakFor, dealerSheet?.name ?? "")} />
            <SheetRow icon={<Clock className="h-5 w-5 text-[#9b8e97]" />} label="Ca hôm nay — giờ vào/ra, số bàn đã chia" onTap={() => doneToast("Ca hôm nay")} />
            <SheetRow icon={<LogOut className="h-5 w-5 text-rose-300" />} label={<span className="text-rose-300">Check-out khỏi ca</span>} onTap={() => doneToast(`Đã check-out ${dealerSheet?.name.replace(/\d$/, "")}`)} />
          </div>
        </SheetContent>
      </Sheet>

      {/* P1 — chọn dealer khác (chưa đủ nghỉ bị khoá) */}
      <Sheet open={pickFor !== null} onOpenChange={(v) => { if (!v) setPickFor(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Chọn dealer vào bàn {pickFor}</SheetTitle></SheetHeader>
          <div className="ios-group mt-3">
            {SWING_DEALERS.filter((d) => d.state === "ready" || d.state === "rest" || d.state === "pending").map((d, i) => {
              const locked = d.state !== "ready";
              return (
                <button key={d.name} disabled={locked} onClick={() => doneToast(`Đưa ${d.name.replace(/\d$/, "")} vào bàn ${pickFor}`)}
                  className={cn("ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left", !locked && "ios-press-sm", locked && "opacity-55", i === 0 && !locked && "bg-emerald-400/8")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">{d.name.replace(/\d$/, "")} {i === 0 && !locked && <span className="rounded-full bg-emerald-400/12 px-1.5 text-[10px] font-semibold text-emerald-300">đề xuất</span>}</span>
                    <span className="block font-mono text-[12px] text-[#9b8e97]">{d.info}</span>
                  </span>
                  {locked ? <span className="rounded-full bg-white/6 px-2 py-0.5 text-[11px] text-[#9b8e97]">khoá</span> : <span className="text-[13px] text-[#c9a86a]">chọn</span>}
                </button>
              );
            })}
          </div>
          <div className="mt-2.5 text-center text-[12px] text-[#7c7079]">người chưa đủ nghỉ 15p bị khoá — đúng luật</div>
        </SheetContent>
      </Sheet>

      {/* break picker */}
      <Sheet open={breakFor !== null} onOpenChange={(v) => { if (!v) setBreakFor(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Cho {breakFor?.replace(/\d$/, "")} nghỉ</SheetTitle></SheetHeader>
          <div className="mt-3 grid grid-cols-4 gap-2">
            {BREAK_PRESETS.map((m) => (
              <button key={m} onClick={() => doneToast(`Cho ${breakFor?.replace(/\d$/, "")} nghỉ ${m} phút`)}
                className="ios-press ios-fill rounded-2xl py-3 text-center text-[15px] font-semibold text-[#f2ece6]">{m}p</button>
            ))}
          </div>
          <div className="mt-2 text-center text-[12px] text-[#7c7079]">hoặc nhập số phút tuỳ ý</div>
        </SheetContent>
      </Sheet>

      {/* P2 — check-in */}
      <Sheet open={checkinOpen} onOpenChange={setCheckinOpen}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Check-in dealer</SheetTitle></SheetHeader>
          <div className="mt-3 grid h-[76px] place-items-center rounded-2xl border border-dashed border-white/15 text-[13px] text-[#9b8e97]">
            <span className="flex flex-col items-center gap-1"><QrCode className="h-6 w-6 text-[#d8bc85]" /> đưa QR dealer vào khung</span>
          </div>
          <div className="mt-3 px-1 text-[12px] text-[#9b8e97]">Hoặc chọn từ danh sách chưa vào ca</div>
          <div className="ios-group mt-1.5">
            {SWING_CHECKIN_LIST.map((d) => (
              <div key={d.name} className="ios-row-inset flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">{d.name}</span><span className="block font-mono text-[12px] text-[#9b8e97]">{d.note}</span></span>
                <button onClick={() => doneToast(`Đã check-in ${d.name}`)} className="ios-press-sm rounded-full bg-[#c9a86a]/15 px-2.5 py-1 text-[11px] font-semibold text-[#d8bc85]">
                  {d.scheduled ? "check-in" : "xác nhận thêm"}
                </button>
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}

function Line({ l, v, vCls }: { l: string; v: string; vCls?: string }) {
  return (
    <div className="flex items-center justify-between py-1 text-[14px]">
      <span className="text-[#9b8e97]">{l}</span>
      <span className={cn("font-mono text-[16px] font-semibold", vCls ?? "text-[#f2ece6]")}>{v}</span>
    </div>
  );
}

function SheetRow({ icon, label, onTap }: { icon: React.ReactNode; label: React.ReactNode; onTap: () => void }) {
  return (
    <button onClick={onTap} className="ios-press ios-fill flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
      {icon}<span className="text-[15px] text-[#f2ece6]">{label}</span>
    </button>
  );
}
