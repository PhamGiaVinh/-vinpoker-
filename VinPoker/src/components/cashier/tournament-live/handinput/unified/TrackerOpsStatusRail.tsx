import {
  Boxes,
  CircleAlert,
  CircleCheck,
  MapPinned,
  RadioTower,
} from "lucide-react";
import type { TrackerTableContextV2 } from "@/lib/tracker-unified-ops/contracts";

type DomainStatus = {
  label: string;
  detail: string;
  tone: "ready" | "warning" | "active";
  icon: typeof MapPinned;
};

const toneClasses: Record<DomainStatus["tone"], string> = {
  ready: "border-emerald-400/30 bg-emerald-400/[0.07] text-emerald-200",
  warning: "border-amber-300/35 bg-amber-300/[0.08] text-amber-100",
  active: "border-[#d7b66f]/40 bg-[#d7b66f]/[0.09] text-[#f1d99e]",
};

export function TrackerOpsStatusRail({
  context,
}: {
  context: TrackerTableContextV2;
}) {
  const floorBlockers = context.readiness.blockers.filter(
    (item) => item.owner === "floor",
  );
  const trackerBlockers = context.readiness.blockers.filter(
    (item) => item.owner === "tracker",
  );
  const chipWarnings = context.readiness.warnings.filter(
    (item) => item.owner === "chipmaster",
  );

  const domains: DomainStatus[] = [
    {
      label: "Floor",
      detail: floorBlockers.length
        ? `${floorBlockers.length} việc cần xử lý`
        : "Roster và stack sẵn sàng",
      tone: floorBlockers.length ? "warning" : "ready",
      icon: MapPinned,
    },
    {
      label: "ChipMaster",
      detail: chipWarnings.length
        ? `${chipWarnings.length} mục cần xem`
        : "Không có cảnh báo chip",
      tone: chipWarnings.length ? "warning" : "ready",
      icon: Boxes,
    },
    {
      label: "Tracker",
      detail: context.active_hand
        ? `Hand #${context.active_hand.hand_number} đang chạy`
        : trackerBlockers.length
          ? "Chưa thể mở hand"
          : `Sẵn sàng Hand #${context.next_hand_number}`,
      tone: context.active_hand ? "active" : trackerBlockers.length ? "warning" : "ready",
      icon: RadioTower,
    },
  ];

  return (
    <section
      aria-label="Trạng thái vận hành"
      className="grid gap-2 md:grid-cols-3"
      data-testid="tracker-ops-status-rail"
    >
      {domains.map((domain) => {
        const Icon = domain.icon;
        const StateIcon = domain.tone === "warning" ? CircleAlert : CircleCheck;
        return (
          <div
            key={domain.label}
            className={`min-h-[76px] rounded-2xl border px-3.5 py-3 ${toneClasses[domain.tone]}`}
          >
            <div className="flex items-center justify-between gap-3">
              <span className="flex items-center gap-2 text-xs font-bold uppercase tracking-[0.16em]">
                <Icon className="h-4 w-4" />
                {domain.label}
              </span>
              <StateIcon className="h-4 w-4 opacity-80" />
            </div>
            <p className="mt-2 text-sm font-medium text-[#f4eee5]">
              {domain.detail}
            </p>
          </div>
        );
      })}
    </section>
  );
}
