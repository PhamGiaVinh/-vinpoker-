import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { formatVND } from "@/lib/format";
import { Loader2, Check } from "lucide-react";

// Minimal shape both the freshly-created order (from OrderEntryPanel) and a pending order (from
// useFnbOrders) satisfy. Parent owns fnb_mark_paid via onConfirm.
export type PayableOrder = {
  id: string;
  table_label: string | null;
  customer_name: string | null;
  subtotal_vnd: number;
  items: { name_snapshot: string; qty: number; unit_price_snapshot: number }[];
};

export function FnbConfirmPaymentDialog({ order, open, onOpenChange, confirming, onConfirm }: {
  order: PayableOrder | null;
  open: boolean;
  onOpenChange: (v: boolean) => void;
  confirming: boolean;
  onConfirm: () => void;
}) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="sm:max-w-md bg-popover border border-border text-foreground">
        <DialogHeader>
          <DialogTitle>Thu tiền (trả trước)</DialogTitle>
          <DialogDescription className="text-muted-foreground">
            Xác nhận đã thu tiền — sau khi thu, đơn trừ kho &amp; xuống bếp.
          </DialogDescription>
        </DialogHeader>

        {order && (
          <div className="space-y-3">
            <div className="flex justify-between text-xs text-muted-foreground">
              <span>{order.table_label ? `Bàn: ${order.table_label}` : "Khách lẻ"}</span>
              <span>{order.customer_name ?? ""}</span>
            </div>
            <div className="space-y-1 max-h-56 overflow-y-auto">
              {order.items.map((it, i) => (
                <div key={i} className="flex justify-between text-sm">
                  <span><span className="font-mono text-muted-foreground mr-1.5">{it.qty}×</span>{it.name_snapshot}</span>
                  <span className="font-mono">{formatVND(it.unit_price_snapshot * it.qty)}</span>
                </div>
              ))}
            </div>
            <div className="border-t border-border pt-2 flex justify-between font-semibold">
              <span>Tổng cộng</span><span className="font-mono">{formatVND(order.subtotal_vnd)}</span>
            </div>
          </div>
        )}

        <div className="flex justify-end gap-3 pt-2">
          <Button variant="outline" className="border-border text-foreground" onClick={() => onOpenChange(false)} disabled={confirming}>
            Để sau
          </Button>
          <Button className="bg-success hover:bg-success/90 text-success-foreground" onClick={onConfirm} disabled={confirming || !order}>
            {confirming ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : <Check className="w-4 h-4 mr-1" />}
            Thu tiền
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
}
