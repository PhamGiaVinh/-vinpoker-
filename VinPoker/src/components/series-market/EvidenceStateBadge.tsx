import { AlertTriangle, Check, CircleSlash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import type { EvidenceState } from "@/lib/series-market/verifiedMarketReadModel";

const CONFIG = {
  resolved: {
    label: "Public Evidence",
    icon: Check,
    className: "border-emerald-500/35 bg-emerald-500/10 text-emerald-300",
  },
  missing: {
    label: "Missing",
    icon: CircleSlash2,
    className: "border-amber-500/35 bg-amber-500/10 text-amber-300",
  },
  conflict: {
    label: "Conflict",
    icon: AlertTriangle,
    className: "border-rose-500/40 bg-rose-500/10 text-rose-300",
  },
} as const;

export function EvidenceStateBadge({ state, compact = false }: { state: EvidenceState; compact?: boolean }) {
  const config = CONFIG[state];
  const Icon = config.icon;
  return (
    <Badge variant="outline" className={`gap-1 whitespace-nowrap ${config.className}`}>
      <Icon className="h-3 w-3" aria-hidden="true" />
      {compact && state === "resolved" ? "Evidence" : config.label}
    </Badge>
  );
}
