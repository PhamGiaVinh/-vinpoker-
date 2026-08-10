import { useEffect, useMemo, useState } from "react";
import {
  Activity,
  BadgeCheck,
  CalendarClock,
  DatabaseZap,
  RefreshCw,
  Table2,
  TicketCheck,
  Trophy,
  UserRoundCheck,
  UsersRound,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Skeleton } from "@/components/ui/skeleton";
import { useOperatorClubs } from "@/hooks/useOperatorClubs";
import { cn } from "@/lib/utils";
import type { SeriesClubLivePulseV1, SeriesClubPulseMetricKey } from "@/lib/series-intelligence/seriesClubLivePulseV1";
import { createSeriesClubPulseDemoV1 } from "@/lib/series-intelligence/seriesClubPulseDemoV1";
import {
  useSeriesClubLivePulseV1,
  type SeriesClubLivePulseLoader,
} from "@/lib/series-intelligence/useSeriesClubLivePulseV1";

const METRICS: readonly {
  key: SeriesClubPulseMetricKey;
  label: string;
  definition: string;
  icon: typeof UsersRound;
}[] = [
  { key: "clubMemberProfiles", label: "Hồ sơ player trong CLB", definition: "Số hồ sơ player hiện gắn với CLB.", icon: UsersRound },
  { key: "uniquePlayersToday", label: "Player unique hôm nay", definition: "Player khác nhau trong các giải bắt đầu hôm nay theo giờ CLB.", icon: UserRoundCheck },
  { key: "playersPlayingNow", label: "Đang chơi", definition: "Player đang có ghế hoạt động trong giải đang chạy.", icon: Activity },
  { key: "entriesToday", label: "Entry hôm nay", definition: "Số bullet đã xác nhận của các giải bắt đầu hôm nay; không đồng nghĩa số người.", icon: TicketCheck },
  { key: "runningEvents", label: "Giải đang chạy", definition: "Giải live, break hoặc final table chưa bị xóa.", icon: Trophy },
  { key: "openTables", label: "Bàn đang mở", definition: "Bàn tournament đang ở trạng thái hoạt động.", icon: Table2 },
  { key: "dealersOnDuty", label: "Dealer đang trực", definition: "Dealer đã check-in và chưa check-out.", icon: BadgeCheck },
];

const AVAILABILITY_COPY = {
  exact: "Dữ liệu đầy đủ",
  partial: "Dữ liệu một phần",
  stale: "Dữ liệu đã cũ",
  unavailable: "Chưa có dữ liệu",
} as const;

function formatCount(value: number | null): string {
  return value === null ? "—" : new Intl.NumberFormat("vi-VN").format(value);
}

function formatAsOf(asOf: string | null): string {
  if (!asOf) return "Chưa có thời điểm cập nhật";
  return `Cập nhật ${new Intl.DateTimeFormat("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(asOf))}`;
}

export interface ClubPulsePanelProps {
  enabled: boolean;
  load?: SeriesClubLivePulseLoader;
  demoMode?: boolean;
  onDemoModeChange?: (enabled: boolean) => void;
  onPulseChange?: (pulse: SeriesClubLivePulseV1 | null) => void;
}

export function ClubPulsePanel({ enabled, load, demoMode = false, onDemoModeChange, onPulseChange }: ClubPulsePanelProps) {
  const operator = useOperatorClubs();
  const ownerClubIds = useMemo(() => new Set(operator.scope.filter((row) => row.can_owner).map((row) => row.club_id)), [operator.scope]);
  const ownerClubs = useMemo(() => (operator.clubs ?? []).filter((club) => ownerClubIds.has(club.id)), [operator.clubs, ownerClubIds]);
  const [clubId, setClubId] = useState<string | null>(null);
  const [demoAsOf, setDemoAsOf] = useState<string | null>(null);

  useEffect(() => {
    if (!ownerClubs.length) {
      setClubId(null);
      return;
    }
    setClubId((current) => current && ownerClubs.some((club) => club.id === current) ? current : ownerClubs[0].id);
  }, [ownerClubs]);

  const runtime = useSeriesClubLivePulseV1({ enabled: enabled && !demoMode, clubId, ...(load ? { load } : {}) });
  const demoPulse = useMemo(
    () => demoMode && clubId && demoAsOf ? createSeriesClubPulseDemoV1(clubId, demoAsOf) : null,
    [clubId, demoAsOf, demoMode],
  );
  const displayedPulse = demoMode ? demoPulse : runtime.pulse;
  useEffect(() => {
    onPulseChange?.(demoMode ? demoPulse : runtime.state === "ready" ? runtime.pulse : null);
  }, [demoMode, demoPulse, onPulseChange, runtime.pulse, runtime.state]);

  if (!enabled) return null;

  const isLoading = operator.loading || (!demoMode && runtime.state === "loading");
  const isRefreshing = runtime.state === "refreshing";
  const selectedClub = ownerClubs.find((club) => club.id === clubId);
  const toggleDemo = () => {
    const next = !demoMode;
    if (next) setDemoAsOf(new Date().toISOString());
    onDemoModeChange?.(next);
  };
  const refresh = () => {
    if (demoMode) {
      setDemoAsOf(new Date().toISOString());
      return;
    }
    runtime.refresh();
  };

  return (
    <section data-testid="club-pulse-panel" aria-labelledby="club-pulse-title" className="overflow-hidden rounded-md border border-primary/40 bg-card/50">
      <div className="flex flex-col gap-3 border-b border-border/70 bg-primary/[0.035] p-4 sm:flex-row sm:items-center sm:justify-between">
        <div className="min-w-0">
          <h2 id="club-pulse-title" className="flex items-center gap-2 text-base font-semibold text-foreground">
            <CalendarClock className="h-4 w-4 text-primary" aria-hidden /> Tình hình CLB hôm nay
          </h2>
          <p className="mt-0.5 text-xs text-muted-foreground">
            {selectedClub ? `${selectedClub.name} · ${demoMode ? "Dữ liệu mẫu · " : ""}${formatAsOf(displayedPulse?.asOf ?? null)}` : "Số tổng hợp read-only theo CLB của owner."}
          </p>
        </div>
        <div className="flex min-w-0 flex-wrap items-center gap-2">
          {ownerClubs.length > 1 && (
            <Select value={clubId ?? undefined} onValueChange={setClubId}>
              <SelectTrigger className="h-9 min-w-0 flex-1 sm:w-48" aria-label="Chọn CLB">
                <SelectValue placeholder="Chọn CLB" />
              </SelectTrigger>
              <SelectContent>
                {ownerClubs.map((club) => <SelectItem key={club.id} value={club.id}>{club.name}</SelectItem>)}
              </SelectContent>
            </Select>
          )}
          <Button type="button" variant={demoMode ? "secondary" : "outline"} size="sm" className="shrink-0 gap-2" onClick={toggleDemo} disabled={!clubId || operator.loading}>
            <DatabaseZap className="h-4 w-4" aria-hidden />
            {demoMode ? "Về dữ liệu thật" : "Dùng dữ liệu mẫu"}
          </Button>
          <Button type="button" variant="outline" size="sm" className="shrink-0 gap-2" onClick={refresh} disabled={!clubId || isLoading || isRefreshing}>
            <RefreshCw className={cn("h-4 w-4", isRefreshing && "animate-spin motion-reduce:animate-none")} aria-hidden />
            Làm mới
          </Button>
        </div>
      </div>

      <div className="p-4">
        {demoMode && (
          <div role="status" className="mb-3 rounded-md border border-warning/35 bg-warning/10 px-3 py-2 text-xs text-foreground">
            <span className="font-medium">Đang trình diễn dữ liệu mẫu.</span>{" "}
            Các số bên dưới và context của V không phải dữ liệu vận hành thật của CLB.
          </div>
        )}
        {isLoading ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Đang tải tình hình CLB">
            {METRICS.map(({ key }) => <Skeleton key={key} className="h-28 rounded-md" />)}
          </div>
        ) : !demoMode && runtime.state === "unavailable" ? (
          <div role="status" className="rounded-md border border-dashed border-border p-4 text-sm text-muted-foreground">
            <p className="font-medium text-foreground">Chưa đọc được tình hình CLB</p>
            <p className="mt-1 text-xs">Không thay dữ liệu thiếu bằng số 0. Hãy kiểm tra quyền owner hoặc thử làm mới sau khi nguồn Club Pulse sẵn sàng.</p>
          </div>
        ) : displayedPulse ? (
          <div className="grid grid-cols-2 gap-2 lg:grid-cols-4" aria-label="Số liệu tình hình CLB">
            {METRICS.map(({ key, label, definition, icon: Icon }) => {
              const metric = displayedPulse[key];
              if (!metric) return null;
              return (
                <article key={key} data-testid={`club-pulse-${metric.metricId}`} className="min-h-28 rounded-md border border-border/70 bg-background/25 p-3" title={definition}>
                  <div className="flex items-start justify-between gap-2">
                    <p className="text-xs leading-4 text-muted-foreground">{label}</p>
                    <Icon className="h-4 w-4 shrink-0 text-primary" aria-hidden />
                  </div>
                  <p className="mt-2 text-xl font-semibold tabular-nums text-foreground">{formatCount(metric.value)}</p>
                  <p className={cn("mt-1 text-[10px]", metric.availability === "partial" || metric.availability === "stale" ? "text-warning" : "text-muted-foreground")}>{AVAILABILITY_COPY[metric.availability]}</p>
                </article>
              );
            })}
          </div>
        ) : null}
      </div>
    </section>
  );
}
