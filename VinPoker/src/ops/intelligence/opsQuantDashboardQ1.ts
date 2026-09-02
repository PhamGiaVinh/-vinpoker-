import type { TruePrizePool } from "@/lib/series-intelligence/gtdOverlay";
import type { SeriesClubLivePulseV1 } from "@/lib/series-intelligence/seriesClubLivePulseV1";
import { baselineVerdict, runBaselineBattery, type BaselineBatteryResult } from "@/lib/series-intelligence/baselineBattery";
import { toHonestForecastResult, type HonestForecastStatus } from "@/lib/series-intelligence/honestForecast";
import type { SeriesEvent } from "@/lib/series-intelligence/nativeData";
import { forecastTurnout, type ForecastOptions, type TurnoutForecast, type UpcomingEvent } from "@/lib/series-intelligence/turnoutForecast";
import type { OpsLiveOperationInputV1, OpsOperationRowV1, OpsSourceAvailabilityV1 } from "./opsIntelligenceReadModel";
import type { OpsRegistrationEventQ0, OpsRegistrationPaceQ0, OpsSepayReadStateQ0 } from "./opsQuantDataHealthQ0";

export type QuantTruthClass = "OBSERVED" | "DERIVED" | "HYPOTHESIS" | "UNAVAILABLE";
export type QuantPressureStatus = "PRESSURE" | "WATCH" | "ON_TRACK" | "PLANNING_SCENARIO" | "UNAVAILABLE";

export interface QuantValueQ1 {
  readonly value: number | null;
  readonly truth: QuantTruthClass;
  readonly reasonCode: string | null;
}

export interface QuantSelectedEventQ1 {
  readonly eventId: string;
  readonly eventName: string;
  readonly eventState: string;
  readonly startTime: string;
  readonly isRunning: boolean;
  readonly registration: OpsRegistrationEventQ0;
  readonly series: SeriesEvent | null;
}

export interface QuantForecastQ1 {
  readonly status: HonestForecastStatus;
  readonly low: number | null;
  readonly center: number | null;
  readonly high: number | null;
  readonly baseline: number | null;
  readonly sampleSize: number;
  readonly modelMapePct: number | null;
  readonly baselineMapePct: number | null;
  readonly deltaVsBaselinePct: number | null;
  readonly scoredFoldCount: number;
  readonly modelAheadOnMatchedFolds: boolean;
  readonly truth: "HYPOTHESIS" | "UNAVAILABLE";
  readonly reasonCode: string;
  readonly raw: TurnoutForecast | null;
  readonly battery: BaselineBatteryResult | null;
}

export interface QuantScenarioQ1 {
  readonly scenarioId: "conservative" | "base" | "upside" | "baseline" | "custom";
  readonly label: string;
  readonly entries: number | null;
  readonly gtd: number | null;
  readonly requiredTables: number | null;
  readonly prizePool: number | null;
  readonly overlay: number | null;
  readonly surplus: number | null;
  readonly additionalTableNeed: number | null;
  readonly additionalDealerNeed: number | null;
  readonly capacityStatus: QuantPressureStatus;
  readonly truth: "HYPOTHESIS" | "UNAVAILABLE";
}

export interface QuantPressureRowQ1 {
  readonly eventId: string;
  readonly eventName: string;
  readonly startTime: string;
  readonly state: string;
  readonly confirmedEntries: number;
  readonly center: number | null;
  readonly requiredEntries: number | null;
  readonly gtdStatus: QuantPressureStatus;
  readonly forecastStatus: HonestForecastStatus;
  readonly sampleSize: number;
}

export interface QuantCapacityQ1 {
  readonly eventAllocatedTableCount: number;
  readonly eventAssignedDealerCount: number;
  readonly clubOpenTableCount: number | null;
  readonly clubConfiguredTableCount: number | null;
  readonly clubDealersOnDutyCount: number | null;
}

export interface QuantEconomicsQ1 {
  readonly gtd: QuantValueQ1;
  readonly prizeContributionPerEntry: QuantValueQ1;
  readonly requiredEntries: QuantValueQ1;
  readonly confirmedPrizePool: QuantValueQ1;
  readonly currentOverlay: QuantValueQ1;
  readonly currentSurplus: QuantValueQ1;
}

export interface QuantKpiQ1 {
  readonly metricId: string;
  readonly label: string;
  readonly value: number | null;
  readonly suffix: string | null;
  readonly truth: QuantTruthClass;
  readonly detail: string;
}

export interface QuantAlertQ1 {
  readonly alertId: string;
  readonly severity: "info" | "warning" | "critical";
  readonly title: string;
  readonly detail: string;
  readonly truth: QuantTruthClass;
}

export interface OpsQuantDashboardQ1Model {
  readonly selectedEvent: QuantSelectedEventQ1 | null;
  readonly eventOptions: readonly OpsRegistrationEventQ0[];
  readonly kpis: readonly QuantKpiQ1[];
  readonly forecast: QuantForecastQ1;
  readonly pressureRows: readonly QuantPressureRowQ1[];
  readonly capacity: QuantCapacityQ1;
  readonly economics: QuantEconomicsQ1;
  readonly scenarios: readonly QuantScenarioQ1[];
  readonly alerts: readonly QuantAlertQ1[];
  readonly sourceHealth: readonly { sourceId: string; availability: OpsSourceAvailabilityV1; reasonCode: string | null }[];
}

export type QuantExplanationKey = "gtd" | "band" | "sources" | "baseline";

export interface QuantArtifactExplanationQ1 {
  readonly title: string;
  readonly body: string;
  readonly evidenceIds: readonly string[];
}

export interface OpsQuantDashboardQ1Input {
  readonly requestedEventId: string | null;
  readonly pulse: SeriesClubLivePulseV1 | null;
  readonly pulseAvailability: OpsSourceAvailabilityV1;
  readonly operations: OpsLiveOperationInputV1;
  readonly registration: OpsRegistrationPaceQ0 | null;
  readonly registrationAvailability: OpsSourceAvailabilityV1;
  readonly sepay: OpsSepayReadStateQ0 | null;
  readonly sepayAvailability: OpsSourceAvailabilityV1;
  readonly seriesEvents: readonly SeriesEvent[];
  readonly seriesAvailability: OpsSourceAvailabilityV1;
  readonly truePrizePool: TruePrizePool | null;
  readonly prizePoolAvailability: OpsSourceAvailabilityV1;
  readonly seatsPerTable: number | null;
  readonly customEntries: number | null;
  readonly customGtd: number | null;
  readonly forecastOptions?: ForecastOptions;
}

const HISTORY_REASON = "HISTORY_FINALITY_UNVERIFIED";

export function buildOpsQuantDashboardQ1(input: OpsQuantDashboardQ1Input): OpsQuantDashboardQ1Model {
  const eventOptions = Object.freeze([...(input.registration?.events ?? [])].sort(eventSort));
  const selectedRegistration = selectQuantEvent(eventOptions, input.registration?.asOf ?? null, input.operations.runningTournamentIds, input.requestedEventId);
  const selectedSeries = selectedRegistration ? input.seriesEvents.find((event) => event.event_id === selectedRegistration.eventId) ?? null : null;
  const selectedEvent = selectedRegistration ? Object.freeze({
    eventId: selectedRegistration.eventId,
    eventName: selectedRegistration.eventName,
    eventState: selectedRegistration.eventState,
    startTime: selectedRegistration.startTime,
    isRunning: input.operations.runningTournamentIds.includes(selectedRegistration.eventId),
    registration: selectedRegistration,
    series: selectedSeries,
  }) : null;
  const forecast = buildForecast(input.seriesEvents, eventOptions, selectedEvent, input.forecastOptions);
  const capacity = buildCapacity(input.operations, selectedEvent?.eventId ?? null);
  const economics = buildEconomics(selectedSeries, input.truePrizePool, input.prizePoolAvailability);
  const scenarios = buildScenarios(forecast, economics, capacity, selectedEvent?.isRunning ?? false, input.seatsPerTable, input.customEntries, input.customGtd);
  const pressureRows = buildPressureRows(eventOptions, input.seriesEvents, input.operations.runningTournamentIds, input.forecastOptions);
  const kpis = buildKpis(input, selectedEvent, forecast, capacity, economics);
  const alerts = buildAlerts(selectedEvent, forecast, scenarios, input.operations.rows, input.registrationAvailability, input.sepay);
  return Object.freeze({
    selectedEvent,
    eventOptions,
    kpis: Object.freeze(kpis),
    forecast,
    pressureRows: Object.freeze(pressureRows),
    capacity,
    economics,
    scenarios: Object.freeze(scenarios),
    alerts: Object.freeze(alerts),
    sourceHealth: Object.freeze([
      { sourceId: "club-pulse", availability: input.pulseAvailability, reasonCode: input.pulse ? null : "CLUB_PULSE_UNAVAILABLE" },
      { sourceId: "live-operations", availability: input.operations.availability, reasonCode: input.operations.reasonCode },
      { sourceId: "registration-q0", availability: input.registrationAvailability, reasonCode: input.registration ? null : "REGISTRATION_Q0_UNAVAILABLE" },
      { sourceId: "sepay-q0", availability: input.sepayAvailability, reasonCode: input.sepay ? null : "SEPAY_Q0_UNAVAILABLE" },
      { sourceId: "series-history", availability: input.seriesAvailability, reasonCode: input.seriesEvents.length ? HISTORY_REASON : "SERIES_HISTORY_UNAVAILABLE" },
      { sourceId: "true-prize-pool", availability: input.prizePoolAvailability, reasonCode: input.truePrizePool ? null : "PRIZE_POOL_UNAVAILABLE" },
    ].map((source) => Object.freeze(source))),
  });
}

export function selectQuantEvent(
  events: readonly OpsRegistrationEventQ0[],
  asOf: string | null,
  runningTournamentIds: readonly string[],
  requestedEventId: string | null,
): OpsRegistrationEventQ0 | null {
  if (requestedEventId) {
    const requested = events.find((event) => event.eventId === requestedEventId);
    if (requested) return requested;
  }
  const origin = asOf && Number.isFinite(Date.parse(asOf)) ? Date.parse(asOf) : Number.NaN;
  const futureStates = new Set(["registering", "upcoming", "active", "scheduled"]);
  const future = events
    .filter((event) => futureStates.has(event.eventState) && Number.isFinite(origin) && Date.parse(event.startTime) >= origin)
    .sort(eventSort)[0];
  if (future) return future;
  const running = events.filter((event) => runningTournamentIds.includes(event.eventId)).sort((a, b) => Date.parse(b.startTime) - Date.parse(a.startTime));
  return running[0] ?? null;
}

export function propagateQuantTruth(inputs: readonly QuantTruthClass[]): QuantTruthClass {
  if (inputs.includes("UNAVAILABLE")) return "UNAVAILABLE";
  if (inputs.includes("HYPOTHESIS")) return "HYPOTHESIS";
  if (inputs.includes("DERIVED")) return "DERIVED";
  return "OBSERVED";
}

export function classifyGtdPressure(requiredEntries: number | null, low: number | null, high: number | null): QuantPressureStatus {
  if (requiredEntries === null || low === null || high === null) return "UNAVAILABLE";
  if (requiredEntries > high) return "PRESSURE";
  if (requiredEntries > low) return "WATCH";
  return "ON_TRACK";
}

export function explainQuantArtifact(model: OpsQuantDashboardQ1Model, key: QuantExplanationKey): QuantArtifactExplanationQ1 {
  if (key === "gtd") {
    const row = model.pressureRows.find((item) => item.eventId === model.selectedEvent?.eventId);
    return Object.freeze({
      title: "Vì sao GTD đang chịu áp lực?",
      body: row?.gtdStatus === "PRESSURE"
        ? `Required field ${row.requiredEntries ?? "—"} cao hơn cả kịch bản P90 ${model.forecast.high ?? "—"}. Đây là giả thuyết nghiên cứu, không phải xác suất overlay.`
        : row?.gtdStatus === "WATCH"
          ? `Required field ${row.requiredEntries ?? "—"} nằm trong dải P10–P90. Cần theo dõi registration thực tế trước khi ra quyết định.`
          : "Chưa có đủ forecast band và GTD canonical để kết luận GTD pressure.",
      evidenceIds: Object.freeze(["registration-q0", "series-history", "turnout-forecast"]),
    });
  }
  if (key === "band") return Object.freeze({
    title: "P10, Center và P90 khác nhau thế nào?",
    body: `P10 ${model.forecast.low ?? "—"} · Center ${model.forecast.center ?? "—"} · P90 ${model.forecast.high ?? "—"}. Các điểm chỉ nằm ở event horizon; hệ thống không vẽ đường tăng trưởng trung gian giả.`,
    evidenceIds: Object.freeze(["turnout-forecast", "registration-q0"]),
  });
  if (key === "baseline") return Object.freeze({
    title: "Model và baseline đang nói gì?",
    body: model.forecast.modelAheadOnMatchedFolds
      ? `Model đang thấp lỗi hơn baseline trên ${model.forecast.scoredFoldCount} matched folds, nhưng history finality vẫn chưa được xác minh.`
      : `Chưa đủ bằng chứng để nói model thắng baseline. Delta hiện tại: ${model.forecast.deltaVsBaselinePct ?? "—"}%.`,
    evidenceIds: Object.freeze(["baseline-battery", "series-history"]),
  });
  const unavailable = model.sourceHealth.filter((source) => source.availability !== "exact");
  return Object.freeze({
    title: "Nguồn nào đang partial hoặc unavailable?",
    body: unavailable.length ? unavailable.map((source) => `${source.sourceId}: ${source.availability}`).join(" · ") : "Các nguồn đang mount đều exact; history finality vẫn là limitation riêng.",
    evidenceIds: Object.freeze(unavailable.map((source) => source.sourceId)),
  });
}

function buildForecast(
  seriesEvents: readonly SeriesEvent[],
  nearTermEvents: readonly OpsRegistrationEventQ0[],
  selected: QuantSelectedEventQ1 | null,
  options: ForecastOptions = {},
): QuantForecastQ1 {
  if (!selected?.series || selected.series.buy_in === null || !(selected.series.buy_in > 0)) return unavailableForecast("FORECAST_STATIC_INPUT_MISSING");
  const targetDate = Date.parse(selected.startTime);
  if (!Number.isFinite(targetDate)) return unavailableForecast("FORECAST_TARGET_DATE_INVALID");
  const excluded = new Set(nearTermEvents.map((event) => event.eventId));
  excluded.add(selected.eventId);
  const history = seriesEvents.filter((event) => (
    !excluded.has(event.event_id)
    && event.event_date !== null
    && Number.isFinite(Date.parse(event.event_date))
    && Date.parse(event.event_date) < targetDate
    && event.buy_in !== null
    && event.buy_in > 0
    && event.total_entries !== null
    && event.total_entries > 0
  ));
  const target: UpcomingEvent = {
    event_date: selected.startTime,
    buy_in: selected.series.buy_in,
    gtd: selected.series.gtd,
    event_name: selected.series.event_name,
    typeKeyword: selected.series.event_name,
    capacity: null,
  };
  const raw = forecastTurnout([...history], target, options);
  const battery = runBaselineBattery([...history], target, options);
  const honest = toHonestForecastResult(raw, battery);
  const verdict = baselineVerdict(battery);
  const comparison = verdict.kind === "model_better"
    && verdict.foldCount > 0
    && raw.modelMapePct !== null
    && raw.baselineMapePct !== null
    && raw.deltaVsBaselinePct !== null;
  return Object.freeze({
    status: honest.status,
    low: honest.status === "full_model" ? honest.forecast.low : null,
    center: honest.status === "full_model" ? honest.forecast.base : honest.status === "baseline_only" ? honest.baseline.forecast : null,
    high: honest.status === "full_model" ? honest.forecast.high : null,
    baseline: honest.status === "full_model" ? honest.baseline?.forecast ?? null : honest.status === "baseline_only" ? honest.baseline.forecast : null,
    sampleSize: raw.sampleSize,
    modelMapePct: raw.modelMapePct,
    baselineMapePct: raw.baselineMapePct,
    deltaVsBaselinePct: raw.deltaVsBaselinePct,
    scoredFoldCount: verdict.foldCount,
    modelAheadOnMatchedFolds: comparison,
    truth: honest.status === "unavailable" ? "UNAVAILABLE" : "HYPOTHESIS",
    reasonCode: honest.status === "unavailable" ? "FORECAST_UNAVAILABLE" : HISTORY_REASON,
    raw,
    battery,
  });
}

function buildEconomics(series: SeriesEvent | null, truePrizePool: TruePrizePool | null, prizePoolAvailability: OpsSourceAvailabilityV1): QuantEconomicsQ1 {
  const gtd = observedPositive(series?.gtd ?? null, "GTD_MISSING");
  const contribution = observedPositive(series?.buy_in ?? null, "PRIZE_CONTRIBUTION_MISSING");
  const requiredEntries = gtd.value !== null && contribution.value !== null
    ? value(Math.ceil(gtd.value / contribution.value), "DERIVED")
    : value(null, "UNAVAILABLE", "REQUIRED_ENTRIES_INPUT_MISSING");
  const confirmedPrizePool = prizePoolAvailability === "exact" && truePrizePool
    ? value(truePrizePool.prizePool, "OBSERVED")
    : value(null, "UNAVAILABLE", "PRIZE_POOL_UNAVAILABLE");
  const currentOverlay = gtd.value !== null && confirmedPrizePool.value !== null
    ? value(Math.max(0, gtd.value - confirmedPrizePool.value), "DERIVED")
    : value(null, "UNAVAILABLE", "CURRENT_OVERLAY_INPUT_MISSING");
  const currentSurplus = gtd.value !== null && confirmedPrizePool.value !== null
    ? value(Math.max(0, confirmedPrizePool.value - gtd.value), "DERIVED")
    : value(null, "UNAVAILABLE", "CURRENT_SURPLUS_INPUT_MISSING");
  return Object.freeze({ gtd, prizeContributionPerEntry: contribution, requiredEntries, confirmedPrizePool, currentOverlay, currentSurplus });
}

function buildCapacity(operations: OpsLiveOperationInputV1, eventId: string | null): QuantCapacityQ1 {
  const rows = eventId ? operations.rows.filter((row) => row.tournamentId === eventId) : [];
  return Object.freeze({
    eventAllocatedTableCount: rows.length,
    eventAssignedDealerCount: rows.filter(hasActualDealerAssignment).length,
    clubOpenTableCount: operations.openTableCount,
    clubConfiguredTableCount: operations.configuredTableCount,
    clubDealersOnDutyCount: operations.dealersOnDutyCount,
  });
}

function buildScenarios(
  forecast: QuantForecastQ1,
  economics: QuantEconomicsQ1,
  capacity: QuantCapacityQ1,
  isRunning: boolean,
  seatsPerTable: number | null,
  customEntries: number | null,
  customGtd: number | null,
): QuantScenarioQ1[] {
  const definitions: Array<[QuantScenarioQ1["scenarioId"], string, number | null, number | null]> = forecast.status === "full_model"
    ? [["conservative", "Conservative · P10", forecast.low, economics.gtd.value], ["base", "Base · Center", forecast.center, economics.gtd.value], ["upside", "Upside · P90", forecast.high, economics.gtd.value]]
    : forecast.status === "baseline_only"
      ? [["baseline", "Baseline reference", forecast.baseline, economics.gtd.value]]
      : [];
  if (customEntries !== null && customEntries > 0) definitions.push(["custom", "Custom · Owner override", customEntries, customGtd && customGtd > 0 ? customGtd : economics.gtd.value]);
  return definitions.map(([scenarioId, label, entries, gtd]) => scenario(scenarioId, label, entries, gtd, economics.prizeContributionPerEntry.value, seatsPerTable, capacity, isRunning));
}

function scenario(
  scenarioId: QuantScenarioQ1["scenarioId"],
  label: string,
  entries: number | null,
  gtd: number | null,
  contribution: number | null,
  seatsPerTable: number | null,
  capacity: QuantCapacityQ1,
  isRunning: boolean,
): QuantScenarioQ1 {
  const prizePool = entries !== null && contribution !== null ? entries * contribution : null;
  const requiredTables = entries !== null && seatsPerTable !== null && seatsPerTable > 0 ? Math.ceil(entries / seatsPerTable) : null;
  const additionalTableNeed = requiredTables === null ? null : Math.max(0, requiredTables - capacity.eventAllocatedTableCount);
  const additionalDealerNeed = requiredTables === null ? null : Math.max(0, requiredTables - capacity.eventAssignedDealerCount);
  return Object.freeze({
    scenarioId,
    label,
    entries,
    gtd,
    requiredTables,
    prizePool,
    overlay: prizePool !== null && gtd !== null ? Math.max(0, gtd - prizePool) : null,
    surplus: prizePool !== null && gtd !== null ? Math.max(0, prizePool - gtd) : null,
    additionalTableNeed,
    additionalDealerNeed,
    capacityStatus: classifyCapacity(requiredTables, capacity, isRunning),
    truth: entries === null ? "UNAVAILABLE" : "HYPOTHESIS",
  });
}

function classifyCapacity(requiredTables: number | null, capacity: QuantCapacityQ1, isRunning: boolean): QuantPressureStatus {
  if (requiredTables === null) return "UNAVAILABLE";
  if (!isRunning) return "PLANNING_SCENARIO";
  if (capacity.clubConfiguredTableCount !== null && requiredTables > capacity.clubConfiguredTableCount) return "PRESSURE";
  if (requiredTables > capacity.eventAllocatedTableCount) return "WATCH";
  if (requiredTables <= capacity.eventAllocatedTableCount && requiredTables <= capacity.eventAssignedDealerCount) return "ON_TRACK";
  return "WATCH";
}

function buildPressureRows(
  events: readonly OpsRegistrationEventQ0[],
  seriesEvents: readonly SeriesEvent[],
  runningIds: readonly string[],
  options: ForecastOptions = {},
): QuantPressureRowQ1[] {
  return events.slice(0, 8).map((registration) => {
    const series = seriesEvents.find((event) => event.event_id === registration.eventId) ?? null;
    const selected = Object.freeze({ eventId: registration.eventId, eventName: registration.eventName, eventState: registration.eventState, startTime: registration.startTime, isRunning: runningIds.includes(registration.eventId), registration, series });
    const forecast = buildForecast(seriesEvents, events, selected, options);
    const requiredEntries = series?.gtd && series.buy_in ? Math.ceil(series.gtd / series.buy_in) : null;
    return Object.freeze({ eventId: registration.eventId, eventName: registration.eventName, startTime: registration.startTime, state: registration.eventState, confirmedEntries: registration.confirmedEntries, center: forecast.center, requiredEntries, gtdStatus: forecast.status === "full_model" ? classifyGtdPressure(requiredEntries, forecast.low, forecast.high) : "UNAVAILABLE", forecastStatus: forecast.status, sampleSize: forecast.sampleSize });
  });
}

function buildKpis(
  input: OpsQuantDashboardQ1Input,
  selected: QuantSelectedEventQ1 | null,
  forecast: QuantForecastQ1,
  capacity: QuantCapacityQ1,
  economics: QuantEconomicsQ1,
): QuantKpiQ1[] {
  const actionable = input.sepay?.buckets.find((bucket) => bucket.state === "actionable")?.transactionCount ?? null;
  const rows: QuantKpiQ1[] = [
    kpi("entries", "Entries observed", selected?.registration.confirmedEntries ?? null, null, selected ? "OBSERVED" : "UNAVAILABLE", "Q0 confirmed"),
    kpi("unique", "Unique players", selected?.registration.uniquePlayers ?? null, null, selected ? "OBSERVED" : "UNAVAILABLE", "Q0 unique"),
    kpi("velocity", "Velocity / 1h", selected?.registration.last1h ?? null, "/h", selected ? "OBSERVED" : "UNAVAILABLE", "Observed window"),
    kpi("forecast", "Forecast center", forecast.center, null, forecast.truth, forecast.status === "full_model" ? `N=${forecast.sampleSize}` : forecast.reasonCode),
    kpi("tables", "Event / club tables", capacity.eventAllocatedTableCount, ` / ${capacity.clubConfiguredTableCount ?? "—"}`, selected ? "DERIVED" : "UNAVAILABLE", "Exact event allocation"),
    kpi("dealers", "Event dealer coverage", capacity.eventAssignedDealerCount, null, selected ? "DERIVED" : "UNAVAILABLE", "Assigned to selected event"),
    kpi("sepay", "SePay actionable", actionable, " tx", actionable === null ? "UNAVAILABLE" : "DERIVED", "Q0 aggregate"),
    kpi("gtd-gap", "Current GTD gap", economics.currentOverlay.value, " ₫", economics.currentOverlay.truth, economics.currentOverlay.reasonCode ?? "Confirmed pool"),
  ];
  return rows;
}

function buildAlerts(
  selected: QuantSelectedEventQ1 | null,
  forecast: QuantForecastQ1,
  scenarios: readonly QuantScenarioQ1[],
  operationRows: readonly OpsOperationRowV1[],
  registrationAvailability: OpsSourceAvailabilityV1,
  sepay: OpsSepayReadStateQ0 | null,
): QuantAlertQ1[] {
  const alerts: QuantAlertQ1[] = [];
  const selectedRows = selected ? operationRows.filter((row) => row.tournamentId === selected.eventId) : [];
  for (const row of selectedRows) {
    if (row.dealerAssignmentState === "missing") alerts.push(alert(`dealer-missing-${row.tableId}`, "critical", `Thiếu dealer · ${row.tableName}`, "Bàn thuộc giải đã chọn chưa có assignment xác thực.", "DERIVED"));
    if (row.dealerAssignmentState === "overdue") alerts.push(alert(`dealer-overdue-${row.tableId}`, "warning", `Rotation quá hạn · ${row.tableName}`, "Theo swing_due_at và trạng thái Dealer Swing canonical.", "DERIVED"));
  }
  const base = scenarios.find((item) => item.scenarioId === "base");
  if (forecast.status === "full_model" && base?.overlay && base.overlay > 0) alerts.push(alert("gtd-hypothesis", "warning", "GTD stress · giả thuyết", "Kịch bản Center còn thiếu prize pool; history finality chưa được xác minh.", "HYPOTHESIS"));
  if (registrationAvailability !== "exact") alerts.push(alert("registration-source", "warning", "Registration source chưa exact", "Không tạo operational alert từ phần dữ liệu chưa xác minh.", "UNAVAILABLE"));
  const actionable = sepay?.buckets.find((bucket) => bucket.state === "actionable")?.transactionCount ?? 0;
  if (actionable > 0) alerts.push(alert("sepay-actionable", "info", `${actionable} giao dịch cần đối soát`, "Chỉ hiển thị aggregate Q0, không lộ giao dịch.", "DERIVED"));
  return alerts;
}

function observedPositive(input: number | null, reasonCode: string): QuantValueQ1 {
  return input !== null && Number.isFinite(input) && input > 0 ? value(input, "OBSERVED") : value(null, "UNAVAILABLE", reasonCode);
}
function value(input: number | null, truth: QuantTruthClass, reasonCode: string | null = null): QuantValueQ1 { return Object.freeze({ value: input, truth, reasonCode }); }
function kpi(metricId: string, label: string, input: number | null, suffix: string | null, truth: QuantTruthClass, detail: string): QuantKpiQ1 { return Object.freeze({ metricId, label, value: input, suffix, truth, detail }); }
function alert(alertId: string, severity: QuantAlertQ1["severity"], title: string, detail: string, truth: QuantTruthClass): QuantAlertQ1 { return Object.freeze({ alertId, severity, title, detail, truth }); }
function hasActualDealerAssignment(row: OpsOperationRowV1): boolean { return row.dealerName !== null && (row.dealerAssignmentState === "assigned" || row.dealerAssignmentState === "overdue"); }
function eventSort(a: OpsRegistrationEventQ0, b: OpsRegistrationEventQ0): number { return Date.parse(a.startTime) - Date.parse(b.startTime) || a.eventId.localeCompare(b.eventId); }
function unavailableForecast(reasonCode: string): QuantForecastQ1 { return Object.freeze({ status: "unavailable", low: null, center: null, high: null, baseline: null, sampleSize: 0, modelMapePct: null, baselineMapePct: null, deltaVsBaselinePct: null, scoredFoldCount: 0, modelAheadOnMatchedFolds: false, truth: "UNAVAILABLE", reasonCode, raw: null, battery: null }); }
