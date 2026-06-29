import { useState } from "react";
import { Navigate } from "react-router-dom";
import { RefreshCw, UtensilsCrossed } from "lucide-react";
import { FEATURES } from "@/lib/featureFlags";
import { TvChrome } from "@/components/tv/TvChrome";
import { useFnbClubs } from "@/hooks/useFnbClubs";
import { useFnbKitchen } from "@/hooks/useFnbKitchen";
import { KitchenTicket } from "@/components/fnb/KitchenTicket";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";

/**
 * F&B Kitchen Display (F6) — live PAID tickets, full-screen kiosk (chrome-less, like /tv).
 * Self-gates on fnbModule + fnbKitchen. Backend already live: `fnb_mark_shipped` + the
 * `fnb_orders`/`fnb_order_items` realtime publication. The board shows PAID-not-yet-shipped orders
 * FIFO; tapping done ships lines and the order drops off when fully shipped (via realtime).
 */
export default function FnbKitchenDisplay() {
  const { loading, clubs } = useFnbClubs();
  const [clubId, setClubId] = useState<string>("");
  const activeClub = clubId || clubs?.[0]?.id || undefined;
  const { data: orders, isLoading: ordersLoading, refetch } = useFnbKitchen(activeClub);

  // Gate AFTER hooks (rules-of-hooks); FEATURES are module constants so the branch is stable.
  if (!FEATURES.fnbModule || !FEATURES.fnbKitchen) return <Navigate to="/" replace />;

  const tickets = orders ?? [];

  return (
    <TvChrome>
      <div className="flex h-full min-h-screen w-full flex-col gap-[2vmin] px-[3vmin] py-[2vmin]">
        <div className="flex items-center justify-between gap-[2vmin]">
          <div className="flex items-center gap-[1.4vmin]">
            <UtensilsCrossed className="h-[3vmin] w-[3vmin] text-primary" />
            <h1 className="text-[3.2vmin] font-bold leading-none text-foreground">Bếp · Đơn đã thu</h1>
            <span className="rounded-full bg-primary/15 px-[1.4vmin] py-[0.4vmin] text-[1.8vmin] font-semibold tabular-nums text-primary">
              {tickets.length}
            </span>
          </div>
          {clubs && clubs.length > 1 ? (
            <Select value={activeClub ?? ""} onValueChange={setClubId}>
              <SelectTrigger className="w-[28vmin] border-border bg-card text-[1.8vmin] text-foreground">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {clubs.map((c) => <SelectItem key={c.id} value={c.id}>{c.name ?? c.id}</SelectItem>)}
              </SelectContent>
            </Select>
          ) : (
            <div className="text-[1.8vmin] text-muted-foreground">{clubs?.[0]?.name ?? ""}</div>
          )}
        </div>

        {loading || (ordersLoading && tickets.length === 0) ? (
          <div className="flex flex-1 items-center justify-center text-[2.4vmin] text-muted-foreground">
            <RefreshCw className="mr-[1vmin] h-[2.4vmin] w-[2.4vmin] animate-spin" /> Đang tải…
          </div>
        ) : !activeClub ? (
          <div className="flex flex-1 items-center justify-center text-center text-[2.4vmin] text-muted-foreground">
            Bạn chưa được gán vào câu lạc bộ F&amp;B nào.
          </div>
        ) : tickets.length === 0 ? (
          <div className="flex flex-1 flex-col items-center justify-center gap-[1.5vmin] text-muted-foreground">
            <UtensilsCrossed className="h-[8vmin] w-[8vmin] opacity-30" />
            <div className="text-[3vmin] font-semibold">Chưa có đơn nào</div>
            <div className="text-[1.8vmin]">Đơn sẽ tự hiện khi quầy thu tiền.</div>
          </div>
        ) : (
          <div className="grid flex-1 auto-rows-min grid-cols-1 gap-[1.6vmin] overflow-y-auto sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-4">
            {tickets.map((o) => <KitchenTicket key={o.id} order={o} onChanged={() => refetch()} />)}
          </div>
        )}
      </div>
    </TvChrome>
  );
}
