import { useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import {
  ChevronLeft, Plus, Minus, Banknote, QrCode, ChefHat, ClipboardList,
  Boxes, Gift, RotateCcw, Printer, Ban, Trash2, Check,
} from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import {
  AlertDialog, AlertDialogAction, AlertDialogCancel, AlertDialogContent,
  AlertDialogDescription, AlertDialogFooter, AlertDialogHeader, AlertDialogTitle,
} from "@/components/ui/alert-dialog";
import { cn } from "@/lib/utils";
import { MockChip } from "@/components/ops/shared/MockChip";
import {
  FNB_CATS, FNB_MENU, FNB_ORDERS, FNB_KITCHEN, FNB_SHIFT, FNB_QR_TABLES, FNB_STOCK, vnd,
  type FnbOrder, type MenuItem, type PayMethod,
} from "@/components/ops/mock/fnbData";

/**
 * F&B (mobileOpsV2) — theo bản vẽ đã duyệt F1/F2 + P3/P4/P5 + R4/R5:
 * pills Đơn(F1) · Tạo đơn(P3) · Bếp(P4) · Ca(P5). Tap đơn → F2 (thu tiền / comp / hoàn).
 * DỮ LIỆU MẪU, read-only — mọi thu tiền nhắc lại số rồi mới xác nhận (toast "bản mẫu").
 * Số trong ca = "Tạm tính". Quản trị menu/kho/cài đặt để máy tính.
 */
const PILLS = [
  { key: "orders", label: "Đơn", icon: ClipboardList },
  { key: "create", label: "Tạo đơn", icon: Plus },
  { key: "kitchen", label: "Bếp", icon: ChefHat },
  { key: "shift", label: "Ca", icon: Banknote },
] as const;
type Pill = (typeof PILLS)[number]["key"];

const STATUS_META = {
  pending: { label: "Chờ thu", cls: "bg-amber-400/12 text-amber-300" },
  kitchen: { label: "Đang bếp", cls: "bg-sky-400/12 text-sky-300" },
  paid: { label: "Đã thu", cls: "bg-emerald-400/12 text-emerald-300" },
} as const;

const METHOD_LABEL: Record<PayMethod, string> = { cash: "Tiền mặt", bank: "Chuyển khoản" };

export default function OpsFnb() {
  const navigate = useNavigate();
  const [pill, setPill] = useState<Pill>("orders");
  const [orderSheet, setOrderSheet] = useState<FnbOrder | null>(null);
  const [method, setMethod] = useState<PayMethod>("cash");
  const [confirm, setConfirm] = useState<{ title: string; body: string; danger?: boolean; onOk: () => void } | null>(null);
  const [cat, setCat] = useState<string>("Tất cả");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [table, setTable] = useState("");
  const [qrOpen, setQrOpen] = useState(false);
  const [stockOpen, setStockOpen] = useState(false);
  const [counts, setCounts] = useState<Record<string, string>>({});

  const menu = cat === "Tất cả" ? FNB_MENU : FNB_MENU.filter((m) => m.cat === cat);
  const cartLines = useMemo(() => Object.entries(cart).filter(([, q]) => q > 0)
    .map(([id, q]) => ({ item: FNB_MENU.find((m) => m.id === id)!, q })), [cart]);
  const cartTotal = cartLines.reduce((s, l) => s + l.item.price * l.q, 0);

  const ask = (c: NonNullable<typeof confirm>) => setConfirm(c);
  const done = (m: string) => { setOrderSheet(null); setQrOpen(false); setStockOpen(false); setConfirm(null); toast.success(m + " (bản mẫu)"); };
  const addToCart = (m: MenuItem) => setCart((c) => ({ ...c, [m.id]: (c[m.id] ?? 0) + 1 }));
  const bump = (id: string, d: number) => setCart((c) => ({ ...c, [id]: Math.max(0, (c[id] ?? 0) + d) }));

  return (
    <div className="ios-in space-y-4 pt-1">
      <header className="px-1">
        <button onClick={() => navigate("/")} className="ios-press-sm -ml-1 flex items-center gap-0.5 py-1 text-[15px] text-[#c9a86a]">
          <ChevronLeft className="h-5 w-5" strokeWidth={2.4} /> App chính
        </button>
        <div className="mt-1 flex items-center justify-between gap-2">
          <h1 className="min-w-0 truncate text-[26px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">F&amp;B</h1>
          <MockChip />
        </div>
        <p className="mt-0.5 text-[14px] text-[#9b8e97]">Hanoi Royal · đồ uống &amp; đồ ăn · số trong ca là <span className="text-[#d8bc85]">tạm tính</span></p>
      </header>

      <div className="flex gap-1.5 px-1">
        {PILLS.map((p) => (
          <button key={p.key} onClick={() => setPill(p.key)}
            className={cn("ios-press-sm flex items-center gap-1 rounded-full px-3 py-1.5 text-[13px] font-medium", pill === p.key ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>
            <p.icon className="h-3.5 w-3.5" /> {p.label}
          </button>
        ))}
      </div>

      {/* F1 — Đơn */}
      {pill === "orders" && (
        <div className="space-y-3">
          <div className="ios-card flex items-center justify-between px-4 py-3 text-[13px]">
            <span><span className="text-amber-300">2 chờ thu</span> · <span className="text-sky-300">1 bếp</span></span>
            <span className="text-[#9b8e97]">tạm tính hôm nay <b className="text-[#f2ece6]">{vnd(FNB_SHIFT.cashTaken + FNB_SHIFT.bankTaken)}</b></span>
          </div>
          <div className="ios-group">
            {FNB_ORDERS.map((o) => {
              const s = STATUS_META[o.status];
              return (
                <button key={o.id} onClick={() => { setOrderSheet(o); setMethod(o.method ?? "cash"); }}
                  className={cn("ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3 text-left", o.status === "pending" && "bg-amber-500/5")}>
                  <span className="min-w-0 flex-1">
                    <span className="block text-[15px] text-[#f2ece6]">{o.table}{o.who ? ` · ${o.who}` : ""} <span className="font-mono text-[12px] text-[#7c7079]">{o.id}</span></span>
                    <span className="block truncate text-[12px] text-[#9b8e97]">{o.items.map((i) => `${i.name}×${i.qty}`).join(", ")}{o.comp ? " · comp" : ""}</span>
                  </span>
                  <span className="text-right">
                    <span className="block font-mono text-[14px] text-[#f2ece6]">{vnd(o.total)}</span>
                    <span className={cn("mt-0.5 inline-block rounded-full px-2 py-0.5 text-[10px] font-semibold", s.cls)}>{s.label}</span>
                  </span>
                </button>
              );
            })}
          </div>
        </div>
      )}

      {/* P3 — Tạo đơn */}
      {pill === "create" && (
        <div className="space-y-3 pb-40">
          <div className="flex gap-1.5 overflow-x-auto px-1 pb-0.5">
            {FNB_CATS.map((c) => (
              <button key={c} onClick={() => setCat(c)}
                className={cn("ios-press-sm whitespace-nowrap rounded-full px-3 py-1 text-[12px]", cat === c ? "bg-[#c9a86a] text-[#241A08]" : "bg-white/5 text-[#9b8e97]")}>{c}</button>
            ))}
          </div>
          <div className="grid grid-cols-2 gap-2">
            {menu.map((m) => (
              <button key={m.id} onClick={() => addToCart(m)}
                className="ios-press ios-card flex flex-col items-start gap-1 p-3 text-left">
                <span className="text-[14px] font-medium text-[#f2ece6]">{m.name}</span>
                <span className="font-mono text-[13px] text-[#d8bc85]">{vnd(m.price)}</span>
                {cart[m.id] > 0 && <span className="mt-0.5 rounded-full bg-[#c9a86a]/15 px-1.5 text-[11px] font-semibold text-[#d8bc85]">×{cart[m.id]}</span>}
              </button>
            ))}
          </div>

          {cartLines.length > 0 && (
            <div className="fixed inset-x-0 bottom-[76px] z-30 mx-auto max-w-md px-4">
              <div className="ios-blur ios-card space-y-2 p-3.5">
                <input value={table} onChange={(e) => setTable(e.target.value)} placeholder="Bàn / tên khách (tuỳ chọn)"
                  className="ios-fill w-full rounded-xl px-3 py-2 text-[14px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
                <div className="max-h-28 space-y-1 overflow-y-auto">
                  {cartLines.map(({ item, q }) => (
                    <div key={item.id} className="flex items-center gap-2 text-[13px]">
                      <span className="flex-1 truncate text-[#f2ece6]">{item.name}</span>
                      <button onClick={() => bump(item.id, -1)} className="ios-press-sm grid h-6 w-6 place-items-center rounded-full bg-white/8 text-[#f2ece6]"><Minus className="h-3.5 w-3.5" /></button>
                      <span className="w-4 text-center font-mono text-[#f2ece6]">{q}</span>
                      <button onClick={() => bump(item.id, 1)} className="ios-press-sm grid h-6 w-6 place-items-center rounded-full bg-white/8 text-[#f2ece6]"><Plus className="h-3.5 w-3.5" /></button>
                      <span className="w-16 text-right font-mono text-[#9b8e97]">{vnd(item.price * q)}</span>
                    </div>
                  ))}
                </div>
                <button
                  onClick={() => ask({ title: "Tạo đơn & thu tiền", body: `${table || "Khách lẻ"} · ${cartLines.length} món\nThu ${vnd(cartTotal)} — ${METHOD_LABEL[method]}?`, onOk: () => { setCart({}); setTable(""); done(`Đã tạo đơn ${vnd(cartTotal)}`); } })}
                  className="ios-press ios-primary flex w-full items-center justify-between rounded-2xl px-4 py-3">
                  <span className="text-[15px] font-bold">Tạo đơn &amp; thu tiền</span>
                  <span className="font-mono text-[15px] font-bold">{vnd(cartTotal)}</span>
                </button>
              </div>
            </div>
          )}
        </div>
      )}

      {/* P4 — Bếp */}
      {pill === "kitchen" && (
        <div className="space-y-3">
          <div className="ios-card px-4 py-2.5 text-[13px] text-[#9b8e97]"><span className="text-sky-300 font-semibold">{FNB_KITCHEN.length} vé</span> đang chờ bếp</div>
          {FNB_KITCHEN.map((t) => (
            <div key={t.id} className="ios-card p-3.5">
              <div className="flex items-center justify-between">
                <span className="text-[15px] font-semibold text-[#f2ece6]">{t.table} <span className="font-mono text-[12px] text-[#7c7079]">{t.id}</span></span>
                <span className={cn("font-mono text-[13px]", t.min > 5 ? "text-amber-300" : "text-[#9b8e97]")}>{t.min} phút</span>
              </div>
              <div className="mt-2 space-y-1">
                {t.lines.map((l, i) => (
                  <button key={i} onClick={() => toast(l.done ? "Đã đánh dấu chưa xong (bản mẫu)" : `Xong: ${l.name} (bản mẫu)`)}
                    className="ios-press-sm flex w-full items-center gap-2.5 rounded-lg px-1.5 py-1.5 text-left">
                    <span className={cn("grid h-5 w-5 place-items-center rounded-md border", l.done ? "border-emerald-400 bg-emerald-400 text-[#06210f]" : "border-white/20 text-transparent")}><Check className="h-3.5 w-3.5" /></span>
                    <span className={cn("flex-1 text-[14px]", l.done ? "text-[#7c7079] line-through" : "text-[#f2ece6]")}>{l.name}</span>
                    <span className="font-mono text-[13px] text-[#9b8e97]">×{l.qty}</span>
                  </button>
                ))}
              </div>
              <button onClick={() => done(`Vé ${t.id} tất cả xong`)} className="ios-press ios-fill mt-2 w-full rounded-xl py-2 text-[13px] font-medium text-[#f2ece6]">Tất cả xong</button>
            </div>
          ))}
        </div>
      )}

      {/* P5 — Ca */}
      {pill === "shift" && (
        <div className="space-y-3">
          <div className="ios-card p-4">
            <div className="flex items-center justify-between">
              <span className="text-[15px] font-semibold text-[#f2ece6]">Ca đang mở</span>
              <span className="rounded-full bg-emerald-400/12 px-2 py-0.5 text-[11px] font-semibold text-emerald-300">từ {FNB_SHIFT.openedAt}</span>
            </div>
            <div className="mt-2.5 space-y-1">
              <Row l="Tiền mặt đầu ca" v={vnd(FNB_SHIFT.cashFloat)} />
              <Row l="Tiền mặt thu (tạm tính)" v={vnd(FNB_SHIFT.cashTaken)} vCls="text-emerald-300" />
              <Row l="Chuyển khoản (tạm tính)" v={vnd(FNB_SHIFT.bankTaken)} vCls="text-sky-300" />
              <Row l="Đơn / Comp" v={`${FNB_SHIFT.orders} / ${FNB_SHIFT.comps}`} />
              <div className="my-1 border-t border-white/8" />
              <Row l="Tiền mặt phải có khi chốt" v={vnd(FNB_SHIFT.cashFloat + FNB_SHIFT.cashTaken)} vCls="text-[#d8bc85]" big />
            </div>
            <button
              onClick={() => ask({ title: "Chốt ca F&B", danger: true, body: `Tiền mặt phải có: ${vnd(FNB_SHIFT.cashFloat + FNB_SHIFT.cashTaken)}\nChuyển khoản: ${vnd(FNB_SHIFT.bankTaken)}\nSố tạm tính sẽ được chốt lại. Không mở lại được.`, onOk: () => done("Đã chốt ca F&B") })}
              className="ios-press mt-3 w-full rounded-2xl bg-rose-500/85 py-3 text-[15px] font-bold text-white">Chốt ca</button>
          </div>
          <div className="ios-group">
            <button onClick={() => setQrOpen(true)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <QrCode className="h-5 w-5 text-[#d8bc85]" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">QR gọi món tại bàn</span><span className="block text-[12px] text-[#9b8e97]">khách tự quét · in / đổi / thu hồi mã</span></span>
            </button>
            <button onClick={() => setStockOpen(true)} className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left">
              <Boxes className="h-5 w-5 text-sky-300" />
              <span className="min-w-0 flex-1"><span className="block text-[15px] text-[#f2ece6]">Kiểm kho nhanh</span><span className="block text-[12px] text-[#9b8e97]">đếm tồn cuối ca · chốt phiên</span></span>
            </button>
          </div>
        </div>
      )}

      {/* F2 — sheet đơn: thu tiền / comp / hoàn */}
      <Sheet open={orderSheet !== null} onOpenChange={(v) => { if (!v) setOrderSheet(null); }}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center">
            <SheetTitle className="text-[#f2ece6]">{orderSheet?.table}{orderSheet?.who ? ` · ${orderSheet.who}` : ""} <span className="font-mono text-[12px] text-[#7c7079]">{orderSheet?.id}</span></SheetTitle>
          </SheetHeader>
          <div className="ios-card mt-3 divide-y divide-white/6 px-4">
            {orderSheet?.items.map((i, k) => (
              <div key={k} className="flex items-center justify-between py-2 text-[14px]">
                <span className="text-[#f2ece6]">{i.name} <span className="text-[#9b8e97]">×{i.qty}</span></span>
              </div>
            ))}
            <div className="flex items-center justify-between py-2.5 text-[15px] font-semibold">
              <span className="text-[#9b8e97]">Tổng</span><span className="font-mono text-[#f2ece6]">{vnd(orderSheet?.total ?? 0)}</span>
            </div>
          </div>

          {orderSheet?.status !== "paid" ? (
            <>
              <div className="mt-3 grid grid-cols-2 gap-2">
                {(["cash", "bank"] as PayMethod[]).map((m) => (
                  <button key={m} onClick={() => setMethod(m)}
                    className={cn("ios-press-sm rounded-2xl py-2.5 text-[14px] font-medium", method === m ? "bg-[#c9a86a] text-[#241A08]" : "ios-fill text-[#f2ece6]")}>{METHOD_LABEL[m]}</button>
                ))}
              </div>
              <button
                onClick={() => ask({ title: "Xác nhận thu tiền", body: `${orderSheet?.table} · ${orderSheet?.id}\nThu ${vnd(orderSheet?.total ?? 0)} — ${METHOD_LABEL[method]}?`, onOk: () => done(`Đã thu ${vnd(orderSheet?.total ?? 0)} ${METHOD_LABEL[method]}`) })}
                className="ios-press ios-primary mt-2 flex w-full items-center justify-between rounded-2xl px-4 py-3.5">
                <span className="text-[15px] font-bold">Thu tiền · {METHOD_LABEL[method]}</span>
                <span className="font-mono text-[15px] font-bold">{vnd(orderSheet?.total ?? 0)}</span>
              </button>
              <div className="mt-1.5 grid grid-cols-2 gap-2">
                <button onClick={() => ask({ title: "Miễn phí (comp)", body: `Comp toàn bộ ${vnd(orderSheet?.total ?? 0)} cho ${orderSheet?.table}?\nGhi vào comp của ca.`, onOk: () => done(`Đã comp ${vnd(orderSheet?.total ?? 0)}`) })}
                  className="ios-press-sm ios-fill flex items-center justify-center gap-2 rounded-2xl py-3 text-[14px] text-amber-300"><Gift className="h-4 w-4" /> Miễn phí</button>
                <button onClick={() => ask({ title: "Huỷ đơn", danger: true, body: `Huỷ đơn ${orderSheet?.id} (${vnd(orderSheet?.total ?? 0)})?`, onOk: () => done(`Đã huỷ đơn ${orderSheet?.id}`) })}
                  className="ios-press-sm ios-fill flex items-center justify-center gap-2 rounded-2xl py-3 text-[14px] text-rose-300"><Ban className="h-4 w-4" /> Huỷ đơn</button>
              </div>
            </>
          ) : (
            <div className="mt-3 space-y-1.5">
              <div className="ios-card flex items-center justify-center gap-2 py-2.5 text-[13px] text-emerald-300"><Check className="h-4 w-4" /> Đã thu {vnd(orderSheet?.total ?? 0)} · {METHOD_LABEL[orderSheet?.method ?? "cash"]}{orderSheet?.comp ? " · comp" : ""}</div>
              <button onClick={() => ask({ title: "Hoàn tiền", danger: true, body: `Hoàn ${vnd(orderSheet?.total ?? 0)} cho ${orderSheet?.table} (${orderSheet?.id})?\nKhông hoàn tác — sẽ trừ vào doanh thu ca.`, onOk: () => done(`Đã hoàn ${vnd(orderSheet?.total ?? 0)}`) })}
                className="ios-press ios-fill flex w-full items-center justify-center gap-2 rounded-2xl py-3 text-[14px] text-rose-300"><RotateCcw className="h-4 w-4" /> Hoàn / huỷ đơn đã thu</button>
            </div>
          )}
        </SheetContent>
      </Sheet>

      {/* R4 — QR gọi món tại bàn */}
      <Sheet open={qrOpen} onOpenChange={setQrOpen}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">QR gọi món tại bàn</SheetTitle></SheetHeader>
          <div className="ios-group mt-3">
            {FNB_QR_TABLES.map((q) => (
              <div key={q.table} className="ios-row-inset flex items-center gap-3 px-4 py-3">
                <span className="min-w-0 flex-1">
                  <span className="block text-[15px] text-[#f2ece6]">{q.table}</span>
                  <span className="block text-[12px] text-[#9b8e97]">{q.active ? `đang bật · ${q.scans} lượt quét` : "chưa tạo mã"}</span>
                </span>
                {q.active ? (
                  <div className="flex items-center gap-1.5">
                    <button onClick={() => toast("In mã QR (bản mẫu)")} className="ios-press-sm grid h-8 w-8 place-items-center rounded-full bg-white/6 text-[#d8bc85]"><Printer className="h-4 w-4" /></button>
                    <button onClick={() => ask({ title: "Đổi mã QR", body: `Đổi mã ${q.table}? Mã cũ ngừng hoạt động ngay.`, onOk: () => done(`Đã đổi mã ${q.table}`) })} className="ios-press-sm grid h-8 w-8 place-items-center rounded-full bg-white/6 text-sky-300"><RotateCcw className="h-4 w-4" /></button>
                    <button onClick={() => ask({ title: "Thu hồi QR", danger: true, body: `Thu hồi mã ${q.table}? Khách không gọi món được nữa.`, onOk: () => done(`Đã thu hồi ${q.table}`) })} className="ios-press-sm grid h-8 w-8 place-items-center rounded-full bg-white/6 text-rose-300"><Trash2 className="h-4 w-4" /></button>
                  </div>
                ) : (
                  <button onClick={() => done(`Đã tạo mã ${q.table}`)} className="ios-press-sm rounded-full bg-[#c9a86a]/15 px-3 py-1 text-[12px] font-semibold text-[#d8bc85]">Tạo mã</button>
                )}
              </div>
            ))}
          </div>
        </SheetContent>
      </Sheet>

      {/* R5 — Kiểm kho nhanh */}
      <Sheet open={stockOpen} onOpenChange={setStockOpen}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-center"><SheetTitle className="text-[#f2ece6]">Kiểm kho nhanh</SheetTitle></SheetHeader>
          <div className="mt-1 px-1 text-center text-[12px] text-[#9b8e97]">nhập số đếm thực tế — lệch sẽ hiện</div>
          <div className="ios-group mt-3">
            {FNB_STOCK.map((s) => {
              const c = counts[s.name];
              const diff = c === "" || c === undefined ? null : Number(c) - s.system;
              return (
                <div key={s.name} className="ios-row-inset flex items-center gap-3 px-4 py-2.5">
                  <span className="min-w-0 flex-1">
                    <span className="block text-[14px] text-[#f2ece6]">{s.name}</span>
                    <span className="block text-[12px] text-[#9b8e97]">hệ thống: {s.system} {s.unit}{diff !== null && diff !== 0 ? <span className={diff < 0 ? " text-rose-300" : " text-amber-300"}> · lệch {diff > 0 ? "+" : ""}{diff}</span> : null}</span>
                  </span>
                  <input inputMode="numeric" value={c ?? ""} onChange={(e) => setCounts((p) => ({ ...p, [s.name]: e.target.value.replace(/[^0-9]/g, "") }))}
                    placeholder="đếm" className="ios-fill w-16 rounded-xl px-2 py-1.5 text-center font-mono text-[14px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]" />
                </div>
              );
            })}
          </div>
          <button onClick={() => ask({ title: "Chốt kiểm kho", body: "Chốt số đếm cuối ca? Lệch sẽ ghi nhận điều chỉnh tồn.", onOk: () => { setCounts({}); done("Đã chốt kiểm kho"); } })}
            className="ios-press ios-primary mt-3 w-full rounded-2xl py-3 text-[15px] font-bold">Chốt kiểm kho</button>
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

function Row({ l, v, vCls, big }: { l: string; v: string; vCls?: string; big?: boolean }) {
  return (
    <div className="flex items-center justify-between py-1 text-[14px]">
      <span className="text-[#9b8e97]">{l}</span>
      <span className={cn("font-mono font-semibold", big ? "text-[17px]" : "text-[15px]", vCls ?? "text-[#f2ece6]")}>{v}</span>
    </div>
  );
}
