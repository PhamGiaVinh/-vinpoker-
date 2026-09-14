import { useEffect, useMemo, useState, type Dispatch, type SetStateAction } from "react";
import { useQuery } from "@tanstack/react-query";
import { Activity, ArrowUpRight, CircleAlert, Database, UsersRound } from "lucide-react";
import { CartesianGrid, ComposedChart, Line, ReferenceArea, ResponsiveContainer, Tooltip, XAxis, YAxis } from "recharts";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import type { QuantSourceReceiptsQ1 } from "./opsQuantDashboardQ1";
import type { FestivalContextV1, OpsIntelligenceScopeV1 } from "./opsIntelligenceContextV1";
import type { OverviewSourceV1 } from "./opsIntelligenceOverviewV1";
import { buildAlignedTimelineRows, latestTimelineValue, type OpsIntelligenceTimelineV1 } from "./opsIntelligenceTimelineV1";
import { timelineQueryOptions } from "./opsIntelligenceTimelineQuery";

type TimelineScope = Extract<OpsIntelligenceScopeV1, { tournamentId: string }>;

export function OpsIntelligenceTimelineSection(props: {
  clubId: string;
  scope: OpsIntelligenceScopeV1;
  festival: FestivalContextV1 | null;
  navigate: (scope: OpsIntelligenceScopeV1, tab: "overview" | "quant" | "live" | "health") => void;
  receipts: QuantSourceReceiptsQ1;
  onReceiptsChange: Dispatch<SetStateAction<QuantSourceReceiptsQ1>>;
  onSourceState: (source: OverviewSourceV1) => void;
}) {
  if (props.scope.kind === "club") return null;
  if (props.scope.kind === "festival") {
    return <FestivalTimelineReadiness festival={props.festival} navigate={props.navigate} />;
  }
  return <TimelineReader {...props} scope={props.scope} />;
}

function FestivalTimelineReadiness({ festival, navigate }: { festival: FestivalContextV1 | null; navigate: (scope: OpsIntelligenceScopeV1, tab: "overview") => void }) {
  const children = festival?.tournaments.filter((row) => row.phase === "flight" || row.phase === "final") ?? [];
  return <section data-testid="operational-timeline-festival-readiness" className="border border-white/10 bg-[#050b0d]">
    <header className="border-b border-white/10 p-3"><p className="font-mono text-[10px] text-cyan-300">VẬN HÀNH THEO THỜI GIAN</p><h2 className="mt-1 text-sm font-semibold text-white">Chọn đúng Flight hoặc Final</h2><p className="mt-1 text-xs text-[#8da09a]">Festival không cộng người, bàn, dealer hoặc GTD giữa các giải con.</p></header>
    <div className="grid grid-cols-2 gap-px bg-white/10">{children.map((row) => <button key={row.tournamentId} type="button" onClick={() => navigate({ kind: row.phase as "flight" | "final", festivalId: festival!.festivalId, tournamentId: row.tournamentId }, "overview")} className="flex min-h-16 items-center justify-between bg-[#071014] p-3 text-left hover:bg-[#0a171a] focus-visible:outline focus-visible:outline-2 focus-visible:outline-cyan-300"><span><strong className="block text-white">{row.name}</strong><small className="text-[#8da09a]">{row.phase === "final" ? "FINAL" : `FLIGHT ${row.flightLabel ?? "CHƯA CÓ NHÃN"}`}</small></span><ArrowUpRight className="h-4 w-4 text-cyan-300" /></button>)}{!children.length && <p className="col-span-2 bg-[#071014] p-3 text-amber-100">Chưa có giải con mang vai trò Flight hoặc Final đã xác minh.</p>}</div>
  </section>;
}

function TimelineReader({ clubId, scope, receipts, onReceiptsChange, onSourceState }: { clubId: string; scope: TimelineScope; receipts: QuantSourceReceiptsQ1; onReceiptsChange: Dispatch<SetStateAction<QuantSourceReceiptsQ1>>; onSourceState: (source: OverviewSourceV1) => void }) {
  const client = useSupabaseClient();
  const query = useQuery(timelineQueryOptions(client, clubId, scope.tournamentId));
  const [sourceOpen, setSourceOpen] = useState(false);
  const accepted = query.isError ? null : query.data ?? null;
  useEffect(() => {
    if (!accepted) return;
    const next = { asOf: accepted.value.asOf, observedAt: accepted.observedAt };
    onReceiptsChange((previous) => previous["overview:operational-timeline"]?.asOf === next.asOf && previous["overview:operational-timeline"]?.observedAt === next.observedAt ? previous : { ...previous, "overview:operational-timeline": next });
  }, [accepted, onReceiptsChange]);
  useEffect(() => {
    if (query.isPending) return;
    if (!accepted) {
      onSourceState({ id: "timeline", label: "Operational timeline", definition: "Entry lifecycle, table sessions, dealer assignments và GTD registrations theo exact tournament.", availability: "unavailable", asOf: null, observedAt: null, reason: "TIMELINE_READ_UNAVAILABLE" });
      return;
    }
    const parts = [accepted.value.entries, accepted.value.tables, { availability: accepted.value.tables.capacityAvailability, reasonCode: accepted.value.tables.capacityReasonCode }, accepted.value.dealers, accepted.value.gtd];
    const unavailable = parts.find((part) => part.availability === "unavailable");
    const partial = parts.find((part) => part.availability === "partial");
    onSourceState({ id: "timeline", label: "Operational timeline", definition: "Entry lifecycle, table sessions, dealer assignments và GTD registrations theo exact tournament.", availability: unavailable ? "unavailable" : partial ? "partial" : "exact", asOf: accepted.value.asOf, observedAt: accepted.observedAt, reason: (unavailable ?? partial)?.reasonCode ?? null });
  }, [accepted, onSourceState, query.isPending]);

  if (query.isPending) return <TimelineFrame><p className="p-4 text-[#a1b4ad]">Đang đọc timeline aggregate của giải…</p></TimelineFrame>;
  if (!accepted) return <TimelineFrame><div className="flex items-center justify-between gap-3 p-4"><p className="text-amber-100">Không đọc được timeline. Không diễn giải thành 0.</p><Button variant="outline" size="sm" onClick={() => void query.refetch()}>Đọc lại</Button></div></TimelineFrame>;
  const value = accepted.value;
  const rows = buildAlignedTimelineRows(value);
  const currentEntries = latestTimelineValue(value.entries.points) ?? (value.entries.availability === "exact" ? 0 : null);
  const currentTables = latestTimelineValue(value.tables.points) ?? (value.tables.availability === "exact" ? 0 : null);
  const currentDealers = value.dealers.availability === "exact" ? latestTimelineValue(value.dealers.points) ?? 0 : null;
  const currentPool = latestTimelineValue(value.gtd.points) ?? (value.gtd.availability === "exact" ? 0 : null);
  const currentCapacity = value.tables.capacityAvailability === "exact" ? value.tables.points.at(-1)?.seatCapacity ?? 0 : null;
  const exactCoverage = value.tables.availability === "exact" && value.dealers.availability === "exact";
  return <TimelineFrame>
    <div className="flex flex-wrap items-start justify-between gap-3 border-b border-white/10 p-3">
      <div><p className="font-mono text-[10px] text-cyan-300">VẬN HÀNH THEO THỜI GIAN</p><h2 className="mt-1 text-sm font-semibold text-white">Timeline quan sát · một giải chính xác</h2><p className="mt-1 text-xs text-[#8da09a]">Step points từ sự kiện server; không nội suy, không dự báo.</p></div>
      <Button variant="outline" size="sm" onClick={() => setSourceOpen(true)}><Database className="mr-2 h-4 w-4" />Nguồn</Button>
    </div>
    <div className="grid grid-cols-5 divide-x divide-white/10 border-b border-white/10 bg-[#071014]">
      <Summary label="Đang ngồi" value={currentEntries} availability={value.entries.availability} suffix="entries" tone="cyan" />
      <Summary label="Bàn mở cho giải" value={currentTables} availability={value.tables.availability} suffix="bàn" tone="green" />
      <Summary label="Sức chứa quan sát" value={currentCapacity} availability={value.tables.capacityAvailability} suffix="ghế" tone="amber" />
      <Summary label="Dealer gắn session" value={currentDealers} availability={value.dealers.availability} suffix="dealer" tone="green" />
      <Summary label={value.gtd.guaranteeState === "no_guarantee" ? "Không có guarantee" : "Prize contribution"} value={value.gtd.guaranteeState === "unavailable" ? null : currentPool} availability={value.gtd.availability} suffix="₫" tone="gold" money />
    </div>
    {!rows.length ? <p className="p-4 text-[#a1b4ad]">Nguồn exact hiện chưa có event point nào; đây là chưa quan sát, không phải một đường bằng 0.</p> : <div className="grid grid-cols-3 divide-x divide-white/10">
      <TimelineChart title="NGƯỜI ĐANG NGỒI" icon={<UsersRound className="h-4 w-4" />} rows={rows} lines={[{ key: "entries", label: "Entries active", color: "#67e8f9" }, ...(value.tables.capacityAvailability === "exact" ? [{ key: "capacity" as const, label: "Sức chứa", color: "#fbbf24" }] : [])]} />
      <TimelineChart title="BÀN / DEALER" icon={<Activity className="h-4 w-4" />} rows={rows} lines={[{ key: "tables", label: "Bàn", color: "#67e8f9" }, ...(value.dealers.availability === "exact" ? [{ key: "dealers" as const, label: "Dealer", color: "#6ee7b7" }] : [])]} gaps={exactCoverage ? value.dealerGaps : []} />
      <TimelineChart title="GTD COVERAGE" icon={<Activity className="h-4 w-4" />} rows={rows} lines={value.gtd.availability === "exact" ? [{ key: "gtd", label: "Contribution", color: "#d6b45c" }] : []} guarantee={value.gtd.guaranteeState === "available" ? value.gtd.guaranteeAmount : null} />
    </div>}
    {value.dealerGaps.length > 0 && exactCoverage && <div className="border-t border-white/10 p-3"><p className="mb-2 text-xs font-semibold text-rose-200">DEALER GAP · khoảng quan sát, không kết luận nguyên nhân</p><div className="flex flex-wrap gap-2">{value.dealerGaps.map((gap) => <span key={`${gap.from}:${gap.to}`} className="border border-rose-300/25 bg-rose-400/5 px-2 py-1 font-mono text-[11px] text-rose-100">{formatTime(gap.from)}–{formatTime(gap.to)} · thiếu tối đa {gap.maxGap}</span>)}</div></div>}
    {!exactCoverage && <p className="border-t border-white/10 p-3 text-xs text-amber-100"><CircleAlert className="mr-2 inline h-4 w-4" />Dealer binding chưa exact; hệ thống không tạo kết luận thiếu dealer.</p>}
    <TimelineSourceSheet open={sourceOpen} onOpenChange={setSourceOpen} value={value} observedAt={receipts["overview:operational-timeline"]?.observedAt ?? accepted.observedAt} />
  </TimelineFrame>;
}

function TimelineFrame({ children }: { children: React.ReactNode }) { return <section data-testid="ops-intelligence-timeline-v1" className="overflow-hidden border border-cyan-300/15 bg-[#050b0d] text-[13px] text-[#c7d4d0]">{children}</section>; }
function Summary({ label, value, availability, suffix, tone, money = false }: { label: string; value: number | null; availability: "exact" | "partial" | "stale" | "unavailable"; suffix: string; tone: "cyan" | "green" | "amber" | "gold"; money?: boolean }) {
  const color = { cyan: "text-cyan-200", green: "text-emerald-200", amber: "text-amber-200", gold: "text-[#d6b45c]" }[tone];
  return <div className="min-w-0 p-3"><span className="block text-[10px] text-[#8da09a]">{label}</span><strong className={`mt-1 block truncate font-mono text-lg tabular-nums ${value === null ? "text-amber-200" : color}`}>{value === null ? "—" : value.toLocaleString("vi-VN")}</strong><span className="text-[10px] text-[#71827d]">{availability.toUpperCase()} · {value === null ? "—" : money ? "₫" : suffix}</span></div>;
}
type ChartRow = ReturnType<typeof buildAlignedTimelineRows>[number];
function TimelineChart({ title, icon, rows, lines, gaps = [], guarantee = null }: { title: string; icon: React.ReactNode; rows: ChartRow[]; lines: { key: keyof ChartRow; label: string; color: string }[]; gaps?: OpsIntelligenceTimelineV1["dealerGaps"]; guarantee?: number | null }) {
  const data = useMemo(() => rows.map((row) => ({ ...row, epoch: Date.parse(row.at) })), [rows]);
  const domain = data.length ? [data[0].epoch, data.at(-1)!.epoch] : [0, 1];
  const monetary = title === "GTD COVERAGE";
  return <section className="min-w-0 p-3"><div className="mb-2 flex items-center justify-between gap-2"><h3 className="flex items-center gap-2 text-[11px] font-semibold text-white">{icon}{title}</h3><div className="flex gap-2">{lines.map((line) => <span key={String(line.key)} className="text-[9px]" style={{ color: line.color }}>{line.label}</span>)}</div></div><div className="h-40" aria-label={title}>{lines.length ? <ResponsiveContainer width="100%" height="100%"><ComposedChart data={data} margin={{ top: 4, right: 4, bottom: 0, left: -8 }}><CartesianGrid stroke="rgba(255,255,255,.06)" vertical={false} /><XAxis dataKey="epoch" type="number" domain={domain} tickFormatter={(value) => formatTime(new Date(value).toISOString())} tick={{ fill: "#71827d", fontSize: 9 }} stroke="rgba(255,255,255,.08)" /><YAxis width={monetary ? 38 : 28} tickFormatter={(value) => monetary ? compactMoney(Number(value)) : String(value)} tick={{ fill: "#71827d", fontSize: 9 }} stroke="rgba(255,255,255,.08)" /><Tooltip contentStyle={{ background: "#071014", border: "1px solid rgba(255,255,255,.15)", borderRadius: 4, fontSize: 11 }} labelFormatter={(value) => new Date(Number(value)).toLocaleString("vi-VN")} formatter={(value: number) => value.toLocaleString("vi-VN")} />{gaps.map((gap) => <ReferenceArea key={`${gap.from}:${gap.to}`} x1={Date.parse(gap.from)} x2={Date.parse(gap.to)} fill="#fb7185" fillOpacity={0.08} />)}{guarantee !== null && <Line type="stepAfter" dataKey={() => guarantee} name="Guarantee" stroke="#f59e0b" strokeDasharray="4 4" dot={false} isAnimationActive={false} />}{lines.map((line) => <Line key={String(line.key)} type="stepAfter" dataKey={line.key} name={line.label} stroke={line.color} strokeWidth={2} dot={{ r: 2 }} connectNulls={false} isAnimationActive={false} />)}</ComposedChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center border border-dashed border-white/10 text-xs text-amber-100">UNAVAILABLE</div>}</div></section>;
}
function formatTime(value: string) { return new Date(value).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit" }); }
function compactMoney(value: number) { return value >= 1_000_000_000 ? `${(value / 1_000_000_000).toLocaleString("vi-VN", { maximumFractionDigits: 1 })}B` : value >= 1_000_000 ? `${Math.round(value / 1_000_000)}M` : value.toLocaleString("vi-VN"); }

function TimelineSourceSheet({ open, onOpenChange, value, observedAt }: { open: boolean; onOpenChange: (open: boolean) => void; value: OpsIntelligenceTimelineV1; observedAt: string }) {
  const sources = [
    ["Người đang ngồi", "Entries có seated_at <= T và chưa busted tại T", value.entries.availability, value.entries.reasonCode],
    ["Bàn", "table_sessions tournament theo exact tournamentId", value.tables.availability, value.tables.reasonCode],
    ["Sức chứa", "tournament_tables max_seats gắn exact table_session", value.tables.capacityAvailability, value.tables.capacityReasonCode],
    ["Dealer", "dealer_assignments interval gắn exact table_session", value.dealers.availability, value.dealers.reasonCode],
    ["GTD coverage", "Confirmed registrations × buy_in; không phải doanh thu", value.gtd.availability, value.gtd.reasonCode],
  ] as const;
  return <Sheet open={open} onOpenChange={onOpenChange}><SheetContent className="overflow-y-auto text-sm"><SheetHeader><SheetTitle>Nguồn timeline vận hành</SheetTitle><SheetDescription>Aggregate theo một tournaments.id; không chứa player/dealer identity.</SheetDescription></SheetHeader><dl className="mt-6 space-y-3"><div><dt>Scope</dt><dd>{value.tournamentId}</dd></div><div><dt>Server asOf</dt><dd>{value.asOf}</dd></div><div><dt>Lần đọc thành công</dt><dd>{observedAt}</dd></div></dl><div className="mt-6 space-y-3">{sources.map(([label, definition, availability, reason]) => <section key={label} className="border border-border p-3"><div className="flex justify-between gap-3"><strong>{label}</strong><span>{availability.toUpperCase()}</span></div><p className="mt-2 text-muted-foreground">{definition}</p><p className="mt-1 font-mono text-xs">{reason ?? "Nguồn exact"}</p></section>)}</div></SheetContent></Sheet>;
}
