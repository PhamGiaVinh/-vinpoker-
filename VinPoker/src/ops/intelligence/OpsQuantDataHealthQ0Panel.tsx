import { useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, Database, Landmark, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { loadOpsRegistrationPaceQ0, loadOpsSepayReadStateQ0 } from "./opsQuantDataHealthAdapter";
import { buildOpsDataHealthQ0, type OpsDataHealthRowQ0, type OpsRegistrationPaceQ0, type OpsSepayReadStateQ0 } from "./opsQuantDataHealthQ0";
import type { OpsSourceStateV1 } from "./opsIntelligenceReadModel";

const Q0_SOURCE_IDS = new Set(["registration-pace", "sepay", "event-stream"]);

export function OpsQuantDataHealthQ0Panel({ clubId, baselineSources }: { clubId: string; baselineSources: readonly OpsSourceStateV1[] }) {
  const client = useSupabaseClient();
  const registration = useQuery({
    queryKey: ["ops", clubId, "quant-q0", "registration"],
    queryFn: () => loadOpsRegistrationPaceQ0(client, clubId),
  });
  const sepay = useQuery({
    queryKey: ["ops", clubId, "quant-q0", "sepay"],
    queryFn: () => loadOpsSepayReadStateQ0(client, clubId),
  });
  const observedFallback = registration.data?.observedAt ?? sepay.data?.observedAt ?? "1970-01-01T00:00:00.000Z";
  const q0Health = useMemo(() => buildOpsDataHealthQ0({
    registration: registration.data ?? { value: null, observedAt: observedFallback, reasonCode: registration.isPending ? "SOURCE_PENDING" : "REGISTRATION_PACE_READ_FAILED" },
    sepay: sepay.data ?? { value: null, observedAt: observedFallback, reasonCode: sepay.isPending ? "SOURCE_PENDING" : "SEPAY_READ_FAILED" },
    eventStreamObservedAt: observedFallback,
  }), [observedFallback, registration.data, registration.isPending, sepay.data, sepay.isPending]);
  const health = useMemo(() => [
    ...baselineSources.filter((source) => !Q0_SOURCE_IDS.has(source.sourceId)).map(toBaselineHealth),
    ...q0Health,
  ], [baselineSources, q0Health]);

  return <section className="space-y-4" data-testid="ops-quant-data-health-q0">
    <div className="flex items-center justify-between border border-sky-300/15 bg-[#07100c] px-4 py-3">
      <div>
        <p className="text-[10px] font-semibold uppercase tracking-[0.16em] text-sky-300">Quant Data Health Q0</p>
        <h2 className="mt-1 text-sm font-semibold text-white">Dữ liệu quan sát, không dự báo</h2>
      </div>
      <Button type="button" size="sm" variant="outline" onClick={() => void Promise.allSettled([registration.refetch(), sepay.refetch()])}>
        <RefreshCw className="mr-2 h-3.5 w-3.5" /> Làm mới Q0
      </Button>
    </div>

    <div className="grid grid-cols-12 gap-4">
      <RegistrationPanel value={registration.data?.value ?? null} reasonCode={registration.data?.reasonCode ?? (registration.isPending ? "SOURCE_PENDING" : "REGISTRATION_PACE_READ_FAILED")} />
      <SepayPanel value={sepay.data?.value ?? null} reasonCode={sepay.data?.reasonCode ?? (sepay.isPending ? "SOURCE_PENDING" : "SEPAY_READ_FAILED")} />
      <section className="col-span-12 border border-white/10 bg-[#07100c] p-4 xl:col-span-3" aria-labelledby="q0-event-stream">
        <PanelTitle id="q0-event-stream" icon={<Activity className="h-4 w-4" />} title="Event stream" detail="Nguồn append-only phải qua allowlist" />
        <Unavailable reason="EVENT_SOURCE_NOT_APPROVED" />
      </section>
    </div>

    <section className="border border-white/10 bg-[#07100c]" aria-labelledby="q0-data-health">
      <div className="border-b border-white/8 px-4 py-3">
        <PanelTitle id="q0-data-health" icon={<Database className="h-4 w-4" />} title="Data Health" detail="Authority · grain · receipt · reason" />
      </div>
      <div className="overflow-x-auto">
        <table className="min-w-full text-left text-xs">
          <thead className="border-b border-white/8 text-[10px] uppercase tracking-[0.1em] text-[#73867c]"><tr><th className="px-4 py-3">Nguồn</th><th className="px-4 py-3">Authority / Grain</th><th className="px-4 py-3">Loại</th><th className="px-4 py-3">Tình trạng</th><th className="px-4 py-3">As-of / Receipt</th></tr></thead>
          <tbody>{health.map((row) => <HealthRow key={row.sourceId} row={row} />)}</tbody>
        </table>
      </div>
    </section>
  </section>;
}

function RegistrationPanel({ value, reasonCode }: { value: OpsRegistrationPaceQ0 | null; reasonCode: string | null }) {
  return <section className="col-span-12 border border-white/10 bg-[#07100c] p-4 xl:col-span-5" aria-labelledby="q0-registration">
    <PanelTitle id="q0-registration" icon={<Activity className="h-4 w-4" />} title="Nhịp đăng ký quan sát" detail="Confirmed entries theo giờ · không nowcast" />
    {!value ? <Unavailable reason={reasonCode ?? "REGISTRATION_PACE_UNAVAILABLE"} /> : value.events.length === 0 ? <EmptyExact label="Không có giải trong cửa sổ quan sát." /> : <div className="mt-4 space-y-3">
      {value.events.slice(0, 6).map((event) => <article key={event.eventId} className="border border-white/8 bg-black/20 p-3">
        <div className="flex flex-wrap items-start justify-between gap-2"><div><h3 className="text-xs font-semibold text-white">{event.eventName}</h3><p className="mt-1 font-mono text-[10px] text-[#73867c]">{event.eventState} · {formatTimestamp(event.startTime)}</p></div><span className="font-mono text-lg font-semibold tabular-nums text-emerald-200">{formatNumber(event.confirmedEntries)}</span></div>
        <div className="mt-3 grid grid-cols-2 gap-2 text-[11px] text-[#91a49b]"><span>Unique: <b className="font-mono text-white">{formatNumber(event.uniquePlayers)}</b></span><span>Re-entry: <b className="font-mono text-white">{formatNumber(event.reentries)}</b></span><span>1h / 6h / 24h: <b className="font-mono text-white">{event.last1h} / {event.last6h} / {event.last24h}</b></span><span>Gần nhất: <b className="font-mono text-white">{event.lastRegistrationAt ? formatTimestamp(event.lastRegistrationAt) : "chưa có"}</b></span></div>
        <div className="mt-3 flex flex-wrap gap-1.5" aria-label="Confirmed entries theo giờ">{event.timeline.map((bucket) => <span key={bucket.bucketStart} className="border border-white/8 px-2 py-1 font-mono text-[10px] text-[#b9c8c0]">{formatHour(bucket.bucketStart)} · +{bucket.observedCount} · Σ{bucket.cumulativeCount}</span>)}</div>
        {event.timelineReasonCode && <p className="mt-2 font-mono text-[10px] text-amber-200">{event.timelineReasonCode}</p>}
      </article>)}
    </div>}
  </section>;
}

function SepayPanel({ value, reasonCode }: { value: OpsSepayReadStateQ0 | null; reasonCode: string | null }) {
  return <section className="col-span-12 border border-white/10 bg-[#07100c] p-4 xl:col-span-4" aria-labelledby="q0-sepay">
    <PanelTitle id="q0-sepay" icon={<Landmark className="h-4 w-4" />} title="SePay read state" detail="Tổng hợp 24 giờ · không lộ giao dịch" />
    {!value ? <Unavailable reason={reasonCode ?? "SEPAY_UNAVAILABLE"} /> : <><p className="mt-3 font-mono text-[10px] text-[#73867c]">Giao dịch gần nhất: {value.latestObservedTransactionAt ? formatTimestamp(value.latestObservedTransactionAt) : "chưa có"}</p><dl className="mt-3 space-y-2">{value.buckets.map((bucket) => <div key={bucket.state} className="grid grid-cols-[1fr_auto] gap-3 border border-white/8 bg-black/20 p-3"><dt className="text-xs capitalize text-[#b9c8c0]">{stateLabel(bucket.state)}<p className="mt-1 font-mono text-[10px] text-[#73867c]">{bucket.amountReasonCode ?? "AMOUNT_EXACT"}</p></dt><dd className="text-right"><p className="font-mono text-sm font-semibold tabular-nums text-white">{bucket.transactionCount} giao dịch</p><p className="mt-1 font-mono text-xs tabular-nums text-[#d8bc85]">{formatVnd(bucket.inboundAmountVnd)}</p></dd></div>)}</dl></>}
  </section>;
}

function HealthRow({ row }: { row: OpsDataHealthRowQ0 }) {
  return <tr className="border-b border-white/6 last:border-0"><td className="px-4 py-3 font-medium text-white">{row.label}<p className="mt-1 font-mono text-[10px] text-[#65786e]">{row.sourceId}</p></td><td className="px-4 py-3 text-[#91a49b]">{row.authority}<p className="mt-1 font-mono text-[10px]">{row.grain}</p></td><td className="px-4 py-3 font-mono text-[10px] text-sky-200">{row.classification}</td><td className="px-4 py-3"><span className={row.availability === "exact" ? "text-emerald-200" : row.availability === "partial" || row.availability === "stale" ? "text-amber-200" : "text-rose-200"}>{row.availability.toUpperCase()}</span>{row.reasonCode && <p className="mt-1 font-mono text-[10px] text-amber-200">{row.reasonCode}</p>}</td><td className="px-4 py-3 font-mono text-[10px] leading-4 text-[#73867c]">{row.asOf ?? "no source as-of"}<br />{row.observedAt}</td></tr>;
}

function toBaselineHealth(source: OpsSourceStateV1): OpsDataHealthRowQ0 {
  return Object.freeze({ sourceId: source.sourceId, label: source.label, authority: source.sourceId, grain: "existing_v1_contract", classification: source.sourceId === "finance-summary" || source.sourceId === "owner-daily-digest" ? "DERIVED" : "OBSERVED", availability: source.availability, asOf: source.asOf, observedAt: source.observedAt, freshness: source.availability === "stale" ? "stale" : "unknown", reasonCode: source.reasonCode });
}
function PanelTitle({ id, icon, title, detail }: { id: string; icon: React.ReactNode; title: string; detail: string }) { return <div className="flex items-start gap-2"><span className="mt-0.5 text-sky-300">{icon}</span><div><h2 id={id} className="text-sm font-semibold text-white">{title}</h2><p className="mt-0.5 text-xs text-[#73867c]">{detail}</p></div></div>; }
function Unavailable({ reason }: { reason: string }) { return <p className="mt-4 border border-dashed border-rose-300/20 px-3 py-4 font-mono text-xs text-[#91a49b]">UNAVAILABLE · {reason}</p>; }
function EmptyExact({ label }: { label: string }) { return <p className="mt-4 border border-dashed border-emerald-300/20 px-3 py-4 text-xs text-[#91a49b]">EMPTY EXACT · {label}</p>; }
function formatNumber(value: number): string { return value.toLocaleString("vi-VN"); }
function formatVnd(value: number): string { return `${formatNumber(value)} ₫`; }
function formatTimestamp(value: string): string { return new Date(value).toLocaleString("vi-VN"); }
function formatHour(value: string): string { return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }); }
function stateLabel(state: "actionable" | "resolved" | "quarantined"): string { return { actionable: "Cần đối soát", resolved: "Đã xử lý", quarantined: "Cách ly" }[state]; }
