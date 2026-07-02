import { useMemo } from "react";
import { useNavigate } from "react-router-dom";
import { Database, Inbox, WifiOff, FlaskConical } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { useNativeSeriesEvents } from "@/lib/series-intelligence/useNativeSeriesEvents";
import { FEATURES } from "@/lib/featureFlags";
import {
  computeContributionByType,
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
import { computeGtdOverlay, resolveOverlay } from "@/lib/series-intelligence/gtdOverlay";
import { useGtdTruePrizePool } from "@/lib/series-intelligence/useGtdTruePrizePool";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import { OverviewCards, type OverlayCostSummary } from "./OverviewCards";
import { ContributionByTypeCard } from "./ContributionByTypeCard";
import { DataQualityCard } from "./DataQualityCard";
import { EconomicsTable } from "./EconomicsTable";
import { RiskInsightCards } from "./RiskInsightCards";
import { ScenarioOutlook } from "./ScenarioOutlook";
import { GtdOverlayCard } from "./GtdOverlayCard";
import { OwnerActionChecklist } from "./OwnerActionChecklist";

/** Stable empty array so the true-prize hook key stays constant in CSV mode. */
const EMPTY_EVENTS: SeriesEvent[] = [];

/**
 * Owner Command Center (Phase 9 / Series Intelligence). Reads the live native
 * series events (read-only RPC via the hook), derives descriptive BI summaries,
 * and renders them. BI only — "what happened / is happening", never prediction.
 *
 * When `csvEvents` is provided, it renders the same dashboard over uploaded CSV test data
 * (browser-only, never the DB) with a "dữ liệu test" banner.
 */
export function OwnerCommandCenter({ csvEvents }: { csvEvents?: SeriesEvent[] | null } = {}) {
  const native = useNativeSeriesEvents();
  const isCsv = csvEvents != null;
  const events = isCsv ? csvEvents : native.events;
  // GTD #2 — server-authoritative true prize pool per GTD event (live native only; CSV test data
  // has no DB-confirmed entries, so it falls back to the #415 estimate path).
  const truePrizeByEvent = useGtdTruePrizePool(isCsv ? EMPTY_EVENTS : events);

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
      gtdOverlay: computeGtdOverlay(events),
      actions: computeOwnerActionChecklist(events, risks),
      contributionByType: FEATURES.seriesMarginByType ? computeContributionByType(events) : null,
    };
  }, [events]);

  // Overlay COST totals for the overview tiles, split by source (thực thu vs ước tính — never summed
  // together). Sums the same per-row resolution GtdOverlayCard already shows; descriptive only.
  const overlayCost = useMemo<OverlayCostSummary | null>(() => {
    if (!view || !view.gtdOverlay.available) return null;
    const sum: OverlayCostSummary = { observed: 0, observedRows: 0, estimated: 0, estimatedRows: 0 };
    for (const row of view.gtdOverlay.rows) {
      const r = resolveOverlay(row, truePrizeByEvent?.get(row.event_id) ?? null);
      if (r.overlay === null) continue;
      if (r.source === "true") {
        sum.observed += r.overlay;
        sum.observedRows += 1;
      } else {
        sum.estimated += r.overlay;
        sum.estimatedRows += 1;
      }
    }
    return sum.observedRows + sum.estimatedRows > 0 ? sum : null;
  }, [view, truePrizeByEvent]);

  if (!isCsv && native.status === "loading") return <LoadingState />;
  if (!isCsv && native.status === "unavailable") return <UnavailableState reason={native.reason} />;
  if (!view) return <EmptyState />;

  return (
    <div className="space-y-4">
      {isCsv && (
        <Card className="p-3 border-warning/50 bg-warning/10 flex items-start gap-2 text-xs">
          <FlaskConical className="w-4 h-4 text-warning shrink-0" />
          <span>
            <strong>Dữ liệu test (CSV)</strong> — {events.length} sự kiện từ file bạn tải lên, chỉ trên trình duyệt.
            Đây KHÔNG phải dữ liệu thật của CLB; bấm “Về dữ liệu live” ở mục CSV bên dưới để quay lại.
          </span>
        </Card>
      )}
      {/* BI pyramid: overview → data quality → economics → risk → scenario → GTD overlay → actions */}
      <section className="space-y-2">
        <h3 className="font-display text-base flex items-center gap-2">
          <Database className="h-4 w-4 text-primary" /> Tổng quan
        </h3>
        <OverviewCards economics={view.economics} overlayCost={overlayCost} />
        <p className="text-[10px] text-muted-foreground/80">
          Prize pool là số ĐÃ NHẬP trong giải, chưa cập nhật tự động từ buy-in — không phải prize pool thực thu.
        </p>
      </section>

      <DataQualityCard readiness={view.readiness} />
      <EconomicsTable rows={view.rows} />
      {view.contributionByType && <ContributionByTypeCard result={view.contributionByType} />}
      <RiskInsightCards risks={view.risks} />
      <ScenarioOutlook outlook={view.scenarios} actions={view.scenarioActions} />
      <GtdOverlayCard overlay={view.gtdOverlay} truePrizeByEvent={truePrizeByEvent} />
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
