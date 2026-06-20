import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Database, Inbox, WifiOff } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import {
  computeEconomicsSummary,
  computeOwnerActionChecklist,
  computeReadiness,
  computeRiskFlags,
  toEventEconomicsRows,
} from "@/lib/series-intelligence/commandCenter";
import {
  computeScenarioActions,
  computeScenarioOutlook,
} from "@/lib/series-intelligence/scenarioOutlook";
import { OverviewCards } from "./OverviewCards";
import { DataQualityCard } from "./DataQualityCard";
import { EconomicsTable } from "./EconomicsTable";
import { RiskInsightCards } from "./RiskInsightCards";
import { ScenarioOutlook } from "./ScenarioOutlook";
import { OwnerActionChecklist } from "./OwnerActionChecklist";

/**
 * Owner Command Center (Phase 9 / Series Intelligence). Reads the live native
 * series events (read-only RPC via the hook), derives descriptive BI summaries,
 * and renders them. BI only — "what happened / is happening", never prediction.
 */
export function OwnerCommandCenter() {
  const native = useNativeSeriesEvents();
  const events = native.events;

  const view = useMemo(() => {
    if (events.length === 0) return null;
    const economics = computeEconomicsSummary(events);
    const readiness = computeReadiness(events);
    const risks = computeRiskFlags(events);
    const scenarios = computeScenarioOutlook(events, economics, readiness, risks);
    return {
      economics,
      readiness,
      rows: toEventEconomicsRows(events),
      risks,
      scenarios,
      scenarioActions: computeScenarioActions(scenarios.scenarios, risks),
      actions: computeOwnerActionChecklist(events, risks),
    };
  }, [events]);

  if (native.status === "loading") return <LoadingState />;
  if (native.status === "unavailable") return <UnavailableState reason={native.reason} />;
  if (!view) return <EmptyState />;

  return (
    <div className="space-y-4">
      {/* BI pyramid: overview → data quality → economics → risk → scenario → actions */}
      <section className="space-y-2">
        <h3 className="font-display text-base flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" /> Tổng quan
        </h3>
        <OverviewCards economics={view.economics} />
        <p className="text-[10px] text-muted-foreground/80">
          Prize pool là số ĐÃ NHẬP trong giải, chưa cập nhật tự động từ buy-in — không phải prize pool thực thu.
        </p>
      </section>

      <DataQualityCard readiness={view.readiness} />
      <EconomicsTable rows={view.rows} />
      <RiskInsightCards risks={view.risks} />
      <ScenarioOutlook outlook={view.scenarios} actions={view.scenarioActions} />
      <OwnerActionChecklist actions={view.actions} />
    </div>
  );
}

function LoadingState() {
  return (
    <div className="space-y-2" aria-busy>
      <div className="grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {Array.from({ length: 4 }).map((_, i) => (
          <Card key={i} className="h-[72px] animate-pulse bg-muted/40 border-primary/20" />
        ))}
      </div>
      <p className="text-xs text-muted-foreground">Đang đọc dữ liệu series từ VinPoker…</p>
    </div>
  );
}

function UnavailableState({ reason }: { reason: string | null }) {
  return (
    <Card className="p-5 border-warning/40 gradient-card flex items-start gap-3">
      <WifiOff className="h-5 w-5 shrink-0 text-warning" aria-hidden />
      <div className="space-y-1">
        <div className="font-display text-base">Chưa đọc được dữ liệu</div>
        <p className="text-xs text-muted-foreground">
          Hãy thử tải lại trang. Nếu vẫn lỗi, kiểm tra quyền truy cập CLB.
          {reason ? <span className="text-muted-foreground/70"> ({reason})</span> : null}
        </p>
      </div>
    </Card>
  );
}

/** Carbon-DS style empty state: icon + title + description + a clear next action. */
function EmptyState() {
  const nav = useNavigate();
  return (
    <Card className="p-8 gradient-card border-primary/30 flex flex-col items-center text-center gap-3">
      <div className="grid place-items-center w-14 h-14 rounded-full bg-primary/10">
        <Inbox className="h-7 w-7 text-primary" aria-hidden />
      </div>
      <div className="space-y-1">
        <h3 className="font-display text-lg">Chưa có giải đấu nào</h3>
        <p className="max-w-sm text-sm text-muted-foreground">
          Khi CLB của bạn chạy giải, các số liệu tổng quan, kinh tế và rủi ro của series sẽ hiển thị ở đây.
        </p>
      </div>
      <Button onClick={() => nav("/floor")} className="gap-2">
        Tạo / quản lý giải đấu
      </Button>
    </Card>
  );
}
