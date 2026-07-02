import { useEffect, useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { FlaskConical, Dices, AlertTriangle, Scale } from "lucide-react";
import { cn } from "@/lib/utils";
import { formatVndShort } from "@/lib/clubFinance";
import type { Series } from "@/lib/series-intelligence/seriesLibrary";
import { groupEvents, computeGroupStats } from "@/lib/series-intelligence/referenceDistribution";
import { simulateOverlayRisk, simulateOverlayFromForecast } from "@/lib/series-intelligence/overlayRiskEngine";
import type { ForecastOverlayFeed } from "@/lib/series-intelligence/turnoutForecast";
import { ExplainHint } from "./ExplainHint";

// Green poker-felt palette SCOPED to this panel (vars on the wrapper only → global maroon theme untouched).
const FELT_VARS = {
  "--felt": "#0f3d2e",
  "--felt2": "#0a2b20",
  "--gold": "#d4af37",
  "--gold2": "#f0d98a",
  "--cream": "#f5f1e6",
  "--mut": "#9db5a9",
  "--ok": "#3fae6b",
  "--bad": "#d9534f",
  "--line": "rgba(212,175,55,.22)",
  "--card": "rgba(11,32,24,.55)",
} as CSSProperties;

interface RiskItem {
  key: string;
  name: string;
  nReal: number;
  observedEntries: number[];
  buyinPrize: number;
  fee: number;
  usable: boolean;
  reason: string | null;
}

const WHATIF_PRESETS = [2, 6, 20];

/**
 * Overlay-risk visualizer (single event vs a GTD). Green-felt, JetBrains-Mono numbers. SCENARIO, NOT a
 * forecast. The headline DEFAULTS to the group's REAL observation count `nReal`; the n-toggle presets are
 * loudly-labeled WHAT-IF ("nếu có N quan sát") so a tighter band is never shown as the real uncertainty.
 */
export function MonteCarloPanel({
  series,
  overrideLabels,
  audience = "internal",
  forecastFeed,
}: {
  series: Series[];
  overrideLabels?: Record<string, string>;
  audience?: "internal" | "client";
  /** Optional forecast center from TurnoutForecastPanel (flag-gated). `undefined` = feature absent (no
   *  toggle rendered at all); `null` = panel mounted but no usable forecast yet (toggle shown disabled). */
  forecastFeed?: (ForecastOverlayFeed & { fee: number }) | null;
}) {
  const items = useMemo<RiskItem[]>(() => {
    return groupEvents(series, overrideLabels).map((g) => {
      const s = computeGroupStats(g);
      const observedEntries = g.members
        .map((m) => m.event.total_entries)
        .filter((x): x is number => typeof x === "number" && Number.isFinite(x) && x > 0);
      const buyinPrize = s.medianBuyIn;
      const fee = s.medianFee;
      const usable = observedEntries.length >= 1 && buyinPrize !== null && buyinPrize > 0 && fee !== null && fee >= 0;
      return {
        key: g.normalizedName || "(unnamed)",
        name: g.displayName,
        nReal: observedEntries.length,
        observedEntries,
        buyinPrize: buyinPrize ?? 0,
        fee: fee ?? 0,
        usable,
        reason: usable ? null : "chưa đủ dữ liệu (entries / buy-in / fee)",
      };
    });
  }, [series, overrideLabels]);

  const usableItems = items.filter((i) => i.usable);
  const [selectedKey, setSelectedKey] = useState<string | null>(null);
  const [nMode, setNMode] = useState<"real" | number>("real");
  const [sd, setSd] = useState(0.55);
  const [seed, setSeed] = useState(1);
  const [gtd, setGtd] = useState<number | null>(null);
  // Center source: DEFAULT is always the observed group history; "forecast" only by explicit user choice.
  const [centerSource, setCenterSource] = useState<"history" | "forecast">("history");

  const selected = usableItems.find((i) => i.key === selectedKey) ?? usableItems[0] ?? null;
  const usingForecast = centerSource === "forecast" && forecastFeed != null;

  // If the forecast feed disappears (form cleared / model gated), fall back to history — never a silent hold.
  useEffect(() => {
    if (centerSource === "forecast" && forecastFeed == null) setCenterSource("history");
  }, [centerSource, forecastFeed]);

  // geomean prize → adaptive GTD slider bounds + default (forecast mode centers on the forecast's prize)
  const meanLog = selected && selected.observedEntries.length
    ? selected.observedEntries.reduce((a, c) => a + Math.log(c), 0) / selected.observedEntries.length
    : 0;
  const geoPrize = usingForecast
    ? forecastFeed.base * forecastFeed.buyIn
    : selected
      ? Math.exp(meanLog) * selected.buyinPrize
      : 0;
  const gtdMax = Math.max(1e9, Math.ceil((geoPrize * 1.5) / 5e8) * 5e8);
  const gtdDefault = Math.max(5e8, Math.round((geoPrize * 0.7) / 5e8) * 5e8);
  const effGtd = gtd ?? gtdDefault;

  // reset GTD + n-mode when the selected group changes
  useEffect(() => {
    setGtd(null);
    setNMode("real");
  }, [selected?.key]);

  const nReal = selected?.nReal ?? 0;
  const nEff = nMode === "real" ? Math.max(1, nReal) : nMode;
  // what-if n only exists in history mode (the n-toggle is hidden while the forecast is the center)
  const isWhatIf = !usingForecast && nMode !== "real";
  const client = audience === "client";

  const result = useMemo(() => {
    if (usingForecast) {
      // Explicit forecast-centered adapter: ONE layer, σ = the forecast band's own uncertainty.
      // No epistemic √n term and no synthetic n — a forecast is not "n observations".
      return simulateOverlayFromForecast({ baseEntries: forecastFeed.base, logSd: forecastFeed.logSd, buyinPrize: forecastFeed.buyIn, fee: forecastFeed.fee, gtd: effGtd, seed });
    }
    return selected
      ? simulateOverlayRisk({ observedEntries: selected.observedEntries, buyinPrize: selected.buyinPrize, fee: selected.fee, gtd: effGtd, n: nEff, sd, seed })
      : null;
  }, [usingForecast, forecastFeed, selected, effGtd, nEff, sd, seed]);

  if (usableItems.length === 0) {
    if (series.length === 0) return null;
    return (
      <section style={FELT_VARS} className="rounded-xl p-4 bg-[var(--felt)] text-[var(--cream)] border border-[var(--line)] text-xs">
        <div className="flex items-center gap-2 font-medium text-[var(--gold2)]"><Scale className="h-4 w-4" /> Rủi ro overlay</div>
        <p className="mt-1 text-[var(--mut)]">Cần ≥1 giải có đủ entries + buy-in + fee. Nạp CSV (mục "CSV thủ công") rồi chọn giải.</p>
      </section>
    );
  }

  return (
    <section style={FELT_VARS} className="rounded-xl p-4 bg-[var(--felt)] text-[var(--cream)] border border-[var(--line)] space-y-3 font-jetbrains">
      {/* header */}
      <div>
        <div className="flex items-center gap-2 text-sm font-semibold text-[var(--gold2)]">
          <Scale className="h-4 w-4" /> Rủi ro overlay — kịch bản 1 giải
        </div>
        <p className="text-[11px] text-[var(--mut)] font-sans">
          Mô phỏng 2 lớp (kỳ vọng không chắc + turnout dao động) dựa trên <b className="text-[var(--cream)]">N quan sát thật</b> — <b className="text-[var(--gold2)]">KHÔNG phải dự báo</b>.
        </p>
      </div>

      {/* center-source toggle — rendered ONLY when the forecast feature is present (prop passed) */}
      {forecastFeed !== undefined && (
        <div className="space-y-1">
          <div className="text-[10px] text-[var(--mut)] uppercase tracking-wide font-sans">Tâm mô phỏng lấy từ đâu</div>
          <div className="flex gap-1.5">
            <button
              onClick={() => setCenterSource("history")}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px] font-sans",
                !usingForecast ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold2)]" : "border-[var(--line)] text-[var(--mut)]",
              )}
            >
              Lịch sử nhóm (mặc định)
            </button>
            <button
              onClick={() => forecastFeed != null && setCenterSource("forecast")}
              disabled={forecastFeed == null}
              className={cn(
                "rounded-md border px-2.5 py-1 text-[11px] font-sans",
                usingForecast
                  ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold2)]"
                  : forecastFeed == null
                    ? "border-[var(--line)] text-[var(--mut)] opacity-50 cursor-not-allowed"
                    : "border-[var(--line)] text-[var(--mut)]",
              )}
            >
              Dự báo {forecastFeed == null ? "(chưa có)" : "(nếu có)"}
            </button>
          </div>
          {usingForecast && (
            <div className="text-[10px] text-[var(--gold2)] font-sans">
              nguồn tâm: {forecastFeed.label} — buy-in {formatVndShort(forecastFeed.buyIn)} CỦA GIẢI ĐANG DỰ BÁO
              (không phải median nhóm); dải lấy từ chính dự báo.
            </div>
          )}
        </div>
      )}

      {/* group selector (tâm lịch sử; trong chế độ dự báo chỉ dùng cho tham chiếu) */}
      {!usingForecast && (
        <div className="flex flex-wrap gap-1.5">
          {usableItems.map((i) => (
            <button
              key={i.key}
              onClick={() => setSelectedKey(i.key)}
              className={cn(
                "rounded-md border px-2 py-1 text-[11px] font-sans transition-colors",
                i.key === selected?.key ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold2)]" : "border-[var(--line)] text-[var(--mut)]",
              )}
            >
              {i.name} <span className="opacity-70">· N={i.nReal}</span>
            </button>
          ))}
        </div>
      )}

      {selected && result && (
        <>
          {/* GTD slider */}
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[11px] font-sans">
              <span className="text-[var(--mut)] uppercase tracking-wide">GTD cam kết</span>
              <span className="text-[var(--gold2)] tabular-nums">{formatVndShort(effGtd)}</span>
            </div>
            <input
              type="range"
              min={0}
              max={gtdMax}
              step={5e8}
              value={effGtd}
              onChange={(e) => setGtd(Number(e.target.value))}
              className="w-full accent-[var(--gold)]"
            />
            <div className="text-[10px] text-[var(--mut)] font-sans">Cần <b className="text-[var(--cream)]">{Math.ceil(result.thresholdEntries).toLocaleString("vi-VN")}</b> entry để đủ GTD (không phải bù).</div>
          </div>

          {/* n-toggle (HONEST) — history mode only: in forecast mode there is NO observation count to
              tighten (the band IS the forecast's own σ), so no n is shown at all (nothing synthetic). */}
          {!usingForecast && (
          <div className="space-y-1">
            <div className="text-[10px] text-[var(--mut)] uppercase tracking-wide font-sans">Số series quan sát (n)</div>
            <div className="flex gap-1.5">
              <button onClick={() => setNMode("real")} className={cn("rounded-md border px-2.5 py-1 text-[11px] font-sans", !isWhatIf ? "border-[var(--gold)] bg-[var(--gold)]/15 text-[var(--gold2)]" : "border-[var(--line)] text-[var(--mut)]")}>
                Thật · N={nReal}
              </button>
              {WHATIF_PRESETS.filter((p) => p > nReal).map((p) => (
                <button key={p} onClick={() => setNMode(p)} className={cn("rounded-md border px-2.5 py-1 text-[11px] font-sans", nMode === p ? "border-[var(--bad)] bg-[var(--bad)]/15 text-[var(--bad)]" : "border-[var(--line)] text-[var(--mut)]")}>
                  giả lập {p}
                </button>
              ))}
            </div>
            {isWhatIf && (
              <div className="text-[10px] text-[var(--bad)] font-sans flex items-center gap-1">
                <AlertTriangle className="h-3 w-3 shrink-0" /> GIẢ LẬP n={nMode} · N thật = {nReal}. Đây là "nếu có {nMode} quan sát", KHÔNG phải độ chắc chắn thật của bạn.
              </div>
            )}
          </div>
          )}

          {/* output cards */}
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
            <div className="rounded-lg border border-[var(--bad)]/40 bg-[var(--bad)]/8 p-3">
              <div className="text-[10px] text-[var(--mut)] uppercase tracking-wide font-sans">P(overlay) {isWhatIf && <span className="text-[var(--bad)]">· giả lập</span>}</div>
              <div className="text-2xl font-bold tabular-nums text-[var(--bad)]">{(result.pOverlay * 100).toFixed(0)}%</div>
              <div className="text-[10px] text-[var(--mut)] font-sans">chi phí kỳ vọng: <b className="text-[var(--cream)]">{formatVndShort(result.eOverlay)}</b></div>
            </div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-3">
              <div className="text-[10px] text-[var(--mut)] uppercase tracking-wide font-sans">Entries P5·P50·P95</div>
              <div className="text-base font-bold tabular-nums text-[var(--cream)]">
                {Math.round(result.entP5)} · <span className="text-[var(--gold2)]">{Math.round(result.entP50)}</span> · {Math.round(result.entP95)}
              </div>
              <div className="text-[10px] text-[var(--mut)] font-sans">trung tâm = trung bình hình học</div>
            </div>
            <div className="rounded-lg border border-[var(--line)] bg-[var(--card)] p-3">
              <div className="text-[10px] text-[var(--mut)] uppercase tracking-wide font-sans">Rake (P5–P95)</div>
              <div className="text-base font-bold tabular-nums text-[var(--ok)]">{formatVndShort(result.rakeP5)} – {formatVndShort(result.rakeP95)}</div>
              <div className="text-[10px] text-[var(--mut)] font-sans">doanh thu fee mô phỏng</div>
            </div>
          </div>
          <ExplainHint tone="felt" term="P(overlay) · P5 · P50 · P95">
            <b className="text-[var(--cream)]">P(overlay)</b> = khả năng phải bù tiền túi cho GTD (trong 100 lần tổ chức
            "giống hệt", bao nhiêu lần thu không đủ). <b className="text-[var(--cream)]">P5 · P50 · P95</b> = kịch bản
            5% xấu nhất · điển hình · 5% tốt nhất — tức là 90% kịch bản mô phỏng nằm giữa P5 và P95.
          </ExplainHint>

          {/* histogram */}
          <div>
            <div className="flex items-center justify-between text-[11px] text-[var(--mut)] font-sans mb-1">
              <span>Phân phối entries mô phỏng</span>
              <span>{usingForecast ? "tâm = dự báo" : `n=${nEff}`} · vùng đỏ = overlay</span>
            </div>
            <Histogram result={result} />
            <div className="flex flex-wrap gap-3 text-[9.5px] text-[var(--mut)] font-sans mt-1.5">
              <Legend color="var(--ok)" sq>đủ GTD</Legend>
              <Legend color="var(--bad)" sq>overlay (entries thấp)</Legend>
              <Legend color="var(--gold2)">median</Legend>
              <Legend color="var(--cream)" dash>P5 / P95</Legend>
              <Legend color="var(--bad)">ngưỡng GTD</Legend>
            </div>
          </div>

          {/* SD control (assumption) — history mode only; forecast mode's σ comes from the forecast band */}
          {!usingForecast ? (
          <div className="space-y-1">
            <div className="flex items-center justify-between text-[10px] font-sans">
              <span className="text-[var(--mut)]">SD biến động turnout (giả định)</span>
              <span className="text-[var(--gold2)] tabular-nums">{sd.toFixed(2)}</span>
            </div>
            <input type="range" min={0.3} max={0.9} step={0.05} value={sd} onChange={(e) => setSd(Number(e.target.value))} className="w-full accent-[var(--gold)]" />
            <ExplainHint tone="felt" term="SD">
              SD = mức <b className="text-[var(--cream)]">dao động lượng khách giữa các lần tổ chức</b> cùng một giải.
              Vì CLB mới có ít giải nên chưa đo được từ dữ liệu — đây đang là <b className="text-[var(--cream)]">giả định</b>;
              kéo thử để xem rủi ro nhạy thế nào với mức dao động.
            </ExplainHint>
          </div>
          ) : (
          <div className="text-[10px] text-[var(--mut)] font-sans">
            σ = <span className="text-[var(--gold2)] tabular-nums">{forecastFeed!.logSd.toFixed(2)}</span> — lấy từ chính
            dải dự báo (p10–p90), không phải giả định SD của nhóm.
          </div>
          )}

          <button onClick={() => setSeed((s) => s + 1)} className="rounded-md border border-[var(--line)] px-2.5 py-1 text-[11px] font-sans text-[var(--mut)] inline-flex items-center gap-1.5">
            <Dices className="h-3.5 w-3.5" /> Đổi seed (chạy lại)
          </button>

          {/* honest box */}
          <div className="rounded-lg border border-[#5fa8bf]/35 bg-[#5fa8bf]/8 p-3 text-[11px] text-[var(--mut)] font-sans leading-relaxed">
            <div className="flex items-center gap-1.5 text-[var(--cream)] font-semibold mb-1"><FlaskConical className="h-3.5 w-3.5" /> Đọc đúng cái này nói</div>
            Nó KHÔNG nói "giải sẽ có X người". Nó nói: <b className="text-[#5fa8bf]">với GTD bạn chọn, xác suất phải bù overlay là bao nhiêu và bù bao nhiêu</b>.
            {usingForecast ? (
              <> Tâm mô phỏng là <b className="text-[#5fa8bf]">dự báo thống kê (Hypothesis)</b>, KHÔNG phải quan sát lịch sử; độ rộng dải lấy từ chính dải dự báo — dự báo sai thì rủi ro này cũng sai theo. <b className="text-[var(--gold2)]">Không phải dự báo cam kết.</b></>
            ) : (
              <> Dải rộng vì <b className="text-[#5fa8bf]">N={nReal}</b> (kỳ vọng không chắc — co theo √n); phần KHÔNG co được = turnout dao động (aleatoric, không bao giờ về 0).
            SD={sd.toFixed(2)} là <b className="text-[#5fa8bf]">giả định</b> (N nhỏ chưa ước được). <b className="text-[var(--gold2)]">Không phải dự báo.</b></>
            )}
            {client && <span className="block mt-1.5 text-[var(--bad)]">Chỉ là kịch bản tham khảo — đừng quyết định tài chính chỉ dựa trên số này.</span>}
            <ExplainHint tone="felt" term="hai lớp bất định" className="mt-1.5 block">
              Lớp 1 (<b className="text-[var(--cream)]">epistemic</b>): phần chưa chắc <b className="text-[var(--cream)]">vì ít dữ liệu</b> —
              có thêm giải thì phần này co lại (theo √n). Lớp 2 (<b className="text-[var(--cream)]">aleatoric</b>): phần
              <b className="text-[var(--cream)]"> dao động tự nhiên</b> của lượng khách — không bao giờ hết, thêm bao nhiêu
              dữ liệu cũng vậy. Vì thế "thêm data" giúp thu hẹp dải, nhưng không bao giờ cho con số chắc chắn.
            </ExplainHint>
          </div>
        </>
      )}
    </section>
  );
}

function Legend({ color, sq, dash, children }: { color: string; sq?: boolean; dash?: boolean; children: ReactNode }) {
  return (
    <span className="flex items-center gap-1.5">
      {sq ? (
        <span className="inline-block h-2.5 w-2.5 rounded-[2px]" style={{ background: color }} />
      ) : (
        <span className="inline-block w-3.5 border-t-2" style={{ borderColor: color, borderStyle: dash ? "dashed" : "solid" }} />
      )}
      {children}
    </span>
  );
}

/** Hand-rolled SVG histogram over the entries axis (mirrors the demo's drawHist). */
function Histogram({ result }: { result: { bins: { lo: number; hi: number; count: number; overlayCount: number }[]; entP5: number; entP50: number; entP95: number; thresholdEntries: number } }) {
  const W = 860;
  const H = 260;
  const padL = 8;
  const padR = 8;
  const padB = 26;
  const padT = 10;
  const bins = result.bins;
  if (bins.length === 0) return null;
  const LO = bins[0].lo;
  const HI = bins[bins.length - 1].hi;
  const max = Math.max(1, ...bins.map((b) => b.count));
  const bw = (W - padL - padR) / bins.length;
  const x = (v: number) => padL + ((v - LO) / (HI - LO)) * (W - padL - padR);
  const tx = x(result.thresholdEntries);

  return (
    <svg viewBox={`0 0 ${W} ${H}`} preserveAspectRatio="xMidYMid meet" className="w-full h-auto block">
      {bins.map((b, i) => {
        const h = (b.count / max) * (H - padB - padT);
        const ovFrac = b.count ? b.overlayCount / b.count : 0;
        const col = ovFrac > 0.5 ? "var(--bad)" : "var(--ok)";
        return <rect key={i} x={padL + i * bw + 0.5} y={H - padB - h} width={bw - 1} height={h} fill={col} opacity={0.82} rx={1} />;
      })}
      {/* overlay threshold */}
      <line x1={tx} y1={padT} x2={tx} y2={H - padB} stroke="var(--bad)" strokeWidth={2} />
      <text x={tx} y={padT + 10} fill="var(--bad)" fontSize={10} fontFamily="JetBrains Mono, monospace" textAnchor={tx > W - 80 ? "end" : "start"} dx={tx > W - 80 ? -4 : 4}>
        GTD→{Math.round(result.thresholdEntries)}
      </text>
      {/* P5 / P50 / P95 */}
      {([
        [result.entP5, "var(--cream)", true, "P5"],
        [result.entP50, "var(--gold2)", false, "med"],
        [result.entP95, "var(--cream)", true, "P95"],
      ] as [number, string, boolean, string][]).map(([v, c, dash, lab], i) => {
        const px = x(v);
        return (
          <g key={i}>
            <line x1={px} y1={padT} x2={px} y2={H - padB} stroke={c} strokeWidth={1.5} strokeDasharray={dash ? "4 3" : undefined} opacity={0.85} />
            <text x={px} y={H - padB + 16} fill={c} fontSize={9.5} fontFamily="JetBrains Mono, monospace" textAnchor="middle">{lab} {Math.round(v)}</text>
          </g>
        );
      })}
      {/* x-axis ticks */}
      {[500, 1000, 2000, 3000, 4000].filter((t) => t >= LO && t <= HI).map((t) => (
        <text key={t} x={x(t)} y={H - 4} fill="var(--mut)" fontSize={9} fontFamily="JetBrains Mono, monospace" textAnchor="middle">{t}</text>
      ))}
    </svg>
  );
}
