import { useState } from "react";
import { Navigate } from "react-router-dom";
import { toast } from "sonner";
import { FEATURES } from "@/lib/featureFlags";
import { formatVND } from "@/lib/format";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Table, TableBody, TableCell, TableHead, TableHeader, TableFooter, TableRow } from "@/components/ui/table";
import { UtensilsCrossed, ChefHat, Boxes, ClipboardCheck, Plus, Minus, Check, AlertTriangle, Clock, Eye } from "lucide-react";

/**
 * F&B PUBLIC DEMO (/fnb/demo) — a SELF-CONTAINED, STATIC showcase for showing the F&B vision to a
 * guest. Gate: FEATURES.fnbDemo. This page imports NO supabase client and calls NO RPC — every
 * button is a no-op toast — so a viewer can click freely and can NEVER read or mutate real data.
 * It reproduces the reviewed mockup (counter → kitchen → inventory → stocktake) with sample data,
 * using the app's real components + tokens so the warm theme applies. Distinct from the real
 * /fnb/admin (which is gated by fnbModule and DOES call live RPCs).
 */

const CATS = ["Cà phê", "Trà", "Nước", "Đồ ăn"] as const;
const MENU = [
  { id: "m1", cat: "Cà phê", name: "Cà phê sữa đá", price: 25000 },
  { id: "m2", cat: "Cà phê", name: "Cà phê đen", price: 20000 },
  { id: "m3", cat: "Cà phê", name: "Bạc xỉu", price: 28000 },
  { id: "m4", cat: "Trà", name: "Trà đào", price: 30000 },
  { id: "m5", cat: "Trà", name: "Trà chanh", price: 22000 },
  { id: "m6", cat: "Nước", name: "Coca", price: 15000 },
  { id: "m7", cat: "Nước", name: "Nước suối", price: 10000 },
  { id: "m8", cat: "Đồ ăn", name: "Mì xào bò", price: 55000 },
  { id: "m9", cat: "Đồ ăn", name: "Cơm chiên hải sản", price: 50000 },
];
const TICKETS = [
  { id: "t1", label: "Bàn 3", mins: 4, items: [{ n: "Cà phê sữa đá", q: 2 }, { n: "Mì xào bò", q: 1 }] },
  { id: "t2", label: "Bàn 7", mins: 9, items: [{ n: "Trà đào", q: 1 }, { n: "Coca", q: 3 }] },
  { id: "t3", label: "Quầy", mins: 1, items: [{ n: "Bạc xỉu", q: 1 }] },
];
const INGREDIENTS = [
  { name: "Cà phê hạt", unit: "g", purchase: "kg (×1000)", onHand: 1200, avg: 210, low: 500 },
  { name: "Sữa đặc", unit: "lon", purchase: "", onHand: 8, avg: 22000, low: 10 },
  { name: "Coca lon", unit: "lon", purchase: "", onHand: 36, avg: 9000, low: 12 },
  { name: "Đá viên", unit: "kg", purchase: "", onHand: 4, avg: 3000, low: 5 },
  { name: "Trà túi lọc", unit: "gói", purchase: "", onHand: 80, avg: 1500, low: 20 },
];
const COUNTS = [
  { name: "Cà phê hạt", unit: "g", book: 1200, counted: 1180, avg: 210 },
  { name: "Sữa đặc", unit: "lon", book: 8, counted: 8, avg: 22000 },
  { name: "Coca lon", unit: "lon", book: 36, counted: 40, avg: 9000 },
  { name: "Đá viên", unit: "kg", book: 4, counted: 3, avg: 3000 },
];

const demoToast = () => toast("Bản xem thử — thao tác không lưu gì.", { icon: "👀" });

export default function FnbDemo() {
  if (!FEATURES.fnbDemo) return <Navigate to="/" replace />;
  return <FnbDemoInner />;
}

function FnbDemoInner() {
  return (
    <div className="container mx-auto max-w-5xl px-4 py-6 space-y-4">
      <div className="rounded-lg border border-warning/40 bg-warning/5 px-4 py-2.5 flex items-center gap-2 text-sm text-warning">
        <Eye className="w-4 h-4 shrink-0" />
        <span><span className="font-semibold">BẢN XEM THỬ</span> · dữ liệu mẫu · mọi nút chỉ minh hoạ, không lưu gì vào hệ thống.</span>
      </div>

      <div>
        <h1 className="text-lg font-semibold flex items-center gap-2"><UtensilsCrossed className="w-5 h-5 text-primary" /> F&amp;B · VinPoker</h1>
        <p className="text-xs text-muted-foreground">Gọi món trả trước → màn hình bếp → trừ kho &amp; giá vốn tự động. Bấm thử các tab bên dưới.</p>
      </div>

      <Tabs defaultValue="counter" className="w-full">
        <TabsList className="flex-wrap h-auto">
          <TabsTrigger value="counter"><UtensilsCrossed className="w-4 h-4 mr-1.5" /> Quầy thu ngân</TabsTrigger>
          <TabsTrigger value="kitchen"><ChefHat className="w-4 h-4 mr-1.5" /> Màn hình bếp</TabsTrigger>
          <TabsTrigger value="stock"><Boxes className="w-4 h-4 mr-1.5" /> Kho &amp; giá vốn</TabsTrigger>
          <TabsTrigger value="count"><ClipboardCheck className="w-4 h-4 mr-1.5" /> Kiểm kho</TabsTrigger>
        </TabsList>

        <TabsContent value="counter" className="mt-4"><CounterDemo /></TabsContent>
        <TabsContent value="kitchen" className="mt-4"><KitchenDemo /></TabsContent>
        <TabsContent value="stock" className="mt-4"><StockDemo /></TabsContent>
        <TabsContent value="count" className="mt-4"><CountDemo /></TabsContent>
      </Tabs>
    </div>
  );
}

function CounterDemo() {
  const [cat, setCat] = useState<string>(CATS[0]);
  const [cart, setCart] = useState<Record<string, number>>({ m1: 2, m8: 1 });
  const add = (id: string) => setCart((c) => ({ ...c, [id]: (c[id] ?? 0) + 1 }));
  const dec = (id: string) => setCart((c) => { const n = (c[id] ?? 0) - 1; const next = { ...c }; if (n <= 0) delete next[id]; else next[id] = n; return next; });
  const lines = MENU.filter((m) => cart[m.id]);
  const subtotal = lines.reduce((s, m) => s + m.price * cart[m.id], 0);

  return (
    <div className="grid gap-4 md:grid-cols-[1fr_300px]">
      <Card className="p-4 space-y-3">
        <div className="flex flex-wrap gap-1.5">
          {CATS.map((c) => (
            <button key={c} onClick={() => setCat(c)}
              className={`text-xs px-3 py-1.5 rounded-lg border ${cat === c ? "bg-primary/10 border-primary/40 text-foreground" : "border-border text-muted-foreground hover:text-foreground"}`}>
              {c}
            </button>
          ))}
        </div>
        <div className="grid grid-cols-2 sm:grid-cols-3 gap-2">
          {MENU.filter((m) => m.cat === cat).map((m) => (
            <button key={m.id} onClick={() => add(m.id)}
              className="text-left rounded-lg border border-border bg-card hover:border-primary/40 p-3 transition-colors">
              <div className="text-sm font-medium leading-tight">{m.name}</div>
              <div className="text-xs text-muted-foreground mt-1 font-mono">{formatVND(m.price)}</div>
            </button>
          ))}
        </div>
      </Card>

      <Card className="p-4 flex flex-col">
        <div className="text-sm font-semibold mb-2">Đơn hàng</div>
        <div className="flex-1 space-y-2">
          {lines.length === 0 ? (
            <div className="text-xs text-muted-foreground py-8 text-center">Bấm món bên trái để thêm.</div>
          ) : lines.map((m) => (
            <div key={m.id} className="flex items-center gap-2">
              <div className="flex-1 min-w-0">
                <div className="text-sm truncate">{m.name}</div>
                <div className="text-[11px] text-muted-foreground font-mono">{formatVND(m.price)}</div>
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
          <Button className="w-full bg-success hover:bg-success/90 text-success-foreground" disabled={lines.length === 0} onClick={demoToast}>
            <Check className="w-4 h-4 mr-1" /> Thu tiền (trả trước)
          </Button>
          <p className="text-[11px] text-muted-foreground text-center">Trả trước = thu tiền xong mới xuống bếp.</p>
        </div>
      </Card>
    </div>
  );
}

function KitchenDemo() {
  return (
    <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {TICKETS.map((t) => (
        <Card key={t.id} className="p-4 space-y-3">
          <div className="flex items-center justify-between">
            <div className="font-semibold text-sm">{t.label}</div>
            <div className={`flex items-center gap-1 text-xs ${t.mins >= 8 ? "text-destructive" : "text-muted-foreground"}`}>
              <Clock className="w-3.5 h-3.5" /> {t.mins} phút
            </div>
          </div>
          <div className="space-y-1.5">
            {t.items.map((it, idx) => (
              <div key={idx} className="flex items-center justify-between rounded-md border border-border bg-card px-2.5 py-1.5">
                <span className="text-sm"><span className="font-mono text-muted-foreground mr-1.5">{it.q}×</span>{it.n}</span>
                <Button size="sm" variant="ghost" className="h-7 text-success" onClick={demoToast}><Check className="w-3.5 h-3.5 mr-1" /> Xong</Button>
              </div>
            ))}
          </div>
          <Button size="sm" className="w-full bg-success hover:bg-success/90 text-success-foreground" onClick={demoToast}>
            <Check className="w-4 h-4 mr-1" /> Xong tất cả
          </Button>
        </Card>
      ))}
    </div>
  );
}

function StockDemo() {
  const totalValue = INGREDIENTS.reduce((s, i) => s + i.onHand * i.avg, 0);
  const lowCount = INGREDIENTS.filter((i) => i.onHand <= i.low).length;
  return (
    <Card className="p-5 space-y-4">
      <div>
        <h3 className="font-semibold text-base">Nguyên liệu &amp; giá vốn</h3>
        <p className="text-xs text-muted-foreground">Tồn kho + giá vốn TB chỉ-xem (đổi qua Nhập kho / Kiểm kho). Cột "Giá trị tồn" cho biết kho đang giam bao nhiêu tiền.</p>
      </div>
      {lowCount > 0 && (
        <div className="rounded-lg border border-warning/40 bg-warning/5 p-3 flex items-center gap-2 text-xs text-warning">
          <AlertTriangle className="w-4 h-4 shrink-0" /> {lowCount} nguyên liệu dưới ngưỡng cảnh báo.
        </div>
      )}
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nguyên liệu</TableHead>
              <TableHead>Đơn vị</TableHead>
              <TableHead className="text-right">Tồn kho</TableHead>
              <TableHead className="text-right">Giá vốn TB</TableHead>
              <TableHead className="text-right">Giá trị tồn</TableHead>
              <TableHead className="text-center w-24">Ngưỡng</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {INGREDIENTS.map((i) => {
              const isLow = i.onHand <= i.low;
              return (
                <TableRow key={i.name} className={isLow ? "bg-warning/5" : undefined}>
                  <TableCell className="font-medium">{i.name}</TableCell>
                  <TableCell className="text-muted-foreground text-xs">{i.unit}{i.purchase ? ` · mua theo ${i.purchase}` : ""}</TableCell>
                  <TableCell className="text-right font-mono">
                    <span className={isLow ? "text-warning font-semibold" : ""}>{i.onHand}</span> <span className="text-muted-foreground text-xs">{i.unit}</span>
                  </TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{formatVND(i.avg)}</TableCell>
                  <TableCell className="text-right font-mono">{formatVND(i.onHand * i.avg)}</TableCell>
                  <TableCell className="text-center text-muted-foreground">{i.low}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right text-xs text-muted-foreground">Tổng giá trị kho</TableCell>
              <TableCell className="text-right font-mono font-semibold">{formatVND(totalValue)}</TableCell>
              <TableCell />
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </Card>
  );
}

function CountDemo() {
  const totalDelta = COUNTS.reduce((s, c) => s + (c.counted - c.book) * c.avg, 0);
  return (
    <Card className="p-5 space-y-4">
      <div className="flex items-center justify-between gap-2">
        <div>
          <h3 className="font-semibold text-base">Kiểm kho · phiên đang mở</h3>
          <p className="text-xs text-muted-foreground">Đếm tồn thực tế → "Chốt". Cột "Lệch (₫)" quy hao hụt ra tiền.</p>
        </div>
        <Button className="bg-success hover:bg-success/90 text-success-foreground" onClick={demoToast}>
          <Check className="w-4 h-4 mr-1" /> Chốt kiểm kho
        </Button>
      </div>
      <div className="overflow-x-auto">
        <Table>
          <TableHeader>
            <TableRow>
              <TableHead>Nguyên liệu</TableHead>
              <TableHead className="text-right">Sổ (hiện tại)</TableHead>
              <TableHead className="text-right">Đếm thực tế</TableHead>
              <TableHead className="text-right">Lệch</TableHead>
              <TableHead className="text-right">Lệch (₫)</TableHead>
            </TableRow>
          </TableHeader>
          <TableBody>
            {COUNTS.map((c) => {
              const d = c.counted - c.book;
              const cls = d === 0 ? "text-muted-foreground" : d > 0 ? "text-success" : "text-destructive";
              return (
                <TableRow key={c.name}>
                  <TableCell className="font-medium">{c.name} <span className="text-muted-foreground text-xs">({c.unit})</span></TableCell>
                  <TableCell className="text-right font-mono text-muted-foreground">{c.book}</TableCell>
                  <TableCell className="text-right font-mono">{c.counted}</TableCell>
                  <TableCell className={`text-right font-mono ${cls}`}>{d > 0 ? "+" : ""}{d}</TableCell>
                  <TableCell className={`text-right font-mono ${cls}`}>{(d > 0 ? "+" : "") + formatVND(d * c.avg)}</TableCell>
                </TableRow>
              );
            })}
          </TableBody>
          <TableFooter>
            <TableRow>
              <TableCell colSpan={4} className="text-right text-xs text-muted-foreground">Tổng lệch (₫)</TableCell>
              <TableCell className={`text-right font-mono font-semibold ${totalDelta === 0 ? "text-muted-foreground" : totalDelta > 0 ? "text-success" : "text-destructive"}`}>
                {(totalDelta > 0 ? "+" : "") + formatVND(totalDelta)}
              </TableCell>
            </TableRow>
          </TableFooter>
        </Table>
      </div>
    </Card>
  );
}
