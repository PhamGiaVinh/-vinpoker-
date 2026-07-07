import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronLeft, ClipboardList, Banknote, ArrowLeftRight, HandCoins, ShieldCheck,
  Dice5, Receipt, XCircle, RotateCcw, Check, Monitor, IdCard,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import {
  vnd, REG_QUEUE, REG_STATUS_META, CANCEL_REASONS, BUYIN_TOURNAMENTS, SEPAY_ROWS,
  STAKE_ROWS, VERIFY_ROWS, type RegRow,
} from "@/components/ops/mock/cashierData";

/**
 * Cashier — thu ngân (mobileOpsV2) — theo bản vẽ đã duyệt Q1–Q6.
 * pills Hàng chờ(Q1) · Buy-in(Q3) · SePay(Q4) · Staking(Q5) · Xác minh(Q6). Tap đăng ký → Q2 sheet.
 * DỮ LIỆU MẪU. Module tiền-vào: mọi nút 💰 NHẮC LẠI SỐ rồi mới xác nhận (toast "bản mẫu").
 * Chi tiết/lịch sử staking, cấp lại thẻ (đã build #725) = máy tính.
 */
const PILLS = [
  { key: "queue", label: "Hàng chờ", icon: ClipboardList },
  { key: "buyin", label: "Buy-in", icon: Banknote },
  { key: "sepay", label: "SePay", icon: ArrowLeftRight },
  { key: "staking", label: "Staking", icon: HandCoins },
  { key: "verify", label: "Xác minh", icon: ShieldCheck },
] as const;
type Pill = (typeof PILLS)[number]["key"];

export default function OpsCashier() {
  const navigate = useNavigate();
  const [pill, setPill] = useState<Pill>("queue");
  const [regSheet, setRegSheet] = useState<RegRow | null>(null);
  const [cancelFor, setCancelFor] = useState<RegRow | null>(null);
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; onOk: () => void } | null>(null);
  const [tourId, setTourId] = useState(BUYIN_TOURNAMENTS[0].id);
  const [reentry, setReentry] = useState(false);
  const [buyinName, setBuyinName] = useState("");
  const [payMethod, setPayMethod] = useState<"cash" | "bank">("cash");
  const [sepayTab, setSepayTab] = useState<"todo" | "done">("todo");

  const ask = (c: NonNullable<typeof confirm>) => setConfirm(c);
  const done = (m: string) => { setRegSheet(null); setCancelFor(null); setConfirm(null); toast.success(m + " (bản mẫu)"); };
  const tour = useMemo(() => BUYIN_TOURNAMENTS.find((t) => t.id === tourId)!, [tourId]);
  const buyinTotal = tour.buyin + tour.fee;

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <h1 className="mt-1 text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Cashier</h1>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">Hanoi Royal · thu ngân · <span className="text-[#d8bc85]">nhắc lại số trước khi thu</span></p>
      </header>

      <div className="flex gap-1.5 overflow-x-auto px-1 pb-0.5">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm flex shrink-0 items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            <p.icon className="h-3.5 w-3.5" /> {p.label}
          </button>
        ))}
      </div>

      {/* Q1 — Hàng chờ */}
      {pill === "queue" && (
        <div className="space-y-3">
          <div className="ios-card flex items-center justify-between px-4 py-2.5 text-[13px]">
            <span><span className="text-amber-300">2 chờ xếp</span> · <span className="text-sky-300">1 đã thu</span> · <span className="text-emerald-300">2 đã xếp</span></span>
            <button onClick={() => toast("Bốc thăm tất cả người chờ (bản mẫu)")} className="ios-press-sm flex items-center gap-1 rounded-full bg-[#c9a86a]/15 px-2.5 py-1 text-[11px] font-semibold text-[#d8bc85]"><Dice5 className="h-3.5 w-3.5" /> Bốc tất cả</button>
          </div>
          <div className="ios-group">
            {REG_QUEUE.map((r) => {
              const s = REG_STATUS_META[r.status];
              return (
                <button key={r.name} onClick={() => setRegSheet(r)}
                  className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">{r.name} <span className="font-mono text-[12px] text-[#7c7079]">{r.phone}</span></span>
                    <span className="block text-[12px] text-[#9b8e97]">{r.status === "seated" ? `${r.table} · ghế ${r.seat}` : `${vnd(r.buyin)} · ${r.method === "cash" ? "tiền mặt" : "chuyển khoản"}`}</span>
                  </span>
                  <span className={cn("shrink-0 rounded-full px-2 py-0.5 text-[11px] font-semibold", s.cls)}>{s.label}</span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* Q3 — Buy-in / Re-entry */}
      {pill === "buyin" && (
        <div className="space-y-3">
          <div className="ios-card p-4 space-y-3">
            <div className="flex gap-2">
              <button onClick={() => setReentry(false)} className={cn("ios-press-sm flex-1 rounded-2xl py-2 text-[14px] font-medium", !reentry ? "bg-[#c9a86a] text-[#241A08]" : "ios-fill text-[#f2ece6]")}>Buy-in mới</button>
              <button onClick={() => setReentry(true)} className={cn("ios-press-sm flex-1 rounded-2xl py-2 text-[14px] font-medium", reentry ? "bg-[#c9a86a] text-[#241A08]" : "ios-fill text-[#f2ece6]")}>Mua lại (re-entry)</button>
            </div>
            <div>
              <label className="px-1 text-[12px] text-[#9b8e97]">Giải</label>
              <div className="mt-1 space-y-1.5">
                {BUYIN_TOURNAMENTS.map((t) => (
                  <button key={t.id} onClick={() => setTourId(t.id)}
                    className={cn("flex w-full items-center justify-between rounded-xl px-3 py-2.5 text-left", tourId === t.id ? "bg-[#c9a86a]/15 ring-1 ring-[#c9a86a]/40" : "ios-fill")}>
                    <span className="text-[14px] text-[#f2ece6]">{t.name}</span>
                    <span className="font-mono text-[12px] text-[#9b8e97]">{vnd(t.buyin)}+{vnd(t.fee)}</span>
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="px-1 text-[12px] text-[#9b8e97]">{reentry ? "Người chơi mua lại" : "Tên / SĐT người chơi"}</label>
              <input value={buyinName} onChange={(e) => setBuyinName(e.target.value)} placeholder={reentry ? "chọn người đã bị loại…" : "Nguyễn Văn A / 09…"}
                className="ios-fill mt-1 w-full rounded-xl px-3 py-2.5 text-[15px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
            </div>
            <div className="grid grid-cols-2 gap-2">
              {(["cash", "bank"] as const).map((m) => (
                <button key={m} onClick={() => setPayMethod(m)} className={cn("ios-press-sm rounded-2xl py-2.5 text-[14px] font-medium", payMethod === m ? "bg-[#c9a86a] text-[#241A08]" : "ios-fill text-[#f2ece6]")}>{m === "cash" ? "Tiền mặt" : "Chuyển khoản"}</button>
              ))}
            </div>
          </div>
          <button disabled={!buyinName.trim()}
            onClick={() => ask({ title: reentry ? "Xác nhận mua lại (re-entry)" : "Xác nhận đã nhận tiền", body: `${buyinName || "Khách"} · ${tour.name}\nThu ${vnd(buyinTotal)} (${vnd(tour.buyin)} + phí ${vnd(tour.fee)}) — ${payMethod === "cash" ? "tiền mặt" : "chuyển khoản"}?`, onOk: () => { setBuyinName(""); done(`Đã thu ${vnd(buyinTotal)} · ${reentry ? "re-entry" : "buy-in"}`); } })}
            className="ios-press ios-primary flex w-full items-center justify-between rounded-2xl px-4 py-3.5 disabled:opacity-40">
            <span className="text-[15px] font-bold">{reentry ? "Mua lại & thu tiền" : "Xác nhận đã nhận tiền"}</span>
            <span className="font-mono text-[15px] font-bold">{vnd(buyinTotal)}</span>
          </button>
        </div>
      )}

      {/* Q4 — SePay khớp tiền */}
      {pill === "sepay" && (
        <div className="space-y-3">
          <div className="flex gap-2 px-1">
            {(["todo", "done"] as const).map((t) => (
              <button key={t} onClick={() => setSepayTab(t)}
                className={cn("ios-press-sm rounded-full px-3 py-1 text-[12px]", sepayTab === t ? "bg-white/12 text-[#f2ece6]" : "bg-white/5 text-[#9b8e97]")}>{t === "todo" ? "Cần xử lý" : "Đã xử lý"}</button>
            ))}
          </div>
          <div className="ios-group">
            {SEPAY_ROWS.filter((r) => (sepayTab === "todo" ? !r.done : r.done)).map((r) => (
              <div key={r.id} className="ios-row-inset px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block font-mono text-[15px] font-semibold text-[#f2ece6]">{vnd(r.amount)}</span>
                    <span className="block truncate text-[12px] text-[#9b8e97]">"{r.memo}" · {r.at}{r.match ? ` · khớp: ${r.match}` : " · chưa rõ người"}</span>
                  </span>
                  {r.done && <span className="rounded-full bg-emerald-400/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">đã khớp</span>}
                </div>
                {!r.done && (
                  <div className="mt-2 flex gap-2">
                    <button onClick={() => ask({ title: "Xác nhận & xếp ghế", body: `Khớp ${vnd(r.amount)} — "${r.memo}"${r.match ? ` cho ${r.match}` : ""}?\nGhi nhận buy-in và xếp ghế.`, onOk: () => done(`Đã khớp ${vnd(r.amount)} & xếp ghế`) })}
                      className="ios-press-sm ios-primary flex-1 rounded-xl py-2 text-[13px] font-bold">Xác nhận & xếp ghế</button>
                    <button onClick={() => ask({ title: "Bỏ qua giao dịch", danger: true, body: `Bỏ qua CK ${vnd(r.amount)} — "${r.memo}"?\nKhông ghi vào buy-in (VD: chuyển nhầm).`, onOk: () => done("Đã bỏ qua giao dịch") })}
                      className="ios-press-sm ios-fill rounded-xl px-4 py-2 text-[13px] text-[#9b8e97]">Bỏ qua</button>
                  </div>
                )}
              </div>
            ))}
          </div>
          {sepayTab === "todo" && <div className="px-1 text-[12px] text-[#7c7079]">Chuyển khoản đến sẽ tự hiện ở đây để khớp với người chơi.</div>}
        </div>
      )}

      {/* Q5 — Staking */}
      {pill === "staking" && (
        <div className="space-y-3">
          <div className="ios-card px-4 py-2.5 text-[13px] text-[#9b8e97]"><span className="font-semibold text-amber-300">2 kèo</span> chờ xác nhận góp vốn</div>
          <div className="ios-group">
            {STAKE_ROWS.map((s, i) => (
              <div key={i} className="ios-row-inset flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[14px] text-[#f2ece6]">{s.backer} → <b>{s.player}</b></span>
                  <span className="block font-mono text-[12px] text-[#9b8e97]">{vnd(s.amount)} · {s.pct}% kèo</span>
                </span>
                {s.status === "funded"
                  ? <span className="rounded-full bg-emerald-400/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">đã góp</span>
                  : <button onClick={() => ask({ title: "Xác nhận đã góp vốn (FUNDED)", body: `${s.backer} góp ${vnd(s.amount)} (${s.pct}%) cho ${s.player}?\nGhi nhận đã nhận tiền góp.`, onOk: () => done(`Đã xác nhận FUNDED ${vnd(s.amount)}`) })}
                    className="ios-press-sm rounded-full bg-[#c9a86a]/15 px-3 py-1 text-[12px] font-semibold text-[#d8bc85]">Xác nhận góp</button>}
              </div>
            ))}
          </div>
          <DesktopNote text="Chi tiết kèo, hoàn tiền, lịch sử và xuất Excel làm trên máy tính." />
        </div>
      )}

      {/* Q6 — Xác minh */}
      {pill === "verify" && (
        <div className="space-y-3">
          <div className="ios-card px-4 py-2.5 text-[13px] text-[#9b8e97]"><span className="font-semibold text-amber-300">{VERIFY_ROWS.length} hồ sơ</span> chờ duyệt hội viên</div>
          <div className="ios-group">
            {VERIFY_ROWS.map((v) => (
              <div key={v.name} className="ios-row-inset px-4 py-3">
                <div className="flex items-center gap-3">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">{v.name} <span className="font-mono text-[12px] text-[#7c7079]">{v.phone}</span></span>
                    <span className="block text-[12px] text-[#9b8e97]">{v.note} · {v.submitted}</span>
                  </span>
                </div>
                <div className="mt-2 flex gap-2">
                  <button onClick={() => ask({ title: "Duyệt hội viên", body: `Duyệt ${v.name}? Hồ sơ đủ điều kiện thành hội viên.`, onOk: () => done(`Đã duyệt ${v.name}`) })}
                    className="ios-press-sm ios-primary flex-1 rounded-xl py-2 text-[13px] font-bold">Duyệt</button>
                  <button onClick={() => ask({ title: "Từ chối hồ sơ", danger: true, body: `Từ chối ${v.name}? Cần ghi lý do cho khách.`, onOk: () => done(`Đã từ chối ${v.name}`) })}
                    className="ios-press-sm ios-fill rounded-xl px-4 py-2 text-[13px] text-rose-300">Từ chối</button>
                </div>
              </div>
            ))}
          </div>
          <button onClick={() => toast("Mở Cấp lại thẻ (bản máy tính — PR #725)")} className="ios-press-sm ios-card flex w-full items-center gap-3 p-3.5 text-left">
            <IdCard className="h-5 w-5 text-[#c9a86a]" />
            <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Cấp lại thẻ hội viên</span><span className="block text-[12px] text-[#9b8e97]">quét QR → in thẻ 2 mặt · bản đầy đủ trên máy tính</span></span>
            <Monitor className="h-4 w-4 text-[#5f545c]" />
          </button>
        </div>
      )}

      {/* Q2 — sheet đăng ký (bốc thăm / phiếu / huỷ / huỷ&hoàn) */}
      <Sheet open={regSheet !== null} onOpenChange={(v) => { if (!v) setRegSheet(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">{regSheet?.name} <span className="font-mono text-[12px] text-[#7c7079]">{regSheet?.phone}</span></SheetTitle>
          </SheetHeader>
          <div className="mt-1 text-center text-[13px] text-[#9b8e97]">
            {regSheet && REG_STATUS_META[regSheet.status].label} · {vnd(regSheet?.buyin ?? 0)} · {regSheet?.method === "cash" ? "tiền mặt" : "chuyển khoản"}
            {regSheet?.status === "seated" && ` · ${regSheet.table} ghế ${regSheet.seat}`}
          </div>
          <div className="mt-3 space-y-1.5">
            {regSheet?.status !== "seated" && (
              <button onClick={() => done(`Đã bốc thăm chỗ cho ${regSheet?.name}`)} className="ios-press ios-primary flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
                <Dice5 className="h-5 w-5 shrink-0" /><span className="text-[15px] font-bold">Bốc thăm chỗ ngồi</span>
              </button>
            )}
            <SheetRow icon={<Receipt className="h-5 w-5 text-sky-300" />} label="In phiếu đăng ký" onTap={() => done("Đã in phiếu")} />
            {regSheet?.status === "waiting" ? (
              <SheetRow icon={<XCircle className="h-5 w-5 text-rose-300" />} label={<span className="text-rose-300">Huỷ đăng ký</span>} onTap={() => { setRegSheet(null); setCancelFor(regSheet); }} />
            ) : (
              <SheetRow icon={<RotateCcw className="h-5 w-5 text-rose-300" />} label={<span className="text-rose-300">Huỷ &amp; hoàn tiền</span>} onTap={() => { setRegSheet(null); setCancelFor(regSheet); }} />
            )}
          </div>
        </SheetContent>
      </Sheet>

      {/* Q2 — cancel/void with reason preset */}
      <Sheet open={cancelFor !== null} onOpenChange={(v) => { if (!v) setCancelFor(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">{cancelFor?.status === "waiting" ? "Huỷ đăng ký" : "Huỷ & hoàn tiền"} — {cancelFor?.name}</SheetTitle>
          </SheetHeader>
          {cancelFor?.status !== "waiting" && (
            <div className="ios-card mt-2 flex items-center justify-center gap-2 py-2.5 text-[13px] text-rose-300"><RotateCcw className="h-4 w-4" /> sẽ hoàn {vnd(cancelFor?.buyin ?? 0)} · {cancelFor?.method === "cash" ? "tiền mặt" : "chuyển khoản"}</div>
          )}
          <div className="mt-1 px-1 text-center text-[12px] text-[#9b8e97]">chọn lý do</div>
          <div className="ios-group mt-2">
            {CANCEL_REASONS.map((reason) => (
              <button key={reason} onClick={() => ask({ title: cancelFor?.status === "waiting" ? "Xác nhận huỷ đăng ký" : "Xác nhận huỷ & hoàn", danger: true, body: `${cancelFor?.name} · lý do: ${reason}\n${cancelFor?.status === "waiting" ? "Huỷ đăng ký này?" : `Hoàn ${vnd(cancelFor?.buyin ?? 0)} và huỷ đăng ký? Không hoàn tác.`}`, onOk: () => done(cancelFor?.status === "waiting" ? "Đã huỷ đăng ký" : `Đã hoàn ${vnd(cancelFor?.buyin ?? 0)}`) })}
                className="ios-press-sm ios-row-inset flex w-full items-center px-4 py-3.5 text-left text-[15px] text-[#f2ece6]">{reason}</button>
            ))}
          </div>
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

function SheetRow({ icon, label, onTap }: { icon: React.ReactNode; label: React.ReactNode; onTap: () => void }) {
  return (
    <button onClick={onTap} className="ios-press ios-fill flex w-full items-center gap-3 rounded-2xl p-3.5 text-left">
      {icon}<span className="text-[15px] text-[#f2ece6]">{label}</span>
    </button>
  );
}

function DesktopNote({ text }: { text: string }) {
  return (
    <div className="ios-card flex items-start gap-2 p-3.5 text-[12px] text-[#9b8e97]">
      <Monitor className="mt-0.5 h-4 w-4 shrink-0 text-[#9b8e97]" /> <span>{text}</span>
    </div>
  );
}
