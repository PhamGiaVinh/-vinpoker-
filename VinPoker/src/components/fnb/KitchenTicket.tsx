import { useEffect, useState } from "react";
import { toast } from "sonner";
import { Check, Clock } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { mapFnbError } from "@/lib/fnbErrors";
import type { FnbOrder } from "@/hooks/useFnbOrders";

const ageMins = (paidAt: string | null): number =>
  paidAt ? Math.max(0, Math.floor((Date.now() - new Date(paidAt).getTime()) / 60000)) : 0;

/**
 * One PAID order on the Kitchen Display (F6). Shows table/customer + an age timer (colour escalates
 * the older it gets so the kitchen prioritises) + the line list. "✓ Xong" ships one line; "Tất cả
 * xong" ships the whole order via `fnb_mark_shipped` (live, mig …0003). Realtime refetch is the source
 * of truth — when every line ships the order flips to `shipped` and drops off the board.
 */
export function KitchenTicket({ order, onChanged }: { order: FnbOrder; onChanged: () => void }) {
  const [busy, setBusy] = useState(false);
  const [, setTick] = useState(0);
  useEffect(() => { const t = setInterval(() => setTick((x) => x + 1), 30000); return () => clearInterval(t); }, []);

  const ship = async (lineId: string | null) => {
    setBusy(true);
    const { data, error } = await (supabase.rpc as any)("fnb_mark_shipped", { p_order_id: order.id, p_line_id: lineId });
    setBusy(false);
    const res = data as any;
    if (error || res?.error) { toast.error(mapFnbError(res?.error ?? error)); return; }
    onChanged();
  };

  const mins = ageMins(order.paid_at);
  const ageColor = mins >= 15 ? "text-destructive" : mins >= 8 ? "text-warning" : "text-muted-foreground";
  const hasUnshipped = order.items.some((i) => i.line_status !== "shipped");

  return (
    <div className="flex flex-col gap-[1vmin] rounded-[1.4vmin] border border-border bg-card p-[1.6vmin]">
      <div className="flex items-center justify-between gap-[1vmin]">
        <div className="text-[2.4vmin] font-bold leading-none text-foreground">{order.table_label || "Khách lẻ"}</div>
        <div className={`flex items-center gap-[0.5vmin] text-[1.8vmin] tabular-nums ${ageColor}`}>
          <Clock className="h-[1.8vmin] w-[1.8vmin]" /> {mins}′
        </div>
      </div>
      {order.customer_name ? <div className="text-[1.6vmin] text-muted-foreground">{order.customer_name}</div> : null}

      <div className="flex flex-col gap-[0.7vmin]">
        {order.items.map((it) => {
          const shipped = it.line_status === "shipped";
          return (
            <div key={it.id} className="flex items-center justify-between gap-[1vmin]">
              <div className={`text-[2vmin] ${shipped ? "text-muted-foreground/50 line-through" : "text-foreground"}`}>
                <span className="font-bold tabular-nums">{it.qty}×</span> {it.name_snapshot}
              </div>
              {shipped ? (
                <Check className="h-[2vmin] w-[2vmin] shrink-0 text-success/60" />
              ) : (
                <button
                  type="button"
                  disabled={busy}
                  onClick={() => ship(it.id)}
                  className="flex shrink-0 items-center gap-[0.4vmin] rounded-[0.8vmin] border border-success/50 px-[1.1vmin] py-[0.5vmin] text-[1.6vmin] font-semibold text-success transition-colors hover:bg-success/15 disabled:opacity-50"
                >
                  <Check className="h-[1.6vmin] w-[1.6vmin]" /> Xong
                </button>
              )}
            </div>
          );
        })}
      </div>

      {hasUnshipped ? (
        <button
          type="button"
          disabled={busy}
          onClick={() => ship(null)}
          className="mt-[0.4vmin] rounded-[0.9vmin] bg-success/15 py-[0.9vmin] text-[1.8vmin] font-semibold text-success transition-colors hover:bg-success/25 disabled:opacity-50"
        >
          Tất cả xong
        </button>
      ) : null}
    </div>
  );
}
