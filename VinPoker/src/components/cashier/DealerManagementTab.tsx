import { useState, useMemo } from "react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Badge } from "@/components/ui/badge";
import { ScrollArea } from "@/components/ui/scroll-area";
import { Plus, Search, X, Pencil } from "lucide-react";
import { useAllDealers, useDealerScores, type DealerRecord, type DealerScore } from "@/hooks/useDealerManagement";
import AddDealerDialog from "./AddDealerDialog";
import DealerAdjustDialog from "./DealerAdjustDialog";

interface DealerManagementTabProps {
  clubIds: string[];
  clubFilter: string | null;
}

type FilterMode = "all" | "full_time" | "part_time" | "A" | "B" | "C";

export default function DealerManagementTab({ clubIds, clubFilter }: DealerManagementTabProps) {
  const activeClubId = clubFilter ?? clubIds[0] ?? "";
  const { data: dealers, loading: dealersLoading } = useAllDealers(clubIds);
  const { data: scores, loading: scoresLoading } = useDealerScores(activeClubId);
  const [filterMode, setFilterMode] = useState<FilterMode>("all");
  const [searchQuery, setSearchQuery] = useState("");
  const [addDialogOpen, setAddDialogOpen] = useState(false);
  const [selectedDealer, setSelectedDealer] = useState<string | null>(null);
  const [adjustDealer, setAdjustDealer] = useState<DealerRecord | null>(null);

  // Build a map of dealer_id → score
  const scoreMap = useMemo(() => {
    const map = new Map<string, DealerScore>();
    for (const s of scores) map.set(s.dealer_id, s);
    return map;
  }, [scores]);

  // Filter + search
  const filtered = useMemo(() => {
    let list = dealers;

    if (filterMode === "full_time") {
      list = list.filter((d) => d.employment_type === "full_time");
    } else if (filterMode === "part_time") {
      list = list.filter((d) => d.employment_type === "part_time");
    } else if (filterMode === "A" || filterMode === "B" || filterMode === "C") {
      list = list.filter((d) => d.tier === filterMode);
    }

    if (searchQuery.trim()) {
      const q = searchQuery.trim().toLowerCase();
      list = list.filter((d) => d.full_name.toLowerCase().includes(q));
    }

    // Sort by score desc (name asc as tiebreaker)
    return [...list].sort((a, b) => {
      const sa = scoreMap.get(a.id)?.score ?? 0;
      const sb = scoreMap.get(b.id)?.score ?? 0;
      if (sb !== sa) return sb - sa;
      return a.full_name.localeCompare(b.full_name);
    });
  }, [dealers, filterMode, searchQuery, scoreMap]);

  const loading = dealersLoading || scoresLoading;

  // ── Sub-component: dealer detail panel ─────────────────────────────────
  const SelectedDetail = () => {
    if (!selectedDealer) return null;
    const dealer = dealers.find((d) => d.id === selectedDealer);
    const score = scoreMap.get(selectedDealer);
    if (!dealer) return null;

    return (
      <div className="mt-4 p-4 rounded-lg bg-zinc-900 border border-zinc-800">
        <div className="flex items-center justify-between mb-3">
          <h3 className="text-base font-semibold text-white">{dealer.full_name}</h3>
          <Button
            variant="ghost"
            size="sm"
            onClick={() => setSelectedDealer(null)}
            className="text-zinc-400 hover:text-white"
          >
            <X className="h-4 w-4" />
          </Button>
        </div>
        <div className="grid grid-cols-2 gap-3 text-sm">
          <div>
            <span className="text-zinc-500">Hạng:</span>{" "}
            <span className="text-white">{dealer.tier}</span>
          </div>
          <div>
            <span className="text-zinc-500">Loại:</span>{" "}
            <span className="text-white">
              {dealer.employment_type === "part_time" ? "Part-time" : "Full-time"}
            </span>
          </div>
          {dealer.employment_type === "part_time" ? (
            dealer.hourly_rate_vnd != null && (
              <div>
                <span className="text-zinc-500">Lương giờ:</span>{" "}
                <span className="text-white">{dealer.hourly_rate_vnd.toLocaleString("vi-VN")} VND/h</span>
              </div>
            )
          ) : (
            <>
              {dealer.monthly_salary_vnd != null && dealer.monthly_salary_vnd > 0 && (
                <div>
                  <span className="text-zinc-500">Lương tháng:</span>{" "}
                  <span className="text-emerald-400 font-semibold">{dealer.monthly_salary_vnd.toLocaleString("vi-VN")} VND</span>
                </div>
              )}
              {dealer.hourly_rate_vnd != null && (
                <div>
                  <span className="text-zinc-500">Lương giờ:</span>{" "}
                  <span className="text-white">{dealer.hourly_rate_vnd.toLocaleString("vi-VN")} VND/h</span>
                </div>
              )}
              <div>
                <span className="text-zinc-500">Giờ chuẩn/ca:</span>{" "}
                <span className="text-white">{dealer.standard_hours_per_shift ?? 8}h</span>
              </div>
              <div>
                <span className="text-zinc-500">OT:</span>{" "}
                <span className="text-white">×{dealer.ot_multiplier ?? 1.5}</span>
              </div>
            </>
          )}
          {score && (
            <>
              <div>
                <span className="text-zinc-500">Điểm:</span>{" "}
                <span className="text-emerald-400 font-semibold">{score.score.toFixed(1)}</span>
              </div>
              <div>
                <span className="text-zinc-500">Giờ làm (30 ngày):</span>{" "}
                <span className="text-white">{score.total_hours.toFixed(1)}h</span>
              </div>
              <div>
                <span className="text-zinc-500">Số swing:</span>{" "}
                <span className="text-white">{score.total_swings}</span>
              </div>
            </>
          )}
          {dealer.phone && (
            <div>
              <span className="text-zinc-500">SĐT:</span>{" "}
              <span className="text-white">{dealer.phone}</span>
            </div>
          )}
          {dealer.notes && (
            <div className="col-span-2">
              <span className="text-zinc-500">Ghi chú:</span>{" "}
              <span className="text-white text-sm">{dealer.notes}</span>
            </div>
          )}
        </div>
      </div>
    );
  };

  // ── Filter buttons ─────────────────────────────────────────────────────
  const filters: { key: FilterMode; label: string }[] = [
    { key: "all", label: "Tất cả" },
    { key: "full_time", label: "Full-time" },
    { key: "part_time", label: "Part-time" },
    { key: "A", label: "Hạng A" },
    { key: "B", label: "Hạng B" },
    { key: "C", label: "Hạng C" },
  ];

  return (
    <div className="h-full flex flex-col">
      {/* Toolbar */}
      <div className="flex items-center gap-2 mb-3 flex-wrap">
        {filters.map((f) => (
          <button
            key={f.key}
            onClick={() => setFilterMode(f.key)}
            className={`px-3 py-1 text-xs rounded-full transition-colors ${
              filterMode === f.key
                ? "bg-emerald-600 text-white"
                : "bg-zinc-800 text-zinc-400 hover:text-white hover:bg-zinc-700"
            }`}
          >
            {f.label}
          </button>
        ))}
        <div className="flex-1" />
        <div className="relative w-48">
          <Search className="absolute left-2 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-zinc-500" />
          <Input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Tìm dealer..."
            className="pl-7 h-8 text-xs bg-zinc-900 border-zinc-800 text-white"
          />
        </div>
        <Button
          size="sm"
          onClick={() => setAddDialogOpen(true)}
          className="bg-emerald-600 hover:bg-emerald-500 text-white h-8 text-xs"
        >
          <Plus className="h-3.5 w-3.5 mr-1" />
          Thêm dealer
        </Button>
      </div>

      {/* Table */}
      <ScrollArea className="flex-1">
        {loading && filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
            Đang tải...
          </div>
        ) : filtered.length === 0 ? (
          <div className="flex items-center justify-center h-32 text-zinc-500 text-sm">
            Không có dealer
          </div>
        ) : (
          <div className="space-y-1">
            {/* Header */}
            <div className="grid grid-cols-12 gap-2 px-3 py-2 text-xs text-zinc-500 font-medium">
              <div className="col-span-1 text-center">#</div>
              <div className="col-span-3">Tên</div>
              <div className="col-span-1">Hạng</div>
              <div className="col-span-1">Loại</div>
              <div className="col-span-2 text-right">Giờ</div>
              <div className="col-span-2 text-right">Lương</div>
              <div className="col-span-1 text-right">Điểm</div>
              <div className="col-span-1 text-center">Sửa</div>
            </div>
            {/* Rows */}
            {filtered.map((dealer, idx) => {
              const score = scoreMap.get(dealer.id);
              const rank = idx + 1;
              const isSelected = selectedDealer === dealer.id;
              const monthlyPay = dealer.employment_type === "part_time"
                ? (score ? Math.round(score.total_hours * (dealer.hourly_rate_vnd ?? 0)) : null)
                : dealer.monthly_salary_vnd ?? dealer.base_rate_vnd;
              return (
                <button
                  key={dealer.id}
                  onClick={() => setSelectedDealer(isSelected ? null : dealer.id)}
                  className={`w-full grid grid-cols-12 gap-2 px-3 py-2 text-sm rounded transition-colors text-left ${
                    isSelected
                      ? "bg-emerald-600/10 border border-emerald-600/30"
                      : "hover:bg-zinc-800/50 border border-transparent"
                  }`}
                >
                  <div className="col-span-1 text-center text-zinc-500">
                    {rank <= 3 ? (
                      <span
                        className={
                          rank === 1
                            ? "text-yellow-400 font-bold"
                            : rank === 2
                            ? "text-zinc-300 font-bold"
                            : "text-amber-600 font-bold"
                        }
                      >
                        {rank}
                      </span>
                    ) : (
                      rank
                    )}
                  </div>
                  <div className="col-span-3 text-white truncate">
                    {dealer.full_name}
                  </div>
                  <div className="col-span-1">
                    <Badge
                      variant="outline"
                      className={`text-xs ${
                        dealer.tier === "A"
                          ? "border-red-500 text-red-400"
                          : dealer.tier === "B"
                          ? "border-blue-500 text-blue-400"
                          : "border-zinc-500 text-zinc-400"
                      }`}
                    >
                      {dealer.tier}
                    </Badge>
                  </div>
                  <div className="col-span-1 text-zinc-300">
                    {dealer.employment_type === "part_time" ? (
                      <span className="text-amber-400">PT</span>
                    ) : (
                      <span className="text-emerald-400">FT</span>
                    )}
                  </div>
                  <div className="col-span-2 text-right text-zinc-300">
                    {score ? `${score.total_hours.toFixed(1)}h` : "—"}
                  </div>
                  <div className="col-span-2 text-right text-emerald-400 text-xs">
                    {monthlyPay ? `${(monthlyPay / 1000000).toFixed(1)}M` : "—"}
                  </div>
                  <div className="col-span-1 text-right">
                    {score ? (
                      <span className={rank <= 3 ? "text-emerald-400 font-semibold" : "text-zinc-300"}>
                        {score.score.toFixed(1)}
                      </span>
                    ) : (
                      <span className="text-zinc-500">—</span>
                    )}
                  </div>
                  <div className="col-span-1 text-center">
                    <button
                      onClick={(e) => { e.stopPropagation(); setAdjustDealer(dealer); }}
                      className="inline-flex items-center justify-center w-6 h-6 rounded hover:bg-zinc-700 text-zinc-400 hover:text-white transition-colors"
                      title="Điều chỉnh"
                    >
                      <Pencil className="w-3.5 h-3.5" />
                    </button>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </ScrollArea>

      {/* Detail panel */}
      <SelectedDetail />

      {/* Add dealer dialog */}
      <AddDealerDialog
        open={addDialogOpen}
        onOpenChange={setAddDialogOpen}
        clubId={activeClubId}
        onDealerAdded={() => {
          // Refetch is automatic via polling
        }}
      />
      {/* Adjust dealer dialog — always mounted, controlled by open prop */}
      <DealerAdjustDialog
        dealer={adjustDealer}
        open={!!adjustDealer}
        onClose={() => setAdjustDealer(null)}
        onSaved={() => {
          setAdjustDealer(null);
          // Refetch is automatic via polling
        }}
      />
    </div>
  );
}
