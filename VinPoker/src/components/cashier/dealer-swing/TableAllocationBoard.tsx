import { useMemo } from "react";
import { AlertTriangle, CalendarClock, RefreshCw, Table2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import type { DealerAssignment, GameTableRow } from "@/hooks/useDealerSwing";
import type { RotationScheduleRow } from "@/hooks/useRotationSchedule";
import { formatTimeHHmm } from "./swingTableView";
import {
  buildTableAllocationRows,
  TABLE_ALLOCATION_WINDOW_MINUTES,
  type TableAllocationCoverage,
  type TableAllocationMarker,
  type TableAllocationRow,
  type TableAllocationSegment,
} from "./tableAllocationProjection";

const PIXELS_PER_MINUTE = 8;
const TIMELINE_WIDTH_PX = TABLE_ALLOCATION_WINDOW_MINUTES * PIXELS_PER_MINUTE;

export interface TableAllocationBoardProps {
  tables: GameTableRow[];
  canonicalAssignments: DealerAssignment[];
  activeRawData: DealerAssignment[];
  scheduleRows: RotationScheduleRow[];
  selectedTour: string | null;
  searchTerm?: string;
  nowMs: number;
  loading: boolean;
  error: string | null;
  onRetry: () => void;
}

function coveragePresentation(coverage: TableAllocationCoverage): { label: string; className: string } {
  switch (coverage) {
    case "covered":
      return { label: "ĐỦ DEALER", className: "border-success/40 bg-success/10 text-success" };
    case "gap":
      return { label: "TRỐNG", className: "border-destructive/40 bg-destructive/10 text-destructive" };
    case "conflict":
      return { label: "XUNG ĐỘT", className: "border-destructive/50 bg-destructive/10 text-destructive" };
    case "scheduled":
      return { label: "SẮP MỞ", className: "border-primary/40 bg-primary/10 text-primary" };
    default:
      return { label: "CHƯA MỞ", className: "border-border bg-muted text-muted-foreground" };
  }
}

function segmentClasses(segment: TableAllocationSegment): string {
  switch (segment.status) {
    case "active":
      return "border-primary bg-primary/20 text-primary";
    case "locked":
      return "border-success bg-success/15 text-success";
    case "executing":
      return "border-success bg-success/25 text-success";
    case "predicted":
      return "border-warning bg-[repeating-linear-gradient(135deg,transparent_0,transparent_6px,rgba(245,158,11,0.18)_6px,rgba(245,158,11,0.18)_12px)] text-warning";
    case "shortage":
      return "border-warning bg-[repeating-linear-gradient(135deg,transparent_0,transparent_5px,rgba(245,158,11,0.26)_5px,rgba(245,158,11,0.26)_10px)] text-warning";
    case "delayed":
      return "border-warning bg-warning/20 text-warning";
    case "scheduled":
      return "border-border bg-muted/70 text-muted-foreground";
    case "conflict":
      return "border-destructive bg-destructive/20 text-destructive";
    default:
      return "border-destructive bg-destructive/10 text-destructive";
  }
}

function markerClasses(marker: TableAllocationMarker): string {
  if (marker.status === "conflict") return "border-destructive/60 bg-destructive/15 text-destructive";
  if (marker.status === "shortage") return "border-warning/70 bg-warning/15 text-warning";
  if (marker.status === "delayed") return "border-warning/70 bg-warning/20 text-warning";
  if (marker.status === "predicted") return "border-warning/60 bg-warning/10 text-warning";
  return "border-success/60 bg-success/10 text-success";
}

function segmentPosition(segment: Pick<TableAllocationSegment, "startAt">, windowStartMs: number): number {
  const timestamp = new Date(segment.startAt).getTime();
  if (!Number.isFinite(timestamp)) return 0;
  return Math.max(0, Math.min(TIMELINE_WIDTH_PX, ((timestamp - windowStartMs) / 60_000) * PIXELS_PER_MINUTE));
}

function segmentWidth(segment: TableAllocationSegment, windowStartMs: number): number {
  const start = segmentPosition(segment, windowStartMs);
  const endMs = segment.endAt ? new Date(segment.endAt).getTime() : windowStartMs + TABLE_ALLOCATION_WINDOW_MINUTES * 60_000;
  const end = Number.isFinite(endMs)
    ? Math.max(0, Math.min(TIMELINE_WIDTH_PX, ((endMs - windowStartMs) / 60_000) * PIXELS_PER_MINUTE))
    : TIMELINE_WIDTH_PX;
  return Math.max(0, end - start);
}

function markerPosition(marker: TableAllocationMarker, windowStartMs: number): number | null {
  if (!marker.at) return null;
  const atMs = new Date(marker.at).getTime();
  const windowEndMs = windowStartMs + TABLE_ALLOCATION_WINDOW_MINUTES * 60_000;
  if (!Number.isFinite(atMs) || atMs < windowStartMs || atMs > windowEndMs) return null;
  return ((atMs - windowStartMs) / 60_000) * PIXELS_PER_MINUTE;
}

function markerText(marker: TableAllocationMarker): string {
  return marker.dealerName ? `${marker.label} · ${marker.dealerName}` : marker.label;
}

function segmentAriaLabel(row: TableAllocationRow, segment: TableAllocationSegment): string {
  const start = formatTimeHHmm(new Date(segment.startAt).getTime());
  const end = segment.endAt ? ` đến ${formatTimeHHmm(new Date(segment.endAt).getTime())}` : " · chưa rõ thời điểm kết thúc";
  const person = segment.dealerName ? `, dealer ${segment.dealerName}` : "";
  return `${row.tableName}${person}, ${segment.label}, từ ${start}${end}`;
}

function markerAriaLabel(row: TableAllocationRow, marker: TableAllocationMarker): string {
  const when = marker.at ? ` lúc ${formatTimeHHmm(new Date(marker.at).getTime())}` : " · chưa có giờ";
  const person = marker.dealerName ? `, dealer ${marker.dealerName}` : "";
  return `${row.tableName}${person}, ${marker.label}${when}`;
}

function AllocationSkeleton() {
  return (
    <div className="space-y-2" aria-busy="true" aria-label="Đang tải bảng theo bàn">
      {Array.from({ length: 5 }).map((_, index) => <Skeleton key={index} className="h-14 w-full" />)}
    </div>
  );
}

function TimelineHeader({ windowStartMs }: { windowStartMs: number }) {
  const ticks = Array.from({ length: TABLE_ALLOCATION_WINDOW_MINUTES / 15 + 1 }, (_, index) => index * 15);
  return (
    <div className="relative h-12" style={{ width: TIMELINE_WIDTH_PX }}>
      {ticks.map((minute) => (
        <div
          key={minute}
          className={`absolute top-0 h-full border-l pl-1 ${minute % 30 === 0 ? "border-border/90" : "border-border/40"}`}
          style={{ left: minute * PIXELS_PER_MINUTE }}
        >
          {minute % 30 === 0 && (
            <span className="text-[11px] font-medium tabular-nums text-muted-foreground">
              {minute === 0 ? `NOW · ${formatTimeHHmm(windowStartMs)}` : formatTimeHHmm(windowStartMs + minute * 60_000)}
            </span>
          )}
        </div>
      ))}
    </div>
  );
}

function TimelineRow({ row, windowStartMs }: { row: TableAllocationRow; windowStartMs: number }) {
  const untimedMarkers = row.markers.filter((marker) => marker.at == null);
  return (
    <div className="relative h-[76px]" style={{ width: TIMELINE_WIDTH_PX }}>
      {Array.from({ length: TABLE_ALLOCATION_WINDOW_MINUTES / 15 + 1 }, (_, index) => (
        <span
          key={index}
          aria-hidden="true"
          className={`absolute inset-y-0 border-l ${index % 2 === 0 ? "border-border/50" : "border-border/25"}`}
          style={{ left: index * 15 * PIXELS_PER_MINUTE }}
        />
      ))}
      <span aria-hidden="true" className="absolute inset-y-0 left-0 z-10 border-l-2 border-primary" />
      {row.segments.map((segment) => {
        const width = segmentWidth(segment, windowStartMs);
        if (width === 0) return null;
        const value = segment.dealerName ?? segment.label;
        return (
          <div
            key={segment.id}
            aria-label={segmentAriaLabel(row, segment)}
            className={`absolute top-[20px] z-10 flex h-9 min-w-0 items-center border px-2 text-[11px] leading-tight shadow-sm ${segment.openEnded ? "table-allocation-open-edge" : ""} ${segmentClasses(segment)}`}
            style={{ left: segmentPosition(segment, windowStartMs), width }}
            title={segmentAriaLabel(row, segment)}
          >
            <span className="min-w-0 truncate font-semibold">{value}</span>
            {segment.dealerName && <span className="ml-1.5 shrink-0 text-[9px] opacity-80">{segment.label}</span>}
          </div>
        );
      })}
      {row.markers.map((marker) => {
        const position = markerPosition(marker, windowStartMs);
        if (position == null) return null;
        return (
          <span
            key={marker.id}
            aria-label={markerAriaLabel(row, marker)}
            className={`absolute top-0 z-20 max-w-40 -translate-x-1/2 truncate rounded border px-1.5 py-0.5 text-[9px] font-semibold leading-3 shadow-sm ${markerClasses(marker)}`}
            style={{ left: position }}
            title={markerAriaLabel(row, marker)}
          >
            {markerText(marker)}
          </span>
        );
      })}
      {untimedMarkers.length > 0 && (
        <div data-testid="untimed-marker-rail" className="absolute inset-x-2 bottom-1 z-20 flex gap-1 overflow-hidden">
          {untimedMarkers.map((marker) => (
            <span
              key={marker.id}
              aria-label={markerAriaLabel(row, marker)}
              className={`max-w-40 truncate rounded border px-1.5 py-0.5 text-[9px] font-semibold leading-3 shadow-sm ${markerClasses(marker)}`}
              title={markerAriaLabel(row, marker)}
            >
              {markerText(marker)}
            </span>
          ))}
        </div>
      )}
    </div>
  );
}

export default function TableAllocationBoard({
  tables,
  canonicalAssignments,
  activeRawData,
  scheduleRows,
  selectedTour,
  searchTerm,
  nowMs,
  loading,
  error,
  onRetry,
}: TableAllocationBoardProps) {
  // A minute bucket avoids rebuilding the projection for every live-clock tick.
  const windowStartMs = Math.floor(nowMs / 60_000) * 60_000;
  const rows = useMemo(() => buildTableAllocationRows({
    tables,
    canonicalAssignments,
    activeRawData,
    scheduleRows,
    nowMs: windowStartMs,
    selectedTour,
    searchTerm,
  }), [tables, canonicalAssignments, activeRawData, scheduleRows, windowStartMs, selectedTour, searchTerm]);

  const emptyMessage = tables.length === 0
    ? "CLB chưa có bàn."
    : selectedTour
      ? "Không có bàn trong tour đang chọn."
      : "Không có bàn nào cần theo dõi lúc này.";

  return (
    <Card className="font-table-allocation h-full p-3">
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <Table2 className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold tracking-wide">BẢNG THEO BÀN</h2>
        <Badge variant="outline" className="ml-auto text-xs">{rows.length} bàn theo dõi</Badge>
      </div>

      {error && (
        <div role="alert" className="mb-3 flex items-center gap-2 rounded-md border border-destructive/40 bg-destructive/10 p-2 text-xs text-destructive">
          <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden="true" />
          <span className="min-w-0 flex-1">Không tải được đầy đủ dữ liệu Dealer Swing: {error}</span>
          <Button size="sm" variant="outline" className="h-8 shrink-0 border-destructive/40 text-destructive" onClick={onRetry}>
            <RefreshCw className="mr-1 h-3.5 w-3.5" aria-hidden="true" />Tải lại
          </Button>
        </div>
      )}

      {loading && rows.length === 0 ? <AllocationSkeleton /> : rows.length === 0 ? (
        <div role="status" className="flex min-h-40 flex-col items-center justify-center gap-2 px-4 text-center text-sm text-muted-foreground">
          <CalendarClock className="h-5 w-5" aria-hidden="true" />
          <p>{emptyMessage}</p>
          {scheduleRows.length === 0 && tables.length > 0 && <p className="text-xs">Chưa có lịch Dealer Swing trong 90 phút tới.</p>}
        </div>
      ) : (
        <div className="max-h-[62vh] overflow-auto rounded-md border border-border/70" aria-busy={loading || undefined}>
          <table className="w-max min-w-full border-collapse text-xs">
            <thead className="sticky top-0 z-30 bg-card shadow-sm">
              <tr>
                <th scope="col" className="sticky left-0 z-40 min-w-40 border-b border-r border-border bg-card px-3 py-3 text-left font-medium text-muted-foreground">Bàn</th>
                <th scope="col" className="border-b border-border px-0 text-left font-medium text-muted-foreground">
                  <TimelineHeader windowStartMs={windowStartMs} />
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map((row) => {
                const coverage = coveragePresentation(row.coverage);
                return (
                  <tr key={row.tableId} className="border-b border-border/70 last:border-b-0">
                    <th scope="row" className="sticky left-0 z-20 min-w-40 border-r border-border bg-card px-3 py-2 text-left align-middle">
                      <div className="flex items-start gap-2">
                        {row.coverage === "conflict" && <AlertTriangle className="mt-0.5 h-3.5 w-3.5 shrink-0 text-destructive" aria-label="Có xung đột dữ liệu" />}
                        <div className="min-w-0">
                          <span className="block truncate font-semibold text-foreground" title={row.tableName}>{row.tableName}</span>
                          <span className={`mt-1 inline-flex rounded border px-1.5 py-0.5 text-[10px] font-semibold ${coverage.className}`}>{coverage.label}</span>
                          {row.coverage === "gap" && (
                            <span className="mt-1 block text-[10px] font-normal text-muted-foreground">
                              {row.gapStartedAt ? `Từ ${formatTimeHHmm(new Date(row.gapStartedAt).getTime())}` : "Chưa rõ từ lúc nào"}
                            </span>
                          )}
                          {row.conflicts.map((conflict) => <span key={conflict.code} className="mt-1 block text-[10px] font-normal text-destructive">{conflict.label}</span>)}
                        </div>
                      </div>
                    </th>
                    <td className="p-0 align-middle"><TimelineRow row={row} windowStartMs={windowStartMs} /></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}
    </Card>
  );
}
