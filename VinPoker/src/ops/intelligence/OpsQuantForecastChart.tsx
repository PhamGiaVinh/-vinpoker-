import { CartesianGrid, ComposedChart, Line, ReferenceDot, ReferenceLine, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QuantForecastQ1, QuantSelectedEventQ1 } from "./opsQuantDashboardQ1";

export function OpsQuantForecastChart({ selectedEvent, forecast }: { selectedEvent: QuantSelectedEventQ1 | null; forecast: QuantForecastQ1 }) {
  if (!selectedEvent) return <Empty reason="NO_EVENT_SELECTED" />;
  const data = selectedEvent.registration.timeline.map((bucket) => ({
    timestamp: Date.parse(bucket.bucketStart),
    cumulativeCount: bucket.cumulativeCount,
  })).filter((point) => Number.isFinite(point.timestamp));
  const eventTs = Date.parse(selectedEvent.startTime);
  const values = [selectedEvent.registration.confirmedEntries, forecast.low, forecast.center, forecast.high, forecast.baseline].filter((item): item is number => item !== null);
  const maxY = Math.max(10, ...values) * 1.15;
  const minX = data.length ? Math.min(data[0].timestamp, eventTs) : eventTs - 3_600_000;
  const maxX = Math.max(eventTs, data[data.length - 1]?.timestamp ?? eventTs) + 3_600_000;

  return <div className="h-[210px] w-full" data-testid="ops-quant-demand-chart">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, bottom: 4, left: -12 }}>
        <CartesianGrid stroke="rgba(148,163,184,0.10)" vertical={false} />
        <XAxis dataKey="timestamp" type="number" domain={[minX, maxX]} tickFormatter={formatHour} tick={{ fill: "#71837d", fontSize: 10 }} axisLine={{ stroke: "rgba(255,255,255,.12)" }} tickLine={false} />
        <YAxis domain={[0, maxY]} tick={{ fill: "#71837d", fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
        <Tooltip content={<ObservedTooltip />} />
        <Line type="monotone" dataKey="cumulativeCount" stroke="#4de8ee" strokeWidth={2} dot={{ r: 2.5, fill: "#4de8ee", strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
        {Number.isFinite(eventTs) && <ReferenceLine x={eventTs} stroke="rgba(217,70,239,.45)" strokeDasharray="3 4" label={{ value: "EVENT", fill: "#d8a5db", fontSize: 9, position: "insideTopRight" }} />}
        {forecast.status === "full_model" && forecast.low !== null && <ReferenceDot x={eventTs} y={forecast.low} r={4} fill="#d946ef" stroke="none" />}
        {forecast.status === "full_model" && forecast.center !== null && <ReferenceDot x={eventTs} y={forecast.center} r={5} fill="#fb5ee7" stroke="#ffd5fa" strokeWidth={1} />}
        {forecast.status === "full_model" && forecast.high !== null && <ReferenceDot x={eventTs} y={forecast.high} r={4} fill="#d946ef" stroke="none" />}
        {forecast.status === "baseline_only" && forecast.baseline !== null && <ReferenceDot x={eventTs} y={forecast.baseline} r={5} fill="#d8bc85" stroke="#fff2cf" strokeWidth={1} />}
      </ComposedChart>
    </ResponsiveContainer>
  </div>;
}

function ObservedTooltip({ active, payload, label }: { active?: boolean; payload?: Array<{ value?: number }>; label?: number }) {
  if (!active || !payload?.length || !label) return null;
  return <div className="border border-cyan-300/20 bg-[#061013] px-3 py-2 text-[10px] shadow-xl"><p className="font-mono text-[#78918c]">{new Date(label).toLocaleString("vi-VN")}</p><p className="mt-1 text-cyan-200">Observed · <b className="font-mono">{payload[0].value ?? "—"}</b></p></div>;
}

function Empty({ reason }: { reason: string }) { return <div className="flex h-[210px] items-center justify-center border border-dashed border-white/10 font-mono text-xs text-[#71837d]">UNAVAILABLE · {reason}</div>; }
function formatHour(value: number): string { return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }); }
