import { useEffect, useMemo, useRef, useState } from "react";
import { Navigate, useSearchParams } from "react-router-dom";
import { QRCodeSVG } from "qrcode.react";
import { FEATURES } from "@/lib/featureFlags";
import { formatVND } from "@/lib/format";
import { mapFnbError } from "@/lib/fnbErrors";
import { buildVietQrPayload } from "@/lib/vietqr";
import { normalizeBankNameToBin } from "@/lib/vietnamBanks";
import {
  useFnbGuestLookup, useFnbGuestOrderStatus, fnbGuestCreateOrder,
  type FnbGuestItem, type FnbGuestBank, type FnbGuestCreateResult,
} from "@/hooks/useFnbGuest";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Plus, Minus, Utensils, Wallet, QrCode, CheckCircle2, Clock, ArrowLeft } from "lucide-react";

/**
 * F&B GUEST QR ordering (/fnb/order?t=<token>) — the guest's phone flow. Chrome-less, SESSIONLESS
 * (anon), gated on FEATURES.fnbGuestOrder. State machine: welcome (pick seat) → menu (cart) →
 * review (name + payment) → cash-wait | bank-qr (VietQR + poll) → done | expired. Resume via
 * localStorage. All data via the anon fnb_guest_* RPCs (useFnbGuest). Hardcoded VN (F&B house style).
 */
export default function FnbTableOrder() {
  const [params] = useSearchParams();
  const token = params.get("t");
  if (!FEATURES.fnbModule || !FEATURES.fnbGuestOrder) return <Navigate to="/" replace />;
  if (!token) return <GuestShell><ErrorState msg="Thiếu mã QR — vui lòng quét lại mã trên bàn." /></GuestShell>;
  return <GuestOrderInner token={token} />;
}

const LS_KEY = (token: string) => `fnb.guest.order.${token}`;

type Phase = "welcome" | "menu" | "review" | "wait";

function GuestOrderInner({ token }: { token: string }) {
  const { data: lookup, isLoading, error } = useFnbGuestLookup(token);

  const [phase, setPhase] = useState<Phase>("welcome");
  const [seat, setSeat] = useState<number | null>(null);
  const [name, setName] = useState("");
  const [note, setNote] = useState("");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [method, setMethod] = useState<"cash" | "bank_transfer">("cash");
  const [submitting, setSubmitting] = useState(false);
  const [created, setCreated] = useState<FnbGuestCreateResult | null>(null);
  const crid = useRef<string>(crypto.randomUUID());

  // Resume an in-flight order across a refresh (localStorage). If found, jump straight to the wait screen.
  useEffect(() => {
    try {
      const raw = localStorage.getItem(LS_KEY(token));
      if (raw) {
        const saved = JSON.parse(raw) as FnbGuestCreateResult;
        if (saved?.order_id) { setCreated(saved); setPhase("wait"); }
      }
    } catch { /* ignore */ }
  }, [token]);

  const items = useMemo(() => lookup?.items ?? [], [lookup]);
  const lines = useMemo(() => items.filter((m) => cart[m.id]), [items, cart]);
  const subtotal = lines.reduce((s, m) => s + m.price_vnd * cart[m.id], 0);

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const dec = (id: string) => setCart((c) => {
    const n = (c[id] ?? 0) - 1; const x = { ...c }; if (n <= 0) delete x[id]; else x[id] = n; return x;
  });

  const submit = async () => {
    if (lines.length === 0 || submitting) return;
    setSubmitting(true);
    const { res, errorCode } = await fnbGuestCreateOrder({
      token, seat, customerName: name.trim() || null, note: note.trim() || null,
      lines: lines.map((m) => ({ menu_item_id: m.id, qty: cart[m.id] })),
      paymentMethod: method, clientRequestId: crid.current,
    });
    setSubmitting(false);
    if (errorCode || !res) { alert(mapFnbError(errorCode ?? "")); return; }
    setCreated(res);
    try { localStorage.setItem(LS_KEY(token), JSON.stringify(res)); } catch { /* ignore */ }
    setPhase("wait");
  };

  const startOver = () => {
    try { localStorage.removeItem(LS_KEY(token)); } catch { /* ignore */ }
    setCreated(null); setCart({}); setName(""); setNote(""); setMethod("cash");
    crid.current = crypto.randomUUID();
    setPhase("menu");
  };

  if (isLoading) return <GuestShell><div className="flex items-center gap-2 text-muted-foreground py-16 justify-center"><Loader2 className="w-5 h-5 animate-spin" /> Đang tải…</div></GuestShell>;
  if (error || !lookup) return <GuestShell><ErrorState msg={mapFnbError((error as any)?.message ?? "TOKEN_INVALID")} /></GuestShell>;

  // ── wait screen (owns its own polling) ──────────────────────────────────────────────────────
  if (phase === "wait" && created) {
    return <GuestShell title={lookup.table_name}>
      <WaitScreen token={token} created={created} onReorder={startOver} />
    </GuestShell>;
  }

  return (
    <GuestShell title={lookup.club_name}>
      {/* ── welcome: confirm table + pick seat ── */}
      {phase === "welcome" && (
        <div className="space-y-5">
          <div className="text-center space-y-1">
            <div className="text-xs uppercase tracking-wider text-muted-foreground">Bạn đang ngồi tại</div>
            <div className="text-3xl font-bold text-primary">{lookup.table_name}</div>
          </div>
          <div>
            <div className="text-sm font-medium mb-2 text-center">Bạn ngồi ghế số mấy?</div>
            <div className="grid grid-cols-5 gap-2">
              {Array.from({ length: 10 }, (_, i) => i + 1).map((n) => (
                <button key={n} onClick={() => setSeat(n)}
                  className={`h-12 rounded-lg border text-base font-semibold transition-colors ${seat === n ? "bg-primary text-primary-foreground border-primary" : "border-border text-foreground hover:border-primary/50"}`}>
                  {n}
                </button>
              ))}
            </div>
            <button onClick={() => setSeat(null)}
              className={`mt-2 w-full h-9 rounded-lg border text-xs ${seat === null ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}>
              Không rõ số ghế / bỏ qua
            </button>
          </div>
          <Button className="w-full h-12 text-base" onClick={() => setPhase("menu")}>
            <Utensils className="w-4 h-4 mr-1" /> Xem thực đơn
          </Button>
        </div>
      )}

      {/* ── menu: categories + items + cart ── */}
      {phase === "menu" && (
        <MenuScreen lookup={lookup} cart={cart} add={add} dec={dec}
          subtotal={subtotal} count={lines.reduce((s, m) => s + cart[m.id], 0)}
          onBack={() => setPhase("welcome")} onNext={() => setPhase("review")} />
      )}

      {/* ── review: name + note + payment choice ── */}
      {phase === "review" && (
        <div className="space-y-4">
          <button onClick={() => setPhase("menu")} className="text-xs text-muted-foreground flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Quay lại thực đơn</button>
          <Card className="p-4 space-y-2">
            <div className="text-sm font-semibold">Đơn của bạn {seat ? `· Ghế ${seat}` : ""}</div>
            {lines.map((m) => (
              <div key={m.id} className="flex justify-between text-sm">
                <span className="truncate">{cart[m.id]}× {m.name}</span>
                <span className="font-mono shrink-0">{formatVND(m.price_vnd * cart[m.id])}</span>
              </div>
            ))}
            <div className="border-t border-border pt-2 flex justify-between font-semibold">
              <span>Tổng cộng</span><span className="font-mono">{formatVND(subtotal)}</span>
            </div>
          </Card>
          <div className="space-y-2">
            <Input value={name} onChange={(e) => setName(e.target.value)} placeholder="Tên của bạn (tuỳ chọn)" maxLength={60} className="h-11" />
            <Input value={note} onChange={(e) => setNote(e.target.value)} placeholder="Ghi chú (vd: ít đá, không đường)" maxLength={200} className="h-11" />
          </div>
          <div className="space-y-2">
            <div className="text-sm font-medium">Hình thức thanh toán</div>
            <button onClick={() => setMethod("cash")}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left ${method === "cash" ? "border-primary bg-primary/5" : "border-border"}`}>
              <Wallet className="w-5 h-5 text-primary" />
              <div><div className="font-medium text-sm">Tiền mặt</div><div className="text-xs text-muted-foreground">Nhân viên đến bàn thu tiền</div></div>
            </button>
            <button disabled={!lookup.bank_available} onClick={() => setMethod("bank_transfer")}
              className={`w-full flex items-center gap-3 p-3 rounded-lg border text-left disabled:opacity-40 ${method === "bank_transfer" ? "border-primary bg-primary/5" : "border-border"}`}>
              <QrCode className="w-5 h-5 text-primary" />
              <div><div className="font-medium text-sm">Chuyển khoản (VietQR)</div><div className="text-xs text-muted-foreground">{lookup.bank_available ? "Quét QR ngân hàng, tự xác nhận" : "Chưa hỗ trợ tại CLB này"}</div></div>
            </button>
          </div>
          <Button className="w-full h-12 text-base" disabled={lines.length === 0 || submitting} onClick={submit}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
            {method === "cash" ? "Gửi đơn — trả tiền mặt" : "Gửi đơn & lấy mã QR"}
          </Button>
        </div>
      )}
    </GuestShell>
  );
}

function MenuScreen({ lookup, cart, add, dec, subtotal, count, onBack, onNext }: {
  lookup: NonNullable<ReturnType<typeof useFnbGuestLookup>["data"]>;
  cart: Record<string, number>; add: (id: string) => void; dec: (id: string) => void;
  subtotal: number; count: number; onBack: () => void; onNext: () => void;
}) {
  const [activeCat, setActiveCat] = useState<string>("all");
  const items = lookup.items;
  const shown = activeCat === "all" ? items : items.filter((m) => m.category_id === activeCat);
  return (
    <div className="space-y-3 pb-24">
      <button onClick={onBack} className="text-xs text-muted-foreground flex items-center gap-1"><ArrowLeft className="w-3.5 h-3.5" /> Bàn / ghế</button>
      <div className="flex flex-wrap gap-1.5">
        <CatChip active={activeCat === "all"} onClick={() => setActiveCat("all")}>Tất cả</CatChip>
        {lookup.categories.map((c) => (
          <CatChip key={c.id} active={activeCat === c.id} onClick={() => setActiveCat(c.id)}>{c.name}</CatChip>
        ))}
      </div>
      {shown.length === 0 ? (
        <div className="text-sm text-muted-foreground py-8 text-center">Chưa có món trong mục này.</div>
      ) : (
        <div className="space-y-2">
          {shown.map((m) => <MenuRow key={m.id} item={m} qty={cart[m.id] ?? 0} add={() => add(m.id)} dec={() => dec(m.id)} />)}
        </div>
      )}
      {count > 0 && (
        <div className="fixed inset-x-0 bottom-0 p-3 bg-background/95 backdrop-blur border-t border-border">
          <Button className="w-full h-12 text-base" onClick={onNext}>
            Xem đơn ({count} món) · {formatVND(subtotal)}
          </Button>
        </div>
      )}
    </div>
  );
}

function MenuRow({ item, qty, add, dec }: { item: FnbGuestItem; qty: number; add: () => void; dec: () => void }) {
  return (
    <div className="flex items-center gap-3 p-3 rounded-lg border border-border bg-card">
      {item.image_url ? <img src={item.image_url} alt="" className="w-14 h-14 rounded-md object-cover shrink-0" /> : null}
      <div className="flex-1 min-w-0">
        <div className="text-sm font-medium leading-tight">{item.name}</div>
        <div className="text-xs text-muted-foreground font-mono mt-0.5">{formatVND(item.price_vnd)}</div>
      </div>
      <div className="flex items-center gap-1.5 shrink-0">
        {qty > 0 && <>
          <Button size="icon" variant="outline" className="h-8 w-8" onClick={dec}><Minus className="w-4 h-4" /></Button>
          <span className="w-6 text-center font-mono">{qty}</span>
        </>}
        <Button size="icon" className="h-8 w-8" onClick={add}><Plus className="w-4 h-4" /></Button>
      </div>
    </div>
  );
}

const CatChip = ({ active, onClick, children }: { active: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button onClick={onClick}
    className={`text-xs px-3 py-1.5 rounded-full border ${active ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground"}`}>
    {children}
  </button>
);

// ── wait screen: cash → "server coming"; bank → VietQR + poll ──────────────────────────────────
function WaitScreen({ token, created, onReorder }: { token: string; created: FnbGuestCreateResult; onReorder: () => void }) {
  const { data: status } = useFnbGuestOrderStatus(token, created.order_id);
  const st = status?.order?.order_status ?? "pending";
  // status RPC re-returns the bank payload for pending bank orders; fall back to the create response.
  const bank: FnbGuestBank | null = status?.bank ?? created.bank;

  if (st === "paid" || st === "shipped") {
    return (
      <div className="text-center space-y-3 py-10">
        <CheckCircle2 className="w-16 h-16 text-success mx-auto" />
        <div className="text-xl font-bold">Đã nhận đơn!</div>
        <div className="text-sm text-muted-foreground">Món của bạn đang được chuẩn bị. Cảm ơn bạn!</div>
        <Button variant="outline" className="mt-2" onClick={onReorder}>Gọi thêm món</Button>
      </div>
    );
  }
  if (st === "expired" || st === "cancelled") {
    return (
      <div className="text-center space-y-3 py-10">
        <Clock className="w-14 h-14 text-muted-foreground mx-auto" />
        <div className="text-lg font-bold">Đơn đã hết hạn</div>
        <div className="text-sm text-muted-foreground">
          {created.payment_method === "bank_transfer"
            ? "Nếu bạn đã chuyển khoản, đơn sẽ được xác nhận trong ít phút — vui lòng báo nhân viên. Hoặc gọi lại đơn mới."
            : "Đơn chưa được thu tiền kịp thời. Vui lòng gọi lại."}
        </div>
        <Button className="mt-2" onClick={onReorder}>Gọi lại</Button>
      </div>
    );
  }

  // pending — cash vs bank
  if (created.payment_method === "cash") {
    return (
      <div className="text-center space-y-3 py-10">
        <Wallet className="w-14 h-14 text-primary mx-auto" />
        <div className="text-lg font-bold">Đã gửi đơn!</div>
        <div className="text-sm text-muted-foreground">Nhân viên phục vụ sẽ đến bàn thu tiền mặt. Vui lòng chờ trong giây lát.</div>
        <div className="font-mono text-lg">{formatVND(created.subtotal_vnd)}</div>
      </div>
    );
  }

  // bank pending → VietQR
  const payload = (() => {
    if (!bank) return null;
    const bin = (bank.bank_bin && bank.bank_bin.trim()) || normalizeBankNameToBin(bank.bank_name);
    if (!bin || !created.reference_code) return null;
    try {
      return buildVietQrPayload({ bin, accountNumber: bank.account_number, amount: created.subtotal_vnd, memo: created.reference_code.toUpperCase() });
    } catch { return null; }
  })();

  return (
    <div className="space-y-3 py-2 text-center">
      <div className="text-lg font-bold">Quét mã để chuyển khoản</div>
      <div className="text-sm text-muted-foreground">Mở app ngân hàng, quét mã dưới đây. Số tiền và nội dung đã điền sẵn.</div>
      <div className="flex justify-center">
        {payload
          ? <div className="bg-white p-3 rounded-xl"><QRCodeSVG value={payload} size={216} level="M" marginSize={2} /></div>
          : bank?.qr_code_url
            ? <img src={bank.qr_code_url} alt="QR" className="w-56 h-56 rounded-xl object-contain bg-white p-2" />
            : <div className="text-sm text-destructive py-8">Không tạo được mã QR — vui lòng chọn tiền mặt.</div>}
      </div>
      <Card className="p-3 text-left text-sm space-y-1">
        <Row k="Ngân hàng" v={bank?.bank_name ?? "—"} />
        <Row k="Số tài khoản" v={bank?.account_number ?? "—"} mono />
        <Row k="Chủ tài khoản" v={bank?.account_holder ?? "—"} />
        <Row k="Số tiền" v={formatVND(created.subtotal_vnd)} mono />
        <Row k="Nội dung" v={created.reference_code ?? "—"} mono />
      </Card>
      <div className="flex items-center justify-center gap-2 text-xs text-muted-foreground">
        <Loader2 className="w-3.5 h-3.5 animate-spin" /> Đang chờ xác nhận thanh toán… (tự động, có thể mất vài phút)
      </div>
      <Button variant="ghost" className="text-xs" onClick={onReorder}>Huỷ / gọi lại</Button>
    </div>
  );
}

const Row = ({ k, v, mono }: { k: string; v: string; mono?: boolean }) => (
  <div className="flex justify-between gap-2">
    <span className="text-muted-foreground">{k}</span>
    <span className={mono ? "font-mono font-medium text-right break-all" : "font-medium text-right"}>{v}</span>
  </div>
);

// ── chrome-less shell (no Layout nav; guest phone) ─────────────────────────────────────────────
function GuestShell({ title, children }: { title?: string; children: React.ReactNode }) {
  return (
    <div className="min-h-screen bg-background text-foreground">
      <div className="mx-auto max-w-md px-4 py-5">
        <div className="flex items-center gap-2 mb-4">
          <Utensils className="w-5 h-5 text-primary" />
          <div className="text-sm font-semibold truncate">{title ?? "Gọi món"}</div>
        </div>
        {children}
      </div>
    </div>
  );
}

function ErrorState({ msg }: { msg: string }) {
  return (
    <div className="text-center space-y-3 py-16">
      <QrCode className="w-14 h-14 text-muted-foreground mx-auto" />
      <div className="text-base font-semibold">Không mở được trang gọi món</div>
      <div className="text-sm text-muted-foreground">{msg}</div>
    </div>
  );
}
