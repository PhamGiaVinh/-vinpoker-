import { useMemo, useState, type ReactNode } from "react";
import { FlaskConical, Play, Dices, AlertTriangle, Hand } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import type { Series } from "@/lib/series-intelligence/seriesLibrary";
import { groupEvents, computeGroupStats } from "@/lib/series-intelligence/referenceDistribution";
import {
  referenceGroupToLogNormal,
  computeCostFromDrivers,
  simulateFestival,
  type EventLogNormal,
  type CostDrivers,
  type SimResult,
  type AggregateTier,
} from "@/lib/series-intelligence/monteCarloEngine";

const TIER_VI: Record<AggregateTier, string> = {
  hypothesis: "Giả thuyết (N=1)",
  "observed-minmax": "Quan sát min-max",
  "observed-p20p80": "Quan sát p20-p80",
};

interface SelectableGroup {
  key: string;
  name: string;
  n: number;
  tier: AggregateTier | null;
  usable: boolean;
  reason: string | null;
  sim: EventLogNormal | null;
}

const emptyDrivers: CostDrivers = {};

/**
 * Forward-layer Monte Carlo — SCENARIO / what-if (NOT a forecast). Reads the reference distribution
 * (+ manual grouping), lets the owner assume ρ/α/cost/bankroll, and simulates EV · P(loss) ·
 * Risk-of-Ruin · P(overlay). Confidence is inherited (N=1 → "Giả thuyết"). Client-only, pure read.
 */
export function MonteCarloPanel({
  series,
  overrideLabels,
  audience = "internal",
}: {
  series: Series[];
  overrideLabels?: Record<string, string>;
  audience?: "internal" | "client";
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [rho, setRho] = useState(0.3);
  const [alpha, setAlpha] = useState(1.0);
  const [bankroll, setBankroll] = useState<number | null>(null);
  const [costMode, setCostMode] = useState<"none" | "single" | "drivers">("none");
  const [costSingle, setCostSingle] = useState<number | null>(null);
  const [drivers, setDrivers] = useState<CostDrivers>(emptyDrivers);
  const [lockedSeed, setLockedSeed] = useState<number | null>(null);
  const [result, setResult] = useState<SimResult | null>(null);
  const [view, setView] = useState<"internal" | "client">(audience);

  // Build selectable groups (usable vs skipped) from the reference distribution.
  const groups = useMemo<SelectableGroup[]>(() => {
    return groupEvents(series, overrideLabels).map((g) => {
      const stats = computeGroupStats(g);
      const ln = referenceGroupToLogNormal(g);
      const buyin = stats.medianBuyIn;
      const fee = stats.medianFee;
      const low = stats.entries.low;
      const usable = ln !== null && buyin !== null && buyin > 0 && fee !== null && low !== null && low > 0;
      return {
        key: g.normalizedName || "(unnamed)",
        name: g.displayName,
        n: g.n,
        tier: ln?.tier ?? null,
        usable,
        reason: usable ? null : "chưa đủ dữ liệu (thiếu entries / buy-in / fee)",
        sim: usable
          ? { name: g.displayName, mu: ln!.mu, sigma: ln!.sigma, fee: fee!, buyin: buyin!, lowEntries: low!, tier: ln!.tier }
          : null,
      };
    });
  }, [series, overrideLabels]);

  if (series.length === 0 || groups.length === 0) return null;

  const cost =
    costMode === "single"
      ? costSingle ?? undefined
      : costMode === "drivers"
        ? computeCostFromDrivers(drivers).total
        : undefined;
  const costBreakdown = costMode === "drivers" ? computeCostFromDrivers(drivers) : null;

  const selectedSims = groups.filter((g) => g.usable && selected.has(g.key)).map((g) => g.sim!) as EventLogNormal[];
  const skippedSelected = groups.filter((g) => !g.usable && selected.has(g.key));

  const toggle = (key: string): void =>
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  const run = (reroll = false): void => {
    if (selectedSims.length === 0) {
      setResult(null);
      return;
    }
    const seed = reroll ? Math.floor(Math.random() * 0x7fffffff) : lockedSeed ?? Math.floor(Math.random() * 0x7fffffff);
    setLockedSeed(seed);
    setResult(simulateFestival(selectedSims, { rho, alpha, cost: cost && cost > 0 ? cost : undefined, bankroll: bankroll ?? undefined, seed }));
  };

  const isHypo = result?.aggregateTier === "hypothesis";
  const client = view === "client";

  return (
    <section className="space-y-3">
      <div className="flex items-start justify-between gap-2">
        <div>
          <h3 className="font-display text-base flex items-center gap-2">
            <FlaskConical className="h-4 w-4 text-primary" /> Scenario / what-if (Monte Carlo)
          </h3>
          <p className="text-[11px] text-muted-foreground">
            Mô phỏng theo <strong>giả định bạn nhập</strong> trên phân phối tham chiếu đã quan sát —{" "}
            <strong>KHÔNG phải dự báo</strong>. Engine chỉ dự phóng số entry; tiền tính bằng công thức.
          </p>
        </div>
        <div className="shrink-0 inline-flex rounded-md border border-border text-[10px]">
          {(["internal", "client"] as const).map((m) => (
            <button
              key={m}
              onClick={() => setView(m)}
              className={cn("px-2 py-1", view === m ? "bg-primary text-primary-foreground" : "text-muted-foreground")}
            >
              {m === "internal" ? "Nội bộ" : "Khách"}
            </button>
          ))}
        </div>
      </div>

      {/* event selector */}
      <Card className="p-3 border-primary/30 space-y-1.5">
        <div className="text-xs font-medium">Chọn giải cho kịch bản ({selectedSims.length} chọn{skippedSelected.length > 0 ? `, ${skippedSelected.length} bị bỏ` : ""})</div>
        <ul className="grid sm:grid-cols-2 gap-x-3 gap-y-1">
          {groups.map((g) => (
            <li key={g.key} className="text-[11px] flex items-center gap-2">
              <input
                type="checkbox"
                className="h-3 w-3 shrink-0 accent-primary disabled:opacity-40"
                checked={selected.has(g.key)}
                disabled={!g.usable}
                onChange={() => toggle(g.key)}
              />
              <span className={cn("truncate flex-1", !g.usable && "text-muted-foreground/60 line-through")}>{g.name}</span>
              <span className="shrink-0 text-[10px] text-muted-foreground">
                {g.usable ? `N=${g.n} · ${g.tier ? TIER_VI[g.tier] : ""}` : g.reason}
              </span>
            </li>
          ))}
        </ul>
      </Card>

      {/* assumption sliders */}
      <Card className="p-3 border-primary/30 space-y-3 text-xs">
        <Slider label="ρ — mức độ các giải cùng biến động (giả định; N nhỏ chưa ước được)" value={rho} min={0} max={1} step={0.05} onChange={setRho} display={rho.toFixed(2)} />
        <Slider label="α — độ mạnh tay đặt GTD (α>1 chỉ thêm rủi ro overlay; lực kéo marketing là phán đoán của bạn)" value={alpha} min={0} max={2} step={0.1} onChange={setAlpha} display={`×${alpha.toFixed(1)}`} />
        <div className="flex items-center justify-between gap-2">
          <span className="text-muted-foreground">Bankroll — vốn chịu lỗ tối đa (cho Risk-of-Ruin)</span>
          <Input type="number" className="h-7 w-32 text-right" placeholder="(để trống)" value={bankroll ?? ""} onChange={(e) => setBankroll(e.target.value === "" ? null : Number(e.target.value))} />
        </div>
      </Card>

      {/* cost toggle */}
      <Card className="p-3 border-primary/30 space-y-2 text-xs">
        <div className="flex flex-wrap items-center gap-1.5">
          <span className="text-muted-foreground mr-1">Chi phí:</span>
          {(["none", "single", "drivers"] as const).map((m) => (
            <Button key={m} size="sm" variant={costMode === m ? "default" : "outline"} className="h-7 text-[11px]" onClick={() => setCostMode(m)}>
              {m === "none" ? "Không tính" : m === "single" ? "Nhập tổng" : "Dựng từ drivers"}
            </Button>
          ))}
        </div>
        {costMode === "single" && (
          <div className="flex items-center justify-between gap-2">
            <span className="text-muted-foreground">Tổng chi phí festival</span>
            <Input type="number" className="h-7 w-36 text-right" placeholder="VND" value={costSingle ?? ""} onChange={(e) => setCostSingle(e.target.value === "" ? null : Number(e.target.value))} />
          </div>
        )}
        {costMode === "drivers" && (
          <div className="space-y-2">
            <div className="grid grid-cols-2 gap-2">
              {([
                ["festival_days", "Số ngày"],
                ["dealers_per_day", "Dealer/ngày"],
                ["dealer_wage_per_day", "Lương dealer/ngày"],
                ["staff_cost_per_day", "Nhân sự sàn/ngày"],
                ["venue_cost", "Mặt bằng"],
                ["equipment_setup_cost", "Thiết bị/dựng"],
                ["marketing_budget", "Marketing"],
                ["other_fixed_cost", "Cố định khác"],
              ] as [keyof CostDrivers, string][]).map(([k, label]) => (
                <label key={k} className="flex flex-col gap-0.5">
                  <span className="text-[10px] text-muted-foreground">{label}</span>
                  <Input type="number" className="h-7 text-right" value={(drivers[k] as number | undefined) ?? ""} onChange={(e) => setDrivers((d) => ({ ...d, [k]: e.target.value === "" ? null : Number(e.target.value) }))} />
                </label>
              ))}
            </div>
            {costBreakdown && (
              <div className="flex flex-wrap gap-x-3 text-[11px] tabular-nums border-t border-border/60 pt-1.5">
                <span className="text-muted-foreground">biến đổi {formatVndShort(costBreakdown.variable)}</span>
                <span className="text-muted-foreground">cố định {formatVndShort(costBreakdown.fixed)}</span>
                <span className="text-muted-foreground">marketing {formatVndShort(costBreakdown.marketing)}</span>
                <span className="font-medium">tổng {formatVndShort(costBreakdown.total)}</span>
              </div>
            )}
            <p className="text-[10px] text-muted-foreground/80">Ước từ drivers của bạn — đáng tin hơn projection turnout (cost tất định, turnout ngẫu nhiên).</p>
          </div>
        )}
      </Card>

      {/* run */}
      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" className="gap-1.5" disabled={selectedSims.length === 0} onClick={() => run(false)}>
          <Play className="h-4 w-4" /> Chạy mô phỏng
        </Button>
        {result?.usable && (
          <Button size="sm" variant="outline" className="gap-1.5" onClick={() => run(true)}>
            <Dices className="h-4 w-4" /> Đổi seed
          </Button>
        )}
        {selectedSims.length === 0 && <span className="text-[11px] text-muted-foreground">Chọn ít nhất 1 giải đủ dữ liệu để chạy.</span>}
      </div>

      {/* output */}
      {result?.usable && <Output result={result} cost={cost && cost > 0 ? cost : 0} isHypo={isHypo} client={client} />}
    </section>
  );
}

function Slider({ label, value, min, max, step, onChange, display }: { label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; display: string }) {
  return (
    <div className="space-y-1">
      <div className="flex items-center justify-between gap-2">
        <span className="text-muted-foreground">{label}</span>
        <span className="shrink-0 font-medium tabular-nums">{display}</span>
      </div>
      <input type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="w-full accent-primary" />
    </div>
  );
}

function Pct({ x }: { x: number }) {
  return <>{(x * 100).toFixed(1)}%</>;
}

function Output({ result, cost, isHypo, client }: { result: SimResult; cost: number; isHypo: boolean; client: boolean }) {
  const r = result;
  const headlineValue = r.mode === "profit" ? r.eEV ?? 0 : r.eGross;
  const maxCount = Math.max(1, ...r.bins.map((b) => b.count));
  const hypoChip = isHypo ? (
    <span className="ml-1 inline-flex items-center gap-0.5 rounded-full border border-warning/50 bg-warning/10 px-1.5 py-0.5 text-[9px] leading-none text-warning align-middle">
      <Hand className="h-2.5 w-2.5" /> Giả thuyết (N=1)
    </span>
  ) : null;

  return (
    <Card className="p-3 gradient-card border-primary/40 space-y-3 text-xs">
      {/* headline */}
      <div>
        <div className="text-[11px] text-muted-foreground">
          {r.mode === "profit" ? "E[EV] (mô phỏng)" : "Gross trước chi phí (E)"}
          {r.mode === "gross" && <span className="text-warning"> · chưa tính được profit (thiếu cost)</span>}
          {hypoChip}
        </div>
        <div className={cn("text-lg font-semibold tabular-nums", headlineValue < 0 ? "text-warning" : "text-primary")}>
          {formatVndShort(headlineValue)}
        </div>
        {client && <p className="text-[10px] text-muted-foreground">Chỉ là kịch bản tham khảo — không phải cam kết.</p>}
      </div>

      {/* percentiles */}
      <div className="grid grid-cols-3 gap-2 tabular-nums">
        {([["P5", r.p5], ["P50", r.p50], ["P95", r.p95]] as [string, number][]).map(([k, v]) => (
          <div key={k} className="rounded-md border border-border/60 p-1.5">
            <div className="text-[10px] text-muted-foreground">{k}</div>
            <div className={cn("font-medium", v < 0 ? "text-warning" : "")}>{formatVndShort(v)}</div>
          </div>
        ))}
      </div>

      {/* risk metrics */}
      <div className="grid grid-cols-2 gap-2">
        <Metric label="P(lỗ)" value={<Pct x={r.pLoss} />} />
        <Metric label="P(overlay)" value={<Pct x={r.pOverlayAny} />} />
        <Metric
          label={<>Risk-of-Ruin {hypoChip}</>}
          value={r.ruin === null ? <span className="text-muted-foreground">—</span> : <Pct x={r.ruin} />}
          note={r.ruin === null ? (r.mode === "profit" ? "nhập bankroll để tính" : "cần cost + bankroll") : `tier: ${TIER_VI[r.aggregateTier]}`}
          danger
        />
        <Metric label="Breakdown" value={<span className="text-[10px]">{formatVndShort(r.eRake)} − {formatVndShort(cost)} − {formatVndShort(r.eOverlay)}</span>} note="rake − cost − overlay" />
      </div>

      {client && (
        <p className="text-[10px] text-warning/90 flex items-start gap-1 border border-warning/40 bg-warning/5 rounded-md p-2">
          <AlertTriangle className="mt-0.5 h-3 w-3 shrink-0" />
          Không phải dự báo · dải rộng do N nhỏ · đừng quyết định tài chính chỉ dựa trên số này.
        </p>
      )}

      {/* histogram */}
      <div>
        <div className="text-[10px] text-muted-foreground mb-1">Phân phối kết quả (mô phỏng)</div>
        <div className="flex items-end gap-px h-20">
          {r.bins.map((b, i) => (
            <div
              key={i}
              title={`${formatVndShort(b.lo)}…${formatVndShort(b.hi)}: ${b.count}`}
              className={cn("flex-1 rounded-t", b.hi <= 0 ? "bg-warning/60" : "bg-primary/60")}
              style={{ height: `${(b.count / maxCount) * 100}%` }}
            />
          ))}
        </div>
        <div className="flex justify-between text-[9px] text-muted-foreground tabular-nums mt-0.5">
          <span>{formatVndShort(r.bins[0]?.lo ?? 0)}</span>
          <span>0</span>
          <span>{formatVndShort(r.bins[r.bins.length - 1]?.hi ?? 0)}</span>
        </div>
      </div>
    </Card>
  );
}

function Metric({ label, value, note, danger }: { label: ReactNode; value: ReactNode; note?: string; danger?: boolean }) {
  return (
    <div className={cn("rounded-md border p-1.5", danger ? "border-warning/40 bg-warning/5" : "border-border/60")}>
      <div className="text-[10px] text-muted-foreground">{label}</div>
      <div className="font-medium tabular-nums">{value}</div>
      {note && <div className="text-[9px] text-muted-foreground/80">{note}</div>}
    </div>
  );
}
