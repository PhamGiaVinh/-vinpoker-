import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { toast } from "sonner";
import { Search, Users, Wallet, UtensilsCrossed, Boxes, ChevronRight, Repeat } from "lucide-react";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { DealerStatusCard } from "@/components/ops/shared/DealerStatusCard";
import { PlayerLookupCard } from "@/components/ops/shared/PlayerLookupCard";
import { RoleLockedAction } from "@/components/ops/shared/RoleLockedAction";
import { MOCK_DEALERS, MOCK_PLAYERS } from "@/components/ops/mock/opsData";

/**
 * Thêm (mobileOpsV2) — Người chơi (search sheet), Dealer status, link nhanh, mục desktop-only.
 * Phong cách iOS grouped. DỮ LIỆU MẪU, read-only. docs/design/ios-floor-ux-spec.md §9,12.
 */
const LINKS = [
  { icon: Wallet, label: "Cashier (thu ngân)", badge: "" },
  { icon: UtensilsCrossed, label: "F&B", badge: "5 đơn" },
  { icon: Boxes, label: "Chip Ops", badge: "" },
];

export default function OpsMore() {
  const navigate = useNavigate();
  const [search, setSearch] = useState(false);
  const [q, setQ] = useState("");
  const results = MOCK_PLAYERS.filter((p) => p.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <div className="ios-in space-y-6 pt-2">
      <header className="px-1">
        <h1 className="text-[30px] font-bold leading-tight tracking-[-0.02em] text-[#f2ece6]">Thêm</h1>
      </header>

      <button
        onClick={() => setSearch(true)}
        className="ios-press-sm ios-fill flex w-full items-center gap-2 rounded-2xl px-4 py-3.5 text-left text-[15px] text-[#9b8e97]"
      >
        <Search className="h-[18px] w-[18px]" /> Tìm người chơi (tên / SĐT)…
      </button>

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Dealer</h3>
        <button
          onClick={() => navigate("/ops/dealer-swing")}
          className="ios-press ios-card mb-2 flex w-full items-center gap-3 p-3.5 text-left"
        >
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-[#c9a86a]/14 text-[#d8bc85]"><Repeat className="h-5 w-5" /></span>
          <span className="min-w-0 flex-1"><span className="block text-[15px] font-semibold text-[#f2ece6]">Dealer Swing — xoay ca</span><span className="block text-[12px] text-[#9b8e97]">1 thiếu dealer · 1 bàn OT</span></span>
          <ChevronRight className="h-[18px] w-[18px] text-[#5f545c]" />
        </button>
        <div className="ios-group">
          {MOCK_DEALERS.map((d, i) => <DealerStatusCard key={i} d={d} />)}
        </div>
      </section>

      <section>
        <h3 className="mb-2 px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Mở nhanh</h3>
        <div className="ios-group">
          {LINKS.map((l) => (
            <button
              key={l.label}
              onClick={() => toast(`${l.label} (bản mẫu)`)}
              className="ios-press-sm ios-row-inset flex w-full items-center gap-3 px-4 py-3.5 text-left"
            >
              <l.icon className="h-[20px] w-[20px] text-[#c9a86a]" />
              <span className="flex-1 text-[16px] text-[#f2ece6]">{l.label}</span>
              {l.badge && <span className="text-[13px] text-[#9b8e97]">{l.badge}</span>}
              <ChevronRight className="h-[18px] w-[18px] text-[#5f545c]" />
            </button>
          ))}
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="px-1 text-[13px] font-semibold uppercase tracking-wide text-[#9b8e97]">Chỉ trên máy tính</h3>
        <RoleLockedAction label="Nhập hand (Tracker)" mode="desktopOnly" />
        <RoleLockedAction label="Series Intelligence" mode="desktopOnly" />
        <RoleLockedAction label="Tài chính &amp; Đối soát (đầy đủ)" mode="desktopOnly" />
      </section>

      {/* Người chơi — search sheet */}
      <Sheet open={search} onOpenChange={setSearch}>
        <SheetContent side="bottom" className="rounded-t-[22px] border-none bg-[#0d0913] pb-8">
          <div className="ios-grabber mb-3 mt-1" />
          <SheetHeader className="text-left">
            <SheetTitle className="flex items-center gap-2 text-[#f2ece6]">
              <Users className="h-[18px] w-[18px]" /> Tra cứu người chơi
            </SheetTitle>
          </SheetHeader>
          <div className="ios-fill mt-3 flex items-center gap-2 rounded-2xl px-4 py-3">
            <Search className="h-[18px] w-[18px] text-[#9b8e97]" />
            <input
              autoFocus
              value={q}
              onChange={(e) => setQ(e.target.value)}
              placeholder="Tên / SĐT…"
              className="flex-1 bg-transparent text-[16px] text-[#f2ece6] outline-none placeholder:text-[#7c7079]"
            />
          </div>
          <div className="mt-3 space-y-2.5">
            {results.length === 0 ? (
              <div className="py-8 text-center text-[15px] text-[#9b8e97]">Không tìm thấy — kiểm tra SĐT.</div>
            ) : (
              results.map((p) => <PlayerLookupCard key={p.name} {...p} />)
            )}
          </div>
        </SheetContent>
      </Sheet>
    </div>
  );
}
