import { useEffect, useMemo, useState } from "react";
import { SlidersHorizontal, Search } from "lucide-react";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import { shiftWindowLabel } from "../shift-planner/ShiftPlanner.utils";
import { validateFinalDesignations } from "@/lib/shiftPlanner";
import type { AvailabilityRequest, SchedulerDealer, ShiftTemplate } from "@/types/shiftPlanner";

/**
 * V2 per-day demand editor ("✎ Sửa nhu cầu") — the floor adjusts how many
 * dealers each window needs FOR THIS DAY ONLY, and (Patch 2) pins which dealers
 * "chia final" for a window that has a final table. Both live in component
 * state, feed the local re-solve / run params, and are persisted into
 * dealer_schedule_runs.params on save — templates themselves never change.
 *
 * Pins are per-day designations (set the night before). A pinned dealer who is
 * off shows a warning but stays selectable — enforcement (SHORTAGE_FINAL) is
 * the Patch-3 solver's job. Over-cap or unknown (deleted/inactive) dealers
 * BLOCK Apply so invalid pins can never reach the saved params.
 */
export function DemandDialog({
  open,
  onOpenChange,
  templates,
  overrides,
  dealers,
  availability,
  finalDesignations,
  tourCount,
  onApply,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  templates: ShiftTemplate[];
  overrides: Record<string, number>;
  dealers: SchedulerDealer[];
  availability: AvailabilityRequest[];
  /** Current per-template "chia final" pins (hydrated from saved run params). */
  finalDesignations: Record<string, string[]>;
  /** Tournaments on this day (context line), if known. */
  tourCount: number | null;
  onApply: (next: { demand: Record<string, number>; final: Record<string, string[]> }) => void;
}) {
  const [draft, setDraft] = useState<Record<string, string>>({});
  const [finalDraft, setFinalDraft] = useState<Record<string, string[]>>({});
  const [finalOpen, setFinalOpen] = useState<Record<string, boolean>>({});
  const [search, setSearch] = useState<Record<string, string>>({});

  useEffect(() => {
    if (!open) return;
    const init: Record<string, string> = {};
    const fOpen: Record<string, boolean> = {};
    for (const t of templates) {
      init[t.id] = String(overrides[t.id] ?? t.needCount);
      fOpen[t.id] = (finalDesignations[t.id]?.length ?? 0) > 0;
    }
    setDraft(init);
    setFinalDraft({ ...finalDesignations });
    setFinalOpen(fOpen);
    setSearch({});
  }, [open, templates, overrides, finalDesignations]);

  const activeDealers = useMemo(() => dealers.filter((d) => d.status === "active"), [dealers]);
  const activeIds = useMemo(() => new Set(activeDealers.map((d) => d.id)), [activeDealers]);
  const dealerById = useMemo(() => new Map(dealers.map((d) => [d.id, d])), [dealers]);
  const availByDealer = useMemo(() => new Map(availability.map((a) => [a.dealerId, a])), [availability]);

  /** Effective need per template while editing (falls back to template default). */
  const needByTemplate = useMemo(() => {
    const m: Record<string, number> = {};
    for (const t of templates) {
      const n = Number.parseInt(draft[t.id] ?? "", 10);
      m[t.id] = Number.isFinite(n) ? Math.max(0, Math.min(50, n)) : t.needCount;
    }
    return m;
  }, [templates, draft]);

  const offIds = useMemo(
    () => new Set(availability.filter((a) => a.leaveRequested).map((a) => a.dealerId)),
    [availability]
  );

  /** Only checked windows count — unchecking "Có bàn final" clears the pins. */
  const effectiveFinal = useMemo(() => {
    const m: Record<string, string[]> = {};
    for (const [tid, ids] of Object.entries(finalDraft)) {
      if (finalOpen[tid] && ids.length > 0) m[tid] = ids;
    }
    return m;
  }, [finalDraft, finalOpen]);

  const issues = useMemo(
    () => validateFinalDesignations(effectiveFinal, needByTemplate, offIds, activeIds),
    [effectiveFinal, needByTemplate, offIds, activeIds]
  );
  const blockers = issues.filter((i) => i.kind === "over_cap" || i.kind === "unknown_dealer");

  const togglePin = (templateId: string, dealerId: string) => {
    setFinalDraft((p) => {
      const cur = p[templateId] ?? [];
      return {
        ...p,
        [templateId]: cur.includes(dealerId) ? cur.filter((id) => id !== dealerId) : [...cur, dealerId],
      };
    });
  };

  const apply = () => {
    if (blockers.length > 0) return; // button is disabled; belt-and-braces
    const demand: Record<string, number> = {};
    for (const t of templates) {
      const n = Math.max(0, Math.min(50, Number.parseInt(draft[t.id] ?? "", 10)));
      if (Number.isFinite(n) && n !== t.needCount) demand[t.id] = n;
    }
    onApply({ demand, final: effectiveFinal });
    onOpenChange(false);
  };

  const isDealerOffFor = (templateId: string, dealerId: string): boolean => {
    const a = availByDealer.get(dealerId);
    if (!a) return false;
    return a.leaveRequested === true || a.unavailableTemplateIds.includes(templateId);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[85vh] overflow-y-auto">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <SlidersHorizontal className="w-4 h-4 text-primary" /> Nhu cầu dealer hôm nay
          </DialogTitle>
          <DialogDescription>
            {tourCount != null ? `${tourCount} tour trong ngày — ` : ""}
            chỉnh số dealer cần cho TỪNG khung ca của riêng ngày này (không đổi khung ca gốc).
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {templates.map((t) => {
            const need = needByTemplate[t.id] ?? t.needCount;
            const pinned = finalDraft[t.id] ?? [];
            const atCap = pinned.length >= need;
            const overCap = finalOpen[t.id] && pinned.length > need;
            const q = (search[t.id] ?? "").trim().toLowerCase();
            const listed = q
              ? activeDealers.filter((d) => d.fullName.toLowerCase().includes(q))
              : activeDealers;
            // Pins that no longer resolve to an ACTIVE dealer (deleted or inactive):
            // shown in red, never silently dropped — the floor unpins them explicitly.
            const stalePinned = pinned.filter((id) => !activeIds.has(id));
            return (
              <div key={t.id} className="rounded-lg border border-border p-2.5">
                <div className="flex items-center gap-3">
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{t.label}</div>
                    <div className="text-[11px] text-muted-foreground">
                      {shiftWindowLabel(t)} · mặc định {t.needCount}
                    </div>
                  </div>
                  <Input
                    type="number"
                    min={0}
                    max={50}
                    className="h-8 w-20 text-center"
                    value={draft[t.id] ?? ""}
                    onChange={(e) => setDraft((p) => ({ ...p, [t.id]: e.target.value }))}
                  />
                </div>

                {/* ── Chia final (per-day designation) ── */}
                <label className="mt-2 flex cursor-pointer items-center gap-2 text-[12px]">
                  <Checkbox
                    checked={finalOpen[t.id] ?? false}
                    onCheckedChange={(v) => {
                      const on = v === true;
                      setFinalOpen((p) => ({ ...p, [t.id]: on }));
                      if (!on) setFinalDraft((p) => ({ ...p, [t.id]: [] }));
                    }}
                  />
                  <span>Có bàn final / bàn tâm điểm</span>
                </label>

                {finalOpen[t.id] && (
                  <div className="mt-2 space-y-1.5">
                    <div className="flex items-center justify-between gap-2">
                      <div className="text-[11.5px] font-semibold text-primary">📌 Chỉ định dealer chia final</div>
                      <span className={overCap ? "text-[11px] font-semibold text-destructive" : "text-[11px] text-muted-foreground"}>
                        Đã chọn {pinned.length}/{need}
                      </span>
                    </div>
                    <div className="relative">
                      <Search className="pointer-events-none absolute left-2 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-muted-foreground" />
                      <Input
                        className="h-8 pl-7 text-[12px]"
                        placeholder="Tìm tên dealer…"
                        value={search[t.id] ?? ""}
                        onChange={(e) => setSearch((p) => ({ ...p, [t.id]: e.target.value }))}
                      />
                    </div>
                    {/* Stale pins first — red, unpin-only */}
                    {stalePinned.map((id) => (
                      <label key={id} className="flex cursor-pointer items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 px-2 py-1.5 text-[12px]">
                        <Checkbox checked onCheckedChange={() => togglePin(t.id, id)} />
                        <span className="min-w-0 flex-1 truncate text-destructive">
                          {dealerById.get(id)?.fullName ?? id}
                          {" — "}
                          {dealerById.has(id) ? "không còn hoạt động" : "không còn tồn tại"}
                        </span>
                      </label>
                    ))}
                    <div className="max-h-40 space-y-0.5 overflow-y-auto rounded-md border border-border p-1">
                      {listed.map((d) => {
                        const checked = pinned.includes(d.id);
                        const off = isDealerOffFor(t.id, d.id);
                        const disabled = !checked && atCap;
                        return (
                          <label
                            key={d.id}
                            className={`flex items-center gap-2 rounded px-1.5 py-1 text-[12px] ${
                              disabled ? "cursor-not-allowed opacity-45" : "cursor-pointer hover:bg-muted"
                            }`}
                          >
                            <Checkbox checked={checked} disabled={disabled} onCheckedChange={() => togglePin(t.id, d.id)} />
                            <span className="min-w-0 flex-1 truncate">{d.fullName}</span>
                            {off && (
                              <span className="shrink-0 rounded-full border border-warning/40 bg-warning/10 px-1.5 py-0.5 text-[10px] text-warning">
                                Đang xin nghỉ
                              </span>
                            )}
                          </label>
                        );
                      })}
                      {listed.length === 0 && (
                        <div className="py-2 text-center text-[11px] text-muted-foreground">Không tìm thấy dealer</div>
                      )}
                    </div>
                    {pinned.some((id) => isDealerOffFor(t.id, id)) && (
                      <p className="text-[11px] text-warning">
                        Có dealer đang xin nghỉ trong danh sách chỉ định — vẫn có thể chỉ định; bước tự động xếp sẽ cảnh báo.
                      </p>
                    )}
                    {overCap && (
                      <p className="text-[11px] font-semibold text-destructive">
                        Đang chọn {pinned.length} dealer chia final nhưng khung này chỉ cần {need} người. Hãy bỏ bớt dealer
                        hoặc tăng số cần.
                      </p>
                    )}
                  </div>
                )}
              </div>
            );
          })}
          {templates.length === 0 && (
            <div className="py-3 text-center text-[12px] text-muted-foreground">
              Chưa có khung ca — tạo ở "Quản lý ca".
            </div>
          )}
        </div>

        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>Huỷ</Button>
          <Button onClick={apply} disabled={blockers.length > 0}>Áp dụng cho ngày này</Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
