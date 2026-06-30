import { useEffect, useMemo, useRef, useState } from "react";
import { useFnbMenu } from "@/hooks/useFnbMenu";
import { formatVND } from "@/lib/format";
import { FEATURES } from "@/lib/featureFlags";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Gift, Loader2, Plus, Minus, Receipt } from "lucide-react";

export type NewOrder = {
  table_label: string | null;
  customer_name: string | null;
  note: string | null;
  client_request_id: string;
  // resolved lines: menu_item_id + qty drive the RPC; name/price drive the confirm dialog preview.
  items: { menu_item_id: string; qty: number; name_snapshot: string; unit_price_snapshot: number }[];
  subtotal_vnd: number;
};

/**
 * Counter cart builder (presentational — parent owns fnb_create_order via onSubmit). Category chips →
 * active menu tiles (tap to add) → cart with +/- steppers → optional table/customer → submit.
 * IDEMPOTENCY: one crypto.randomUUID() per cart (ref), reused on every submit attempt; parent bumps
 * `resetKey` ONLY after a successful create → the cart clears + a fresh crid is minted for the next
 * order. A failed create keeps the same crid (the retry is idempotent on fnb_orders UNIQUE).
 */
export function OrderEntryPanel({ clubId, submitting, resetKey, onSubmit, onSubmitComp }: {
  clubId: string; submitting: boolean; resetKey: number;
  onSubmit: (o: NewOrder) => void;
  onSubmitComp?: (o: NewOrder) => void;
}) {
  const { data, isLoading } = useFnbMenu(clubId);
  const cats = data?.categories ?? [];
  const items = useMemo(() => (data?.items ?? []).filter((m) => m.is_active), [data]);

  const [activeCat, setActiveCat] = useState<string>("all");
  const [cart, setCart] = useState<Record<string, number>>({});
  const [table, setTable] = useState("");
  const [customer, setCustomer] = useState("");
  const crid = useRef<string>(crypto.randomUUID());

  // parent bumps resetKey after a successful create → clear cart + mint a new idempotency key.
  useEffect(() => {
    if (resetKey === 0) return;
    setCart({}); setTable(""); setCustomer(""); crid.current = crypto.randomUUID();
  }, [resetKey]);

  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const dec = (id: string) => setCart((c) => {
    const n = (c[id] ?? 0) - 1; const x = { ...c }; if (n <= 0) delete x[id]; else x[id] = n; return x;
  });

  const lines = useMemo(() => items.filter((m) => cart[m.id]), [items, cart]);
  const subtotal = lines.reduce((s, m) => s + m.price_vnd * cart[m.id], 0);
  const shown = activeCat === "all" ? items : items.filter((m) => m.category_id === activeCat);

  const buildOrder = (): NewOrder => ({
    table_label: table.trim() || null,
    customer_name: customer.trim() || null,
    note: null,
    client_request_id: crid.current,
    items: lines.map((m) => ({
      menu_item_id: m.id, qty: cart[m.id], name_snapshot: m.name, unit_price_snapshot: m.price_vnd,
    })),
    subtotal_vnd: subtotal,
  });

  const submit = () => { if (lines.length === 0 || submitting) return; onSubmit(buildOrder()); };
  const submitComp = () => { if (lines.length === 0 || submitting) return; onSubmitComp?.(buildOrder()); };

  if (isLoading) {
    return <Card className="p-5"><div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="w-4 h-4 animate-spin" /> Đang tải thực đơn…</div></Card>;
  }
  if (items.length === 0) {
    return <Card className="p-5 text-sm text-muted-foreground">Chưa có món nào đang bán. Thêm món ở tab Quản trị → Thực đơn.</Card>;
  }

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_320px]">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          <button onClick={() => setActiveCat("all")}
            className={`text-xs px-3 py-1.5 rounded-lg border ${activeCat === "all" ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
            Tất cả
          </button>
          {cats.filter((c) => c.is_active).map((c) => (
            <button key={c.id} onClick={() => setActiveCat(c.id)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${activeCat === c.id ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {c.name}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {shown.map((m) => (
            <button key={m.id} onClick={() => add(m.id)}
              className="text-left rounded-lg border border-border bg-card hover:border-primary/40 p-3 transition-colors">
              <div className="text-sm font-medium leading-tight">{m.name}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">{formatVND(m.price_vnd)}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4 flex flex-col">
        <div className="text-sm font-semibold mb-2">Đơn hàng</div>
        <div className="grid grid-cols-2 gap-2 mb-3">
          <div><Label className="text-xs text-muted-foreground">Bàn</Label>
            <Input value={table} onChange={(e) => setTable(e.target.value)} placeholder="vd: Bàn 3"
              className="bg-card border-border text-foreground h-8" /></div>
          <div><Label className="text-xs text-muted-foreground">Khách</Label>
            <Input value={customer} onChange={(e) => setCustomer(e.target.value)} placeholder="(tuỳ chọn)"
              className="bg-card border-border text-foreground h-8" /></div>
        </div>
        <div className="flex-1 space-y-2 min-h-[60px]">
          {lines.length === 0 ? (
            <div className="text-xs text-muted-foreground py-6 text-center">Bấm món bên trái để thêm.</div>
          ) : lines.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{m.name}</div>
                <div className="text-[11px] text-muted-foreground font-mono">{formatVND(m.price_vnd)}</div>
              </div>
              <div className="flex items-center gap-1">
                <Button size="icon" variant="outline" className="h-6 w-6 border-border" onClick={() => dec(m.id)}><Minus className="w-3 h-3" /></Button>
                <span className="w-5 text-center text-sm font-mono">{cart[m.id]}</span>
                <Button size="icon" variant="outline" className="h-6 w-6 border-border" onClick={() => add(m.id)}><Plus className="w-3 h-3" /></Button>
              </div>
            </div>
          ))}
        </div>
        <div className="border-t border-border mt-3 pt-3 space-y-2">
          <div className="flex justify-between text-sm"><span className="text-muted-foreground">Tổng cộng</span><span className="font-mono font-semibold">{formatVND(subtotal)}</span></div>
          <Button className="w-full bg-success hover:bg-success/90 text-success-foreground" disabled={lines.length === 0 || submitting} onClick={submit}>
            {submitting ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Receipt className="w-4 h-4 mr-1" />}
            Tạo đơn &amp; thu tiền
          </Button>
          {FEATURES.fnbComp && onSubmitComp && (
            <Button variant="outline" className="w-full border-border text-muted-foreground hover:text-foreground" disabled={lines.length === 0 || submitting} onClick={submitComp}>
              <Gift className="w-4 h-4 mr-1" /> Comp / Miễn phí
            </Button>
          )}
        </div>
      </Card>
    </div>
  );
}
