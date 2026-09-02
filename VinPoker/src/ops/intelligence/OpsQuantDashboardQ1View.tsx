import { useMemo, useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { AlertTriangle, ArrowUpRight, Bot, RefreshCw, Send } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { FEATURES } from "@/lib/featureFlags";
import type { SeriesClubLivePulseV1 } from "@/lib/series-intelligence/seriesClubLivePulseV1";
import type { OpsLiveOperationInputV1, OpsSourceAvailabilityV1 } from "./opsIntelligenceReadModel";
import { isOpsQuantDataHealthQ0Enabled } from "./opsQuantDataHealthGate";
import { operationsQueryOptions, pulseQueryOptions, registrationQ0QueryOptions, sepayQ0QueryOptions } from "./opsIntelligenceQueryOptions";
import { buildOpsQuantDashboardQ1, explainQuantArtifact, selectQuantEvent, type OpsQuantDashboardQ1Model, type QuantExplanationKey, type QuantPressureStatus, type QuantTruthClass } from "./opsQuantDashboardQ1";
import { selectedPrizePoolQueryOptions, seriesHistoryQueryOptions } from "./opsQuantDashboardQ1Queries";
import { OpsQuantForecastChart } from "./OpsQuantForecastChart";
import type { OpsRegistrationPaceQ0, OpsSepayReadStateQ0 } from "./opsQuantDataHealthQ0";

const PENDING_AT = "1970-01-01T00:00:00.000Z";

export function OpsQuantDashboardQ1View({ clubId, clubName }: { clubId: string; clubName: string | null }) {
  const client = useSupabaseClient();
  const q0Enabled = isOpsQuantDataHealthQ0Enabled();
  const [requestedEventId, setRequestedEventId] = useState<string | null>(null);
  const [seatsPerTable, setSeatsPerTable] = useState<number | null>(null);
  const [customEntries, setCustomEntries] = useState<number | null>(null);
  const [customGtd, setCustomGtd] = useState<number | null>(null);
  const [explanationKey, setExplanationKey] = useState<QuantExplanationKey | null>(null);

  const pulse = useQuery(pulseQueryOptions(client, clubId));
  const operations = useQuery(operationsQueryOptions(client, clubId, q0Enabled));
  const registration = useQuery(registrationQ0QueryOptions(client, clubId));
  const sepay = useQuery(sepayQ0QueryOptions(client, clubId));
  const series = useQuery(seriesHistoryQueryOptions(client, clubId));

  const operationValue = operations.data ?? emptyOperations();
  const autoSelected = selectQuantEvent(registration.data?.value?.events ?? [], registration.data?.value?.asOf ?? null, operationValue.runningTournamentIds, requestedEventId);
  const selectedEventId = autoSelected?.eventId ?? null;
  const prizePool = useQuery(selectedPrizePoolQueryOptions(client, clubId, selectedEventId));
  const pulseValue = acceptedPulse(pulse.data?.value ?? null);
  const registrationAvailability = registrationAvailabilityOf(registration.data?.value ?? null);
  const sepayAvailability = sepayAvailabilityOf(sepay.data?.value ?? null);

  const model = useMemo(() => buildOpsQuantDashboardQ1({
    requestedEventId,
    pulse: pulseValue,
    pulseAvailability: pulseAvailabilityOf(pulseValue),
    operations: operationValue,
    registration: registration.data?.value ?? null,
    registrationAvailability,
    sepay: sepay.data?.value ?? null,
    sepayAvailability,
    seriesEvents: series.data?.value ?? [],
    seriesAvailability: series.data?.availability ?? "unavailable",
    truePrizePool: prizePool.data?.value ?? null,
    prizePoolAvailability: prizePool.data?.availability ?? "unavailable",
    seatsPerTable,
    customEntries,
    customGtd,
    forecastOptions: { calendarFeatures: FEATURES.seriesCalendarFeatures, censoring: FEATURES.seriesCensoring },
  }), [customEntries, customGtd, operationValue, prizePool.data, pulseValue, registration.data, registrationAvailability, requestedEventId, seatsPerTable, sepay.data, sepayAvailability, series.data]);

  const explanation = explanationKey ? explainQuantArtifact(model, explanationKey) : null;
  const asOf = registration.data?.value?.asOf ?? pulseValue?.asOf ?? operationValue.observedAt;
  const terminalStatus = headlineStatus(pulseAvailabilityOf(pulseValue), operationValue.availability);
  const refresh = () => void Promise.allSettled([pulse.refetch(), operations.refetch(), registration.refetch(), sepay.refetch(), series.refetch(), ...(selectedEventId ? [prizePool.refetch()] : [])]);
  const changeEvent = (eventId: string) => {
    setRequestedEventId(eventId);
    setSeatsPerTable(null);
    setCustomEntries(null);
    setCustomGtd(null);
    setExplanationKey(null);
  };

  return <section className="space-y-3" data-testid="ops-quant-dashboard-q1">
    <div className="grid gap-2 border border-white/10 bg-[#050b0d] p-3 xl:grid-cols-[minmax(180px,.7fr)_minmax(260px,1.25fr)_1fr_auto] xl:items-end">
      <HeaderField label="CLB" value={clubName ?? "CLB đã xác thực"} badge="VERIFIED" />
      <label className="block min-w-0"><span className="mb-1 block text-[9px] font-semibold uppercase tracking-[0.12em] text-[#71837d]">Event</span><Select value={model.selectedEvent?.eventId ?? "none"} onValueChange={changeEvent}><SelectTrigger className="h-9 rounded-[4px] border-white/10 bg-black/25 text-xs text-white"><SelectValue placeholder="Chưa có event" /></SelectTrigger><SelectContent>{model.eventOptions.map((event) => <SelectItem key={event.eventId} value={event.eventId}>{event.eventName}</SelectItem>)}</SelectContent></Select></label>
      <div className="grid grid-cols-3 gap-3 text-right"><HeaderStat label="Local time" value={formatInTimezone(asOf, pulseValue?.timezone ?? null)} /><HeaderStat label="Status" value={terminalStatus} tone={terminalStatus === "LIVE" ? "good" : "warn"} /><HeaderStat label="As of" value={formatTime(asOf)} /></div>
      <Button type="button" size="sm" variant="outline" onClick={refresh} className="h-9 rounded-[4px] border-white/10 bg-black/20 text-xs"><RefreshCw className="mr-2 h-3.5 w-3.5" />Refresh</Button>
    </div>

    <section className="grid grid-cols-2 gap-px overflow-hidden border border-white/10 bg-white/10 xl:grid-cols-8" aria-label="Quant KPI rail">
      {model.kpis.map((metric) => <Kpi key={metric.metricId} metric={metric} />)}
    </section>

    <div className="grid gap-3 xl:grid-cols-[minmax(0,2.2fr)_minmax(0,5fr)_minmax(0,2.4fr)_minmax(0,2.4fr)]">
      <Panel title="Signal pipeline" detail="Observed → model → owner decision">
        <SignalPipeline model={model} />
      </Panel>
      <Panel title="Demand & turnout forecast" detail="Observed timeline · terminal horizon only">
        <ChartLegend model={model} />
        <OpsQuantForecastChart selectedEvent={model.selectedEvent} forecast={model.forecast} />
        <ForecastFootnote model={model} />
      </Panel>
      <Panel title="V artifact explainer" detail="Không gọi Gemini · không tạo số">
        <VDock selected={explanationKey} onSelect={setExplanationKey} explanation={explanation} />
      </Panel>
      <Panel title="Alerts" detail={`${Math.min(model.alerts.length, 2)}/${model.alerts.length} signal đang hiển thị`} compact>
        <AlertRail model={model} />
      </Panel>
    </div>

    <Panel title="Tournament pressure matrix" detail="Event demand · GTD stress · confidence authority">
      <PressureMatrix model={model} />
    </Panel>

    <div className="grid grid-cols-12 gap-3">
      <Panel className="col-span-12 xl:col-span-4" title="Capacity & staffing" detail="Selected-event allocation first">
        <CapacityPanel model={model} seatsPerTable={seatsPerTable} onSeatsPerTable={setSeatsPerTable} />
      </Panel>
      <Panel className="col-span-12 xl:col-span-4" title="Economics & GTD" detail="Confirmed pool riêng · scenario riêng">
        <EconomicsPanel model={model} />
      </Panel>
      <Panel className="col-span-12 xl:col-span-4" title="Scenario lab" detail="Local assumptions · not saved">
        <ScenarioPanel model={model} customEntries={customEntries} customGtd={customGtd} onEntries={setCustomEntries} onGtd={setCustomGtd} />
      </Panel>
    </div>

    <footer className="flex flex-wrap items-center justify-between gap-3 border border-white/8 bg-[#050b0d] px-3 py-2 text-[9px] uppercase tracking-[0.1em] text-[#71837d]">
      <span>Research model · history finality unverified · owner makes the final decision</span>
      <div className="flex flex-wrap gap-3">{model.sourceHealth.map((source) => <span key={source.sourceId}><i className={`mr-1 inline-block h-1.5 w-1.5 rounded-full ${availabilityDot(source.availability)}`} />{source.sourceId} {source.availability}</span>)}</div>
    </footer>
  </section>;
}

function Panel({ title, detail, className = "", compact = false, children }: { title: string; detail: string; className?: string; compact?: boolean; children: React.ReactNode }) {
  return <section className={`min-w-0 border border-white/10 bg-[#050b0d] ${className}`}><div className="flex items-start justify-between border-b border-white/8 px-3 py-2"><div><h2 className="text-[11px] font-semibold uppercase tracking-[0.08em] text-white">{title}</h2><p className="mt-0.5 text-[9px] text-[#71837d]">{detail}</p></div><span className="mt-1 h-1.5 w-1.5 rounded-full bg-cyan-300/70" /></div><div className={compact ? "p-2" : "p-3"}>{children}</div></section>;
}

function Kpi({ metric }: { metric: OpsQuantDashboardQ1Model["kpis"][number] }) {
  const displayValue = metric.value === null
    ? "—"
    : metric.metricId === "gtd-gap"
      ? `${formatVndShort(metric.value)} ₫`
      : `${formatNumber(metric.value)}${metric.suffix ?? ""}`;
  return <article className="min-w-0 bg-[#061013] px-3 py-2.5"><div className="flex items-start justify-between gap-1"><p className="truncate text-[8px] uppercase tracking-[0.05em] text-[#78908a]">{metric.label}</p><TruthBadge truth={metric.truth} /></div><p className={`mt-2 font-mono text-xl font-semibold tabular-nums ${metric.truth === "HYPOTHESIS" ? "text-fuchsia-300" : metric.truth === "UNAVAILABLE" ? "text-rose-300" : "text-emerald-200"}`}>{displayValue}</p><p className="mt-1 truncate font-mono text-[9px] text-[#647872]">{metric.detail}</p></article>;
}

function SignalPipeline({ model }: { model: OpsQuantDashboardQ1Model }) {
  const items = [
    ["Observed demand", model.selectedEvent?.registration.confirmedEntries ?? null, "OBSERVED" as const],
    ["Turnout forecast", model.forecast.center, model.forecast.truth],
    ["Table demand", model.scenarios.find((item) => item.scenarioId === "base")?.requiredTables ?? null, model.scenarios.length ? "HYPOTHESIS" as const : "UNAVAILABLE" as const],
    ["Dealer demand", model.scenarios.find((item) => item.scenarioId === "base")?.additionalDealerNeed ?? null, model.scenarios.length ? "HYPOTHESIS" as const : "UNAVAILABLE" as const],
    ["GTD stress", model.economics.requiredEntries.value, model.forecast.status === "full_model" ? "HYPOTHESIS" as const : "UNAVAILABLE" as const],
    ["Owner decision", null, "UNAVAILABLE" as const],
  ];
  return <ol className="space-y-1">{items.map(([label, rawValue, truth], index) => <li key={label as string} className="relative grid grid-cols-[20px_1fr_auto_auto] items-center gap-2 border border-white/8 bg-black/15 px-2 py-1.5"><span className="flex h-5 w-5 items-center justify-center border border-cyan-300/20 bg-cyan-300/5 font-mono text-[9px] text-cyan-200">{index + 1}</span><span className="truncate text-[10px] font-medium text-[#c4d1cd]">{label as string}</span><b className="font-mono text-[10px] text-white">{typeof rawValue === "number" ? formatNumber(rawValue) : "—"}</b><TruthBadge truth={truth as QuantTruthClass} /></li>)}</ol>;
}

function ChartLegend({ model }: { model: OpsQuantDashboardQ1Model }) { return <div className="mb-1 flex flex-wrap gap-4 font-mono text-[9px] text-[#78908a]"><span className="text-cyan-200">● Observed cumulative</span><span className="text-fuchsia-300">● P10 / Center / P90 at event horizon</span><span>Current {model.selectedEvent?.registration.confirmedEntries ?? "—"}</span></div>; }
function ForecastFootnote({ model }: { model: OpsQuantDashboardQ1Model }) { return <div className="grid gap-2 border-t border-white/8 pt-2 text-[9px] text-[#78908a] sm:grid-cols-3"><span>N={model.forecast.sampleSize} historical rows</span><span>MAPE model {formatPct(model.forecast.modelMapePct)}</span><span>Baseline {formatPct(model.forecast.baselineMapePct)} · {model.forecast.scoredFoldCount} folds</span><p className="sm:col-span-3 text-amber-200">RESEARCH MODEL · HISTORY FINALITY UNVERIFIED</p></div>; }

function VDock({ selected, onSelect, explanation }: { selected: QuantExplanationKey | null; onSelect: (key: QuantExplanationKey) => void; explanation: ReturnType<typeof explainQuantArtifact> | null }) {
  const questions: Array<[QuantExplanationKey, string]> = [["gtd", "Vì sao GTD chịu áp lực?"], ["band", "P10 / Center / P90 khác gì?"], ["sources", "Nguồn nào chưa exact?"], ["baseline", "Model so với baseline?"]];
  return <div className="space-y-1.5"><div className="flex items-center gap-2 border border-cyan-300/15 bg-cyan-300/5 p-2"><Bot className="h-4 w-4 text-cyan-200" /><span className="text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-100">Giải thích artifact · không gọi Gemini</span></div>{questions.map(([key, label]) => <button key={key} type="button" onClick={() => onSelect(key)} className={`flex min-h-8 w-full items-center justify-between border px-2 text-left text-[10px] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-cyan-300 ${selected === key ? "border-cyan-300/30 bg-cyan-300/5 text-white" : "border-white/8 text-[#9aaba6] hover:border-white/20"}`}>{label}<ArrowUpRight className="h-3 w-3" /></button>)}{explanation && <article className="border border-fuchsia-300/15 bg-fuchsia-300/5 p-2"><h3 className="text-[10px] font-semibold text-fuchsia-200">{explanation.title}</h3><p className="mt-1 text-[10px] leading-4 text-[#a9bab5]">{explanation.body}</p><p className="mt-2 font-mono text-[8px] text-[#70837d]">{explanation.evidenceIds.join(" · ") || "NO_EXACT_SOURCE"}</p></article>}<div className="flex h-8 items-center border border-white/8 bg-black/20 px-2 text-[9px] text-[#63756f]" aria-disabled="true">Q1_COPILOT_CONTEXT_CONTRACT_UNAVAILABLE<Send className="ml-auto h-3 w-3" /></div></div>;
}

function AlertRail({ model }: { model: OpsQuantDashboardQ1Model }) { return <div className="space-y-1">{model.alerts.slice(0, 2).map((alert) => <article key={alert.alertId} className="grid grid-cols-[18px_1fr_auto] gap-2 border border-white/8 bg-black/15 p-2"><AlertTriangle className={`mt-0.5 h-3.5 w-3.5 ${alert.severity === "critical" ? "text-rose-300" : alert.severity === "warning" ? "text-amber-300" : "text-cyan-300"}`} /><div><h3 className="text-[10px] font-medium text-white">{alert.title}</h3><p className="mt-0.5 line-clamp-2 text-[9px] leading-4 text-[#78908a]">{alert.detail}</p></div><TruthBadge truth={alert.truth} /></article>)}{!model.alerts.length && <p className="py-4 text-center text-[10px] text-[#71837d]">Không có alert đủ evidence.</p>}</div>; }

function PressureMatrix({ model }: { model: OpsQuantDashboardQ1Model }) { return <div className="overflow-x-auto"><table className="min-w-[840px] w-full text-left text-[10px]"><thead className="border-b border-white/8 uppercase tracking-[0.08em] text-[#71837d]"><tr><th className="px-2 py-2">Event</th><th className="px-2 py-2">Start</th><th className="px-2 py-2">State</th><th className="px-2 py-2">Confirmed</th><th className="px-2 py-2">Center</th><th className="px-2 py-2">Required</th><th className="px-2 py-2">GTD stress</th><th className="px-2 py-2">Authority</th></tr></thead><tbody>{model.pressureRows.map((row) => <tr key={row.eventId} className={`border-b border-white/6 ${row.eventId === model.selectedEvent?.eventId ? "bg-cyan-300/[0.035]" : ""}`}><td className="px-2 py-2 font-medium text-white">{row.eventName}</td><td className="px-2 py-2 font-mono text-[#91a49b]">{formatDate(row.startTime)}</td><td className="px-2 py-2 text-[#91a49b]">{row.state}</td><td className="px-2 py-2 font-mono text-cyan-200">{formatNumber(row.confirmedEntries)}</td><td className="px-2 py-2 font-mono text-fuchsia-200">{nullableNumber(row.center)}</td><td className="px-2 py-2 font-mono text-[#d8bc85]">{nullableNumber(row.requiredEntries)}</td><td className="px-2 py-2"><PressureBadge status={row.gtdStatus} /></td><td className="px-2 py-2 font-mono text-[9px] text-[#71837d]">{row.forecastStatus} · N={row.sampleSize}</td></tr>)}</tbody></table>{!model.pressureRows.length && <p className="py-8 text-center font-mono text-xs text-[#71837d]">EMPTY EXACT · Không có event trong Q0 window.</p>}</div>; }

function CapacityPanel({ model, seatsPerTable, onSeatsPerTable }: { model: OpsQuantDashboardQ1Model; seatsPerTable: number | null; onSeatsPerTable: (value: number | null) => void }) {
  const base = model.scenarios.find((item) => item.scenarioId === "base" || item.scenarioId === "baseline");
  return <div><div className="grid grid-cols-3 gap-px bg-white/8"><MiniStat label="Allocated" value={model.capacity.eventAllocatedTableCount} /><MiniStat label="Dealers assigned" value={model.capacity.eventAssignedDealerCount} /><MiniStat label="Club configured" value={model.capacity.clubConfiguredTableCount} /></div><label className="mt-3 block"><span className="text-[9px] uppercase tracking-[0.08em] text-[#71837d]">Seats / table assumption</span><Input type="number" min={1} value={seatsPerTable ?? ""} onChange={(event) => onSeatsPerTable(parsePositive(event.target.value))} placeholder="Required for table demand" className="mt-1 h-8 rounded-[4px] border-white/10 bg-black/25 text-xs" /></label><div className="mt-3 grid grid-cols-2 gap-2"><MiniStat label="Required tables" value={base?.requiredTables ?? null} /><MiniStat label="Additional dealers" value={base?.additionalDealerNeed ?? null} /></div><div className="mt-3 flex items-center justify-between border border-white/8 p-2"><span className="text-[10px] text-[#91a49b]">Capacity state</span><PressureBadge status={base?.capacityStatus ?? "UNAVAILABLE"} /></div><p className="mt-2 text-[9px] leading-4 text-[#71837d]">Club-wide open tables and dealers are context, not committed capacity for this event.</p></div>;
}

function EconomicsPanel({ model }: { model: OpsQuantDashboardQ1Model }) { const rows = [["Canonical GTD", model.economics.gtd], ["Prize contribution / entry", model.economics.prizeContributionPerEntry], ["Required entries", model.economics.requiredEntries], ["Confirmed prize pool", model.economics.confirmedPrizePool], ["Current overlay", model.economics.currentOverlay], ["Current surplus", model.economics.currentSurplus]] as const; return <dl className="space-y-1.5">{rows.map(([label, item]) => <div key={label} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 border-b border-white/6 py-1.5"><dt className="text-[10px] text-[#91a49b]">{label}</dt><dd className="font-mono text-[11px] tabular-nums text-white">{item.value === null ? "—" : label === "Required entries" ? formatNumber(item.value) : formatVnd(item.value)}</dd><TruthBadge truth={item.truth} /></div>)}</dl>; }

function ScenarioPanel({ model, customEntries, customGtd, onEntries, onGtd }: { model: OpsQuantDashboardQ1Model; customEntries: number | null; customGtd: number | null; onEntries: (value: number | null) => void; onGtd: (value: number | null) => void }) { return <div><div className="grid grid-cols-3 gap-1.5">{model.scenarios.filter((item) => item.scenarioId !== "custom").map((scenario) => <article key={scenario.scenarioId} className="border border-fuchsia-300/15 bg-fuchsia-300/[0.035] p-2"><p className="text-[8px] uppercase tracking-[0.06em] text-fuchsia-200">{scenario.label}</p><p className="mt-2 font-mono text-lg text-white">{nullableNumber(scenario.entries)}</p><p className="mt-1 font-mono text-[9px] text-[#78908a]">Tables {nullableNumber(scenario.requiredTables)}</p><p className="font-mono text-[9px] text-[#78908a]">Overlay {scenario.overlay === null ? "—" : formatVndShort(scenario.overlay)}</p></article>)}</div><div className="mt-3 border border-dashed border-cyan-300/20 p-2"><p className="text-[9px] font-semibold uppercase tracking-[0.08em] text-cyan-200">Custom · Owner override</p><div className="mt-2 grid grid-cols-2 gap-2"><Input type="number" min={1} value={customEntries ?? ""} onChange={(event) => onEntries(parsePositive(event.target.value))} placeholder="Entries" className="h-8 rounded-[4px] border-white/10 bg-black/25 text-xs" /><Input type="number" min={1} value={customGtd ?? ""} onChange={(event) => onGtd(parsePositive(event.target.value))} placeholder="Custom GTD" className="h-8 rounded-[4px] border-white/10 bg-black/25 text-xs" /></div><p className="mt-2 font-mono text-[8px] text-[#71837d]">LOCAL SCENARIO · NOT SAVED · standard bands unchanged</p></div></div>; }

function HeaderField({ label, value, badge }: { label: string; value: string; badge: string }) { return <div><p className="text-[9px] uppercase tracking-[0.1em] text-[#71837d]">{label}</p><div className="mt-1 flex h-9 items-center gap-2 border border-white/10 bg-black/25 px-2 text-xs text-white"><span className="truncate">{value}</span><span className="ml-auto border border-emerald-300/20 px-1 font-mono text-[8px] text-emerald-200">{badge}</span></div></div>; }
function HeaderStat({ label, value, tone = "normal" }: { label: string; value: string; tone?: "normal" | "good" | "warn" }) { return <div><p className="text-[8px] uppercase tracking-[0.08em] text-[#71837d]">{label}</p><p className={`mt-1 font-mono text-[10px] font-semibold ${tone === "good" ? "text-emerald-200" : tone === "warn" ? "text-amber-200" : "text-white"}`}>{value}</p></div>; }
function MiniStat({ label, value }: { label: string; value: number | null }) { return <div className="bg-black/20 p-2"><p className="text-[8px] uppercase tracking-[0.06em] text-[#71837d]">{label}</p><p className="mt-1 font-mono text-lg text-white">{nullableNumber(value)}</p></div>; }
function TruthBadge({ truth }: { truth: QuantTruthClass }) { const tone = truth === "OBSERVED" ? "text-cyan-200" : truth === "DERIVED" ? "text-emerald-200" : truth === "HYPOTHESIS" ? "text-fuchsia-200" : "text-rose-200"; return <span className={`font-mono text-[7px] uppercase ${tone}`}>{truth}</span>; }
function PressureBadge({ status }: { status: QuantPressureStatus }) { const tone = status === "PRESSURE" ? "border-rose-300/25 text-rose-200" : status === "WATCH" ? "border-amber-300/25 text-amber-200" : status === "ON_TRACK" ? "border-emerald-300/25 text-emerald-200" : status === "PLANNING_SCENARIO" ? "border-cyan-300/25 text-cyan-200" : "border-white/10 text-[#71837d]"; return <span className={`inline-flex border px-1.5 py-0.5 font-mono text-[8px] ${tone}`}>{status.replace(/_/g, " ")}</span>; }

function acceptedPulse(result: { ok: true; value: SeriesClubLivePulseV1 } | { ok: false; error: string } | null): SeriesClubLivePulseV1 | null { return result?.ok ? result.value : null; }
function pulseAvailabilityOf(pulse: SeriesClubLivePulseV1 | null): OpsSourceAvailabilityV1 { if (!pulse) return "unavailable"; if (pulse.dataQuality.unavailableMetricIds.length || pulse.dataQuality.partialMetricIds.length) return "partial"; if (pulse.dataQuality.staleMetricIds.length) return "stale"; return "exact"; }
function registrationAvailabilityOf(value: OpsRegistrationPaceQ0 | null): OpsSourceAvailabilityV1 { if (!value) return "unavailable"; return value.events.some((event) => event.timelineAvailability === "partial") ? "partial" : "exact"; }
function sepayAvailabilityOf(value: OpsSepayReadStateQ0 | null): OpsSourceAvailabilityV1 { if (!value) return "unavailable"; return value.buckets.some((bucket) => bucket.amountAvailability === "partial") ? "partial" : "exact"; }
function headlineStatus(pulse: OpsSourceAvailabilityV1, operations: OpsSourceAvailabilityV1): string { if (pulse === "unavailable" && operations === "unavailable") return "UNAVAILABLE"; if ([pulse, operations].some((value) => value === "unavailable" || value === "partial")) return "PARTIAL"; if ([pulse, operations].includes("stale")) return "STALE"; return "LIVE"; }
function emptyOperations(): OpsLiveOperationInputV1 { return Object.freeze({ observedAt: PENDING_AT, asOf: null, availability: "unavailable", reasonCode: "OPS_LIVE_PENDING", rows: Object.freeze([]), runningTournamentIds: Object.freeze([]), openTableCount: null, configuredTableCount: null, operationalTableCount: null, dealersOnDutyCount: null, countComparisonEligible: false }); }
function parsePositive(raw: string): number | null { if (!raw.trim()) return null; const value = Number(raw); return Number.isFinite(value) && value > 0 ? value : null; }
function availabilityDot(value: OpsSourceAvailabilityV1): string { return value === "exact" ? "bg-emerald-300" : value === "unavailable" ? "bg-rose-300" : "bg-amber-300"; }
function nullableNumber(value: number | null | undefined): string { return value === null || value === undefined ? "—" : formatNumber(value); }
function formatNumber(value: number): string { return value.toLocaleString("vi-VN", { maximumFractionDigits: 1 }); }
function formatVnd(value: number): string { return `${value.toLocaleString("vi-VN")} ₫`; }
function formatVndShort(value: number): string { return new Intl.NumberFormat("vi-VN", { notation: "compact", maximumFractionDigits: 1 }).format(value); }
function formatPct(value: number | null): string { return value === null ? "—" : `${value.toFixed(1)}%`; }
function formatDate(value: string): string { return new Date(value).toLocaleString("vi-VN", { day: "2-digit", month: "2-digit", hour: "2-digit", minute: "2-digit" }); }
function formatTime(value: string): string { return Number.isFinite(Date.parse(value)) ? new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", second: "2-digit" }) : "—"; }
function formatInTimezone(value: string, timezone: string | null): string { if (!timezone || !Number.isFinite(Date.parse(value))) return "—"; try { return new Intl.DateTimeFormat("vi-VN", { timeZone: timezone, hour: "2-digit", minute: "2-digit", second: "2-digit" }).format(new Date(value)); } catch { return "—"; } }
