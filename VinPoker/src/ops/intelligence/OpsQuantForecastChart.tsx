import { CartesianGrid, ComposedChart, Line, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import type { QuantForecastQ1, QuantSelectedEventQ1 } from "./opsQuantDashboardQ1";

export function OpsQuantForecastChart({ selectedEvent, forecast }: { selectedEvent: QuantSelectedEventQ1 | null; forecast: QuantForecastQ1 }) {
  if (!selectedEvent) return <Empty reason="Chưa có giải hợp lệ được chọn" />;
  return <>
    <ObservedChart selectedEvent={selectedEvent} />
    <div data-testid="forecast-final-summary" className="mt-2 border-t border-fuchsia-300/20 pt-2 text-xs text-fuchsia-200">
      <p>Tổng entries cuối giải · {forecast.truth}</p>
      <p className="mt-1 font-mono">{forecast.status === "full_model" ? `P10 ${forecast.low} · Center ${forecast.center} · P90 ${forecast.high}` : forecast.status === "baseline_only" ? `Baseline ${forecast.baseline}` : "UNAVAILABLE · Chưa đủ dữ liệu dự báo"}</p>
      <p className="mt-1 text-[#91a49b]">Chưa có thời điểm đích xác minh; không neo dự báo vào giờ mở giải.</p>
    </div>
  </>;
}

function ObservedChart({ selectedEvent }: { selectedEvent: QuantSelectedEventQ1 }) {
  const data = selectedEvent.registration.timeline.map((bucket) => ({
    timestamp: Date.parse(bucket.bucketStart),
    cumulativeCount: bucket.cumulativeCount,
  })).filter((point) => Number.isFinite(point.timestamp));
  if (!data.length) return <Empty reason="Chưa có quan sát theo giờ để vẽ" />;
  const maxY = Math.ceil(Math.max(10, ...data.map((point) => point.cumulativeCount)) / 10) * 10;
  const minX = data[0].timestamp;
  const maxX = data[data.length - 1].timestamp;

  return <div className="h-[210px] w-full" data-testid="ops-quant-demand-chart">
    <ResponsiveContainer width="100%" height="100%">
      <ComposedChart data={data} margin={{ top: 12, right: 18, bottom: 4, left: 0 }}>
        <CartesianGrid stroke="rgba(148,163,184,0.10)" vertical={false} />
        <XAxis dataKey="timestamp" type="number" domain={[minX, maxX]} tickFormatter={formatHour} tick={{ fill: "#71837d", fontSize: 10 }} axisLine={{ stroke: "rgba(255,255,255,.12)" }} tickLine={false} />
        <YAxis domain={[0, maxY]} allowDecimals={false} tick={{ fill: "#71837d", fontSize: 10 }} axisLine={false} tickLine={false} width={42} />
        <Tooltip content={<ObservedTooltip />} />
        <Line type="monotone" dataKey="cumulativeCount" stroke="#4de8ee" strokeWidth={2} dot={{ r: 2.5, fill: "#4de8ee", strokeWidth: 0 }} activeDot={{ r: 4 }} isAnimationActive={false} connectNulls={false} />
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
