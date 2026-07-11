import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronLeft, LayoutGrid, Vault, Layers, Package, Monitor, RotateCcw, Lock, AlertTriangle,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { MockChip } from "@/components/ops/shared/MockChip";
import {
  CHIP_SET, CHIP_DENOMS, CHIP_TEMPLATES, CHIP_VAULT_AUDIT, COLORUP_HISTORY,
  BAG_DAYS, BAG_ROWS, chipFmt, type BagRow,
} from "@/components/ops/mock/chipData";

/**
 * Chip Ops (mobileOpsV2) — theo bản vẽ đã duyệt C1/C2 + R2/R3:
 * pills Tổng quan(C1) · Kho két(C2) · Color-up(R2) · Đóng bao(R3).
 * DỮ LIỆU MẪU, read-only. Kho/két & xuất-thu chip = máy tính (giữ két an toàn) —
 * mobile C2 chỉ XEM + cảnh báo lệch. Color-up (đường tiền) nhắc lại rồi mới xác nhận.
 */
const PILLS = [
  { key: "overview", label: "Tổng quan", icon: LayoutGrid },
  { key: "vault", label: "Kho két", icon: Vault },
  { key: "colorup", label: "Color-up", icon: Layers },
  { key: "bag", label: "Đóng bao", icon: Package },
] as const;
type Pill = (typeof PILLS)[number]["key"];

export default function OpsChipOps() {
  const navigate = useNavigate();
  const [pill, setPill] = useState<Pill>("overview");
  const [day, setDay] = useState(BAG_DAYS[0]);
  const [bagSheet, setBagSheet] = useState<BagRow | null>(null);
  const [code, setCode] = useState("");
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; onOk: () => void } | null>(null);

  const ask = (c: NonNullable<typeof confirm>) => setConfirm(c);
  const done = (m: string) => { setBagSheet(null); setConfirm(null); toast.success(m + " (bản mẫu)"); };
  const smallest = CHIP_DENOMS[0].value;
  const raceTo = CHIP_DENOMS[1].value;

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Chip Ops</h1>
          <MockChip />
        </div>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">{CHIP_SET.name} · {CHIP_SET.boundTo}</p>
      </header>

      <div className="flex gap-1.5 px-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm flex items-center gap-1 rounded-full px-3 py-1.5 text-[12.5px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            <p.icon className="h-3.5 w-3.5" /> {p.label}
          </button>
        ))}
      </div>

      {/* C1 — Tổng quan */}
      {pill === "overview" && (
        <div className="space-y-3">
          <div className="ios-card p-4">
            <div className="text-[13px] text-[#9b8e97]">Mệnh giá · đang trên bàn / trong két</div>
            <div className="mt-2 space-y-1.5">
              {CHIP_DENOMS.map((d) => (
                <div key={d.value} className="flex items-center gap-3 text-[14px]">
                  <span className={cn("w-14 font-mono font-semibold", d.color)}>{chipFmt(d.value)}</span>
                  <div className="flex h-2 flex-1 overflow-hidden rounded-full bg-white/6">
                    <div className="bg-[#c9a86a]/70" style={{ width: `${(d.inPlay / (d.inPlay + d.vault)) * 100}%` }} />
                  </div>
                  <span className="w-24 text-right font-mono text-[12px] text-[#9b8e97]">{d.inPlay} / {d.vault}</span>
                </div>
              ))}
            </div>
          </div>
          <div className="ios-card p-4">
            <div className="text-[13px] text-[#9b8e97]">Mẫu stack</div>
            <div className="mt-2 space-y-1">
              {CHIP_TEMPLATES.map((t) => (
                <div key={t.name} className="flex items-center justify-between py-1 text-[14px]">
                  <span className="text-[#f2ece6]">{t.name}</span>
                  <span className="font-mono text-[#9b8e97]">{t.chips} chip · {t.stack}</span>
                </div>
              ))}
            </div>
          </div>
          <DesktopNote text="Tạo/gán bộ chip, thêm mệnh giá, xuất–thu chip (đường tiền) làm trên máy tính." />
        </div>
      )}

      {/* C2 — Kho két (read-only + cảnh báo lệch) */}
      {pill === "vault" && (
        <div className="space-y-3">
          <div className="ios-card px-4 py-2.5 text-[13px] text-[#9b8e97]">Đối chiếu két · <span className="text-[#f2ece6]">hệ thống vs đếm thực</span></div>
          <div className="ios-group">
            {CHIP_VAULT_AUDIT.map((r) => {
              const diff = r.counted - r.system;
              return (
                <div key={r.value} className="ios-row-inset flex items-center gap-3 px-4 py-3">
                  <span className="w-16 font-mono text-[14px] font-semibold text-[#f2ece6]">{chipFmt(r.value)}</span>
                  <span className="flex-1 text-right font-mono text-[13px] text-[#9b8e97]">{r.system} → {r.counted}</span>
                  {diff === 0
                    ? <span className="w-16 text-right text-[12px] text-emerald-300">khớp</span>
                    : <span className={cn("flex w-16 items-center justify-end gap-1 text-right font-mono text-[13px] font-semibold", diff < 0 ? "text-rose-300" : "text-amber-300")}><AlertTriangle className="h-3.5 w-3.5" />{diff > 0 ? "+" : ""}{diff}</span>}
                </div>
              );
            })}
          </div>
          <DesktopNote text="Điều chỉnh kho, đồng bộ két, thu–xuất chip là thao tác tiền — chỉ làm trên máy tính. Ở đây chỉ xem & cảnh báo lệch." />
        </div>
      )}

      {/* R2 — Color-up */}
      {pill === "colorup" && (
        <div className="space-y-3">
          <div className="ios-card p-4">
            <div className="text-[15px] font-semibold text-[#f2ece6]">Bỏ mệnh giá nhỏ</div>
            <div className="mt-2 flex items-center justify-center gap-3 py-2">
              <span className="rounded-2xl bg-white/6 px-4 py-3 text-center">
                <span className="block text-[11px] text-[#9b8e97]">rút</span>
                <span className={cn("block font-mono text-[20px] font-bold", CHIP_DENOMS[0].color)}>{chipFmt(smallest)}</span>
              </span>
              <RotateCcw className="h-5 w-5 rotate-90 text-[#9b8e97]" />
              <span className="rounded-2xl bg-white/6 px-4 py-3 text-center">
                <span className="block text-[11px] text-[#9b8e97]">đổi lên</span>
                <span className={cn("block font-mono text-[20px] font-bold", CHIP_DENOMS[1].color)}>{chipFmt(raceTo)}</span>
              </span>
            </div>
            <button
              onClick={() => ask({ title: "Xác nhận color-up", body: `Rút toàn bộ chip ${chipFmt(smallest)} đang trên bàn, đổi lên ${chipFmt(raceTo)}.\nẢnh hưởng tổng chip mọi bàn — làm khi tới level quy định.`, onOk: () => done(`Đã color-up ${chipFmt(smallest)} → ${chipFmt(raceTo)}`) })}
              className="ios-press ios-primary mt-2 w-full rounded-2xl py-3 text-[15px] font-bold">Color-up ngay</button>
          </div>
          <div className="ios-card p-4">
            <div className="text-[13px] text-[#9b8e97]">Lịch sử color-up</div>
            <div className="mt-2 space-y-1">
              {COLORUP_HISTORY.map((h) => (
                <div key={h.id} className="flex items-center justify-between py-1 text-[14px]">
                  <span className="font-mono text-[#f2ece6]">{chipFmt(h.from)} → {chipFmt(h.to)} <span className="text-[12px] text-[#9b8e97]">· {h.at} · {h.chips} chip</span></span>
                  <button onClick={() => ask({ title: "Hoàn tác color-up", danger: true, body: `Đảo ngược color-up ${chipFmt(h.from)} → ${chipFmt(h.to)} lúc ${h.at}?\nTrả lại chip nhỏ về bàn.`, onOk: () => done("Đã hoàn tác color-up") })}
                    className="ios-press-sm text-[12px] text-rose-300">hoàn tác</button>
                </div>
              ))}
            </div>
          </div>
        </div>
      )}

      {/* R3 — Đóng bao (bag & tag) */}
      {pill === "bag" && (
        <div className="space-y-3">
          <div className="flex gap-1.5 overflow-x-auto px-1">
            {BAG_DAYS.map((d) => (
              <button key={d} onClick={() => setDay(d)}
                className={cn("ios-press-sm whitespace-nowrap rounded-full px-3 py-1 text-[12px]", day === d ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>{d}</button>
            ))}
          </div>
          <div className="ios-group">
            {BAG_ROWS.map((b) => (
              <button key={b.player} onClick={() => { setBagSheet(b); setCode(b.code); }}
                className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-[#f2ece6]">{b.player} <span className="text-[12px] text-[#9b8e97]">· ghế {b.seat}</span></span>
                  <span className="block font-mono text-[12px] text-[#9b8e97]">{chipFmt(b.total)} chip{b.code ? ` · mã ${b.code}` : ""}</span>
                </span>
                {b.sealed
                  ? <span className="rounded-full bg-emerald-400/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">đã bao</span>
                  : <span className="rounded-full bg-amber-400/12 px-2 py-0.5 text-[11px] font-semibold text-amber-300">chưa bao</span>}
              </button>
            ))}
          </div>
          <button onClick={() => ask({ title: "Chốt ngày đóng bao", body: `Chốt ${day}? Sau khi chốt phải ký xác nhận mới mở lại được.\nCòn 2 bao chưa đóng.`, onOk: () => done(`Đã chốt ${day}`) })}
            className="ios-press ios-fill flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] font-medium text-[#f2ece6]"><Lock className="h-4 w-4" /> Chốt ngày</button>
        </div>
      )}

      {/* R3 — bag seal/unseal sheet */}
      <Sheet open={bagSheet !== null} onOpenChange={(v) => { if (!v) setBagSheet(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">{bagSheet?.player} · ghế {bagSheet?.seat}</SheetTitle>
          </SheetHeader>
          <div className="mt-1 text-center font-mono text-[13px] text-[#9b8e97]">{chipFmt(bagSheet?.total ?? 0)} chip</div>
          <div className="mt-3">
            <label className="px-1 text-[12px] text-[#9b8e97]">Mã bao</label>
            <input value={code} onChange={(e) => setCode(e.target.value.toUpperCase())} placeholder="VD: A-016"
              className="ios-fill mt-1 w-full rounded-xl px-3 py-2.5 font-mono text-[15px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
          </div>
          {bagSheet?.sealed ? (
            <button onClick={() => ask({ title: "Mở bao", danger: true, body: `Mở bao ${bagSheet?.code} của ${bagSheet?.player}?\nChỉ mở khi đếm lại chip.`, onOk: () => done(`Đã mở bao ${bagSheet?.code}`) })}
              className="ios-press ios-fill mt-3 w-full rounded-2xl py-3 text-[15px] font-medium text-rose-300">Mở bao</button>
          ) : (
            <button disabled={!code.trim()} onClick={() => done(`Đã đóng bao ${code} cho ${bagSheet?.player}`)}
              className="ios-press ios-primary mt-3 w-full rounded-2xl py-3 text-[15px] font-bold disabled:opacity-40">Đóng bao</button>
          )}
        </SheetContent>
      </Sheet>

      {/* Money / danger restate confirm */}
      <AlertDialog open={confirm !== null} onOpenChange={(v) => { if (!v) setConfirm(null); }}>
        <AlertDialogContent className="max-w-[340px] rounded-3xl border-white/10 bg-[#0d0913]">
          <AlertDialogHeader>
            <AlertDialogTitle className="text-[#f2ece6]">{confirm?.title}</AlertDialogTitle>
            <AlertDialogDescription className="whitespace-pre-line text-[14px] text-[#c7bcc4]">{confirm?.body}</AlertDialogDescription>
          </AlertDialogHeader>
          <AlertDialogFooter className="gap-2">
            <AlertDialogCancel className="ios-press-sm mt-0 rounded-2xl border-white/12 bg-white/5 text-[#f2ece6]">Huỷ</AlertDialogCancel>
            <AlertDialogAction onClick={() => confirm?.onOk()}
              className={cn("ios-press rounded-2xl font-bold", confirm?.danger ? "bg-rose-500/90 text-white hover:bg-rose-500" : "bg-[#c9a86a] text-[#241A08] hover:bg-[#d8bc85]")}>Xác nhận</AlertDialogAction>
          </AlertDialogFooter>
        </AlertDialogContent>
      </AlertDialog>
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
