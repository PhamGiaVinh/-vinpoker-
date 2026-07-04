import { useState } from "react";
import { toast } from "sonner";
import { Search, Users, CircleUserRound, Wallet, UtensilsCrossed, Boxes, Monitor, ChevronRight } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DealerStatusCard } from "@/components/ops/shared/DealerStatusCard";
import { PlayerLookupCard } from "@/components/ops/shared/PlayerLookupCard";
import { RoleLockedAction } from "@/components/ops/shared/RoleLockedAction";
import { MOCK_DEALERS, MOCK_PLAYERS } from "@/components/ops/mock/opsData";

/**
 * Thêm (mobileOpsV2) — Người chơi (search sheet), Dealer status, link Cashier/F&B/Chip, và link desktop-only
 * (hand-input / Series / Tài chính đầy đủ). DỮ LIỆU MẪU, read-only. docs/design/ios-floor-ux-spec.md §9,12.
 */
export default function OpsMore() {
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  const results = MOCK_PLAYERS.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="space-y-4">
      <h1 className="text-base font-semibold text-foreground">Thêm</h1>

      <button
        onClick={() => setSearch(true)}
        className="flex w-full items-center gap-2 rounded-xl border border-border bg-card px-3 py-3 text-left text-sm text-muted-foreground"
      >
        <Search className="h-4 w-4" /> Tìm người chơi (tên / SĐT)…
      </button>

      <section>
        <h2 className="mb-1.5 flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <CircleUserRound className="h-3.5 w-3.5" /> Dealer
        </h2>
        <div className="divide-y divide-border rounded-xl border border-border bg-card">
          {MOCK_DEALERS.map((d, i) => <DealerStatusCard key={i} d={d} />)}
        </div>
      </section>

      <section className="space-y-2">
        <h2 className="text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">Mở nhanh</h2>
        {[
          { icon: Wallet, label: "Cashier (thu ngân)", badge: "" },
          { icon: UtensilsCrossed, label: "F&B", badge: "5 đơn" },
          { icon: Boxes, label: "Chip Ops", badge: "" },
        ].map((l) => (
          <button
            key={l.label}
            onClick={() => toast(`${l.label} (bản mẫu)`)}
            className="flex w-full items-center gap-3 rounded-xl border border-border bg-card px-3 py-3 text-left text-sm"
          >
            <l.icon className="h-5 w-5 text-primary" />
            <span className="flex-1 text-foreground">{l.label}</span>
            {l.badge && <span className="text-[11px] text-muted-foreground">{l.badge}</span>}
            <ChevronRight className="h-4 w-4 text-muted-foreground" />
          </button>
        ))}
      </section>

      <section className="space-y-2">
        <h2 className="flex items-center gap-1.5 text-[11px] font-semibold uppercase tracking-wide text-muted-foreground">
          <Monitor className="h-3.5 w-3.5" /> Chỉ trên máy tính
        </h2>
        <RoleLockedAction label="Nhập hand (Tracker)" mode="desktopOnly" />
        <RoleLockedAction label="Series Intelligence" mode="desktopOnly" />
        <RoleLockedAction label="Tài chính &amp; Đối soát (đầy đủ)" mode="desktopOnly" />
      </section>

      {/* Người chơi — search sheet */}
      <Sheet open={search} onOpenChange={setSearch}>
        <SheetContent side="bottom" className="rounded-t-2xl">
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2"><Users className="h-4 w-4" /> Tra cứu người chơi</SheetTitle>
          </SheetHeader>
          <div className="mt-3 flex items-center gap-2 rounded-lg border border-border bg-card px-3 py-2">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tên / SĐT…"
              className="flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground"
            />
          </div>
          <div className="mt-3 space-y-2">
            {results.length === 0 ? (
              <div className="py-6 text-center text-sm text-muted-foreground">Không tìm thấy — kiểm tra SĐT.</div>
            ) : (
              results.map((p) => <PlayerLookupCard key={p.name} {...p} />)
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
