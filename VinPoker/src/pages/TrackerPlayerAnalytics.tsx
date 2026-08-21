import { startTransition, useEffect, useMemo, useRef, useState } from "react";
import { Activity, AlertTriangle, ArrowLeft, BarChart3, RefreshCw, ShieldCheck, Target, Trophy } from "lucide-react";
import { Navigate, useNavigate, useParams, useSearchParams } from "react-router-dom";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useAuth } from "@/hooks/useAuth";
import { FEATURES } from "@/lib/featureFlags";
import {
  loadTrackerPlayerAnalytics,
  type TrackerAnalyticsMetric,
  type TrackerAnalyticsMetricKey,
  type TrackerPlayerAnalyticsResponse,
} from "@/lib/trackerVoice";

const UUID_PATTERN = /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const DAY_OPTIONS = [30, 90, 365, 0] as const;
type DayOption = typeof DAY_OPTIONS[number];

const METRIC_LABELS: Record<TrackerAnalyticsMetricKey, { label: string; description: string }> = {
  vpip: { label: "VPIP", description: "Tự nguyện bỏ chip vào pot trước flop" },
  pfr: { label: "PFR", description: "Raise trước flop" },
  threeBet: { label: "3-Bet", description: "Re-raise hợp lệ trước flop" },
  foldToThreeBet: { label: "Fold to 3-Bet", description: "Bỏ bài sau khi gặp 3-bet" },
  fourBet: { label: "4-Bet", description: "Raise cấp bốn trước flop" },
  fiveBet: { label: "5-Bet", description: "Raise cấp năm trước flop" },
  wtsd: { label: "WTSD", description: "Đi tới showdown sau khi thấy flop" },
  wsd: { label: "W$SD", description: "Thắng tiền tại showdown đã được server xác minh" },
  wwsf: { label: "WWSF", description: "Thắng pot sau khi thấy flop" },
  flopCbet: { label: "Flop C-Bet", description: "Continuation bet ở flop" },
  turnCbet: { label: "Turn C-Bet", description: "Continuation bet tiếp ở turn" },
  foldToCbet: { label: "Fold to C-Bet", description: "Bỏ bài khi gặp continuation bet" },
  checkRaise: { label: "Check-Raise", description: "Check rồi raise trong cùng street" },
  aggressionFrequency: { label: "Aggression", description: "Tỷ lệ bet/raise trong quyết định postflop" },
};

const GROUPS: Array<{ title: string; icon: typeof Target; keys: TrackerAnalyticsMetricKey[] }> = [
  { title: "Preflop", icon: Target, keys: ["vpip", "pfr", "threeBet", "foldToThreeBet", "fourBet", "fiveBet"] },
  { title: "Postflop", icon: Activity, keys: ["flopCbet", "turnCbet", "foldToCbet", "checkRaise", "aggressionFrequency"] },
  { title: "Showdown", icon: Trophy, keys: ["wtsd", "wsd", "wwsf"] },
];

function dayLabel(days: DayOption): string {
  return days === 0 ? "Tất cả" : `${days} ngày`;
}

function safeBackTarget(value: string | null): string {
  if (!value || !value.startsWith("/tracker") || value.startsWith("//")) return "/tracker";
  return value;
}

function errorCopy(value: string): string {
  if (value.includes("ACTOR_NOT_ALLOWED")) return "Tài khoản này không được xem phân tích vận hành của người chơi trong giải này.";
  if (value.includes("PLAYER_NOT_IN_TOURNAMENT")) return "Người chơi không thuộc giải được yêu cầu.";
  if (value.includes("ANALYTICS_SCOPE_MISMATCH")) return "Phản hồi không khớp giải hoặc người chơi. Dữ liệu đã bị chặn.";
  return "Không tải được phân tích lúc này. Không có dữ liệu nội bộ nào được dùng thay thế.";
}

function MetricCard({ metricKey, metric }: { metricKey: TrackerAnalyticsMetricKey; metric: TrackerAnalyticsMetric }) {
  const copy = METRIC_LABELS[metricKey];
  const unavailable = metric.percentage === null;
  const lowSample = metric.denominator > 0 && metric.denominator < 20;
  return (
    <article className="min-h-[132px] rounded-2xl border border-white/8 bg-black/20 p-4 shadow-[inset_0_1px_rgba(255,255,255,.025)]">
      <div className="flex items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-100">{copy.label}</h3>
          <p className="mt-1 text-[11px] leading-relaxed text-zinc-500">{copy.description}</p>
        </div>
        {lowSample && <Badge variant="outline" className="border-amber-300/25 text-[10px] text-amber-200">Mẫu nhỏ</Badge>}
      </div>
      <div className="mt-4 flex items-end justify-between gap-3">
        <strong className={`font-mono text-3xl tracking-tight ${unavailable ? "text-zinc-600" : "text-emerald-300"}`}>
          {unavailable ? "—" : `${metric.percentage?.toFixed(1)}%`}
        </strong>
        <span className="font-mono text-[11px] text-zinc-500">
          {unavailable ? "Chưa đủ proof" : `${metric.numerator}/${metric.denominator}`}
        </span>
      </div>
    </article>
  );
}

export default function TrackerPlayerAnalytics() {
  const { playerId } = useParams<{ playerId: string }>();
  const [searchParams] = useSearchParams();
  const tournamentId = searchParams.get("t");
  const navigate = useNavigate();
  const { user, loading: authLoading } = useAuth();
  const [days, setDays] = useState<DayOption>(90);
  const [reloadKey, setReloadKey] = useState(0);
  const [result, setResult] = useState<TrackerPlayerAnalyticsResponse | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const requestGeneration = useRef(0);
  const validScope = Boolean(playerId && tournamentId && UUID_PATTERN.test(playerId) && UUID_PATTERN.test(tournamentId));
  const backTarget = safeBackTarget(searchParams.get("returnTo"));

  useEffect(() => {
    if (!FEATURES.trackerPlayerAnalytics || !user || !validScope || !playerId || !tournamentId) {
      setLoading(false);
      return;
    }
    const generation = ++requestGeneration.current;
    setLoading(true);
    setError(null);
    void loadTrackerPlayerAnalytics({ tournamentId, playerId, days }).then((next) => {
      if (requestGeneration.current !== generation) return;
      setResult(next);
      setLoading(false);
    }).catch((caught) => {
      if (requestGeneration.current !== generation) return;
      setResult(null);
      setError(caught instanceof Error ? caught.message : "ANALYTICS_UNAVAILABLE");
      setLoading(false);
    });
    return () => {
      if (requestGeneration.current === generation) requestGeneration.current += 1;
    };
  }, [days, playerId, reloadKey, tournamentId, user, validScope]);

  const proofCopy = useMemo(() => {
    if (!result) return null;
    const { verified, required } = result.analytics.proofCoverage;
    return required === 0 ? "Chưa có hand cần settlement proof" : `${verified}/${required} hand có settlement proof`;
  }, [result]);

  if (!FEATURES.trackerPlayerAnalytics) return <Navigate to="/tracker" replace />;
  if (authLoading) return <div className="container mx-auto space-y-4 p-4"><Skeleton className="h-28 rounded-3xl" /><Skeleton className="h-[520px] rounded-3xl" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!validScope) {
    return (
      <div className="container mx-auto max-w-2xl p-4 md:p-8">
        <Card role="alert" className="border-rose-400/30 bg-rose-950/20 p-6 text-center">
          <AlertTriangle className="mx-auto h-9 w-9 text-rose-300" />
          <h1 className="mt-3 text-xl font-bold">Scope phân tích không hợp lệ</h1>
          <p className="mt-2 text-sm text-muted-foreground">Cần đúng tournament và player ID. Hệ thống không tự chọn giải thay thế.</p>
          <Button className="mt-5 min-h-11" variant="outline" onClick={() => navigate("/tracker")}>Về Tracker</Button>
        </Card>
      </div>
    );
  }

  return (
    <div className="min-h-[calc(100vh-5rem)] bg-[radial-gradient(circle_at_12%_0%,rgba(16,185,129,.13),transparent_32%),radial-gradient(circle_at_88%_14%,rgba(245,158,11,.09),transparent_28%),#080b0d] text-zinc-100">
      <div className="container mx-auto max-w-7xl space-y-5 p-3 pb-[calc(1rem+env(safe-area-inset-bottom))] md:p-6">
        <header className="overflow-hidden rounded-3xl border border-emerald-300/20 bg-[linear-gradient(125deg,rgba(5,30,23,.92),rgba(10,12,15,.96)_56%,rgba(51,32,9,.75))] p-4 shadow-[0_28px_90px_rgba(0,0,0,.35)] md:p-6">
          <Button variant="ghost" className="-ml-3 min-h-11 text-zinc-400 hover:text-zinc-100" onClick={() => navigate(backTarget)}>
            <ArrowLeft className="h-4 w-4" /> Quay lại bàn
          </Button>
          <div className="mt-3 flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
            <div className="flex min-w-0 items-center gap-4">
              <Avatar className="h-16 w-16 border-2 border-emerald-300/35 shadow-[0_0_26px_rgba(52,211,153,.18)]">
                <AvatarImage src={result?.player.avatar_url ?? undefined} alt="" />
                <AvatarFallback className="bg-emerald-950 text-lg font-black text-emerald-200">{(result?.player.name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="min-w-0">
                <Badge className="border border-emerald-300/25 bg-emerald-300/10 text-emerald-200"><ShieldCheck className="mr-1 h-3.5 w-3.5" /> OPS ONLY</Badge>
                <h1 className="mt-2 truncate text-2xl font-black tracking-tight md:text-4xl">{result?.player.name ?? "Phân tích người chơi"}</h1>
                <p className="mt-1 text-sm text-zinc-400">Dữ liệu hand đã commit, phục vụ vận hành nội bộ. Không hiển thị trên Live Tracker công khai.</p>
              </div>
            </div>
            <div className="flex flex-wrap gap-2" aria-label="Khoảng thời gian">
              {DAY_OPTIONS.map((option) => (
                <button
                  key={option}
                  type="button"
                  onClick={() => startTransition(() => setDays(option))}
                  className={`min-h-11 rounded-xl border px-3 text-xs font-semibold outline-none focus-visible:ring-2 focus-visible:ring-emerald-300 ${days === option ? "border-emerald-300/45 bg-emerald-300/15 text-emerald-100" : "border-white/10 bg-black/20 text-zinc-400"}`}
                >
                  {dayLabel(option)}
                </button>
              ))}
            </div>
          </div>
        </header>

        {error && (
          <Card role="alert" className="border-rose-400/30 bg-rose-950/20 p-4">
            <div className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
              <div className="flex gap-3"><AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-rose-300" /><div><h2 className="font-semibold">Phân tích đang unavailable</h2><p className="mt-1 text-sm text-zinc-400">{errorCopy(error)}</p></div></div>
              <Button variant="outline" className="min-h-11 border-rose-300/25" onClick={() => setReloadKey((value) => value + 1)}><RefreshCw className="h-4 w-4" /> Thử lại</Button>
            </div>
          </Card>
        )}

        {loading ? (
          <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">{Array.from({ length: 9 }, (_, index) => <Skeleton key={index} className="h-[132px] rounded-2xl" />)}</div>
        ) : result ? (
          <>
            <section className="grid gap-3 sm:grid-cols-3">
              <Card className="border-white/8 bg-black/25 p-4"><div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Hand quan sát</div><div className="mt-2 font-mono text-3xl font-bold text-emerald-300">{result.analytics.handsObserved}</div></Card>
              <Card className="border-white/8 bg-black/25 p-4"><div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Settlement proof</div><div className="mt-2 text-sm font-semibold text-zinc-200">{proofCopy}</div></Card>
              <Card className="border-white/8 bg-black/25 p-4"><div className="text-xs uppercase tracking-[0.16em] text-zinc-500">Phiên bản metric</div><div className="mt-2 truncate font-mono text-sm text-amber-200">{result.analytics.metricVersion}</div></Card>
            </section>
            {result.truncated && <div className="rounded-2xl border border-amber-300/25 bg-amber-300/10 p-3 text-sm text-amber-100">Đã giới hạn 500 hand gần nhất. Chọn khoảng thời gian ngắn hơn để đọc mẫu đầy đủ.</div>}
            {GROUPS.map((group) => {
              const Icon = group.icon;
              return (
                <section key={group.title} className="rounded-3xl border border-white/8 bg-white/[0.025] p-3 md:p-5">
                  <div className="mb-3 flex items-center gap-2"><Icon className="h-5 w-5 text-emerald-300" /><h2 className="text-lg font-bold">{group.title}</h2></div>
                  <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
                    {group.keys.map((key) => <MetricCard key={key} metricKey={key} metric={result.analytics.metrics[key]} />)}
                  </div>
                </section>
              );
            })}
            <div className="flex items-start gap-3 rounded-2xl border border-sky-300/20 bg-sky-300/5 p-4 text-sm text-zinc-400">
              <BarChart3 className="mt-0.5 h-5 w-5 shrink-0 text-sky-300" />
              <p>V0 tính lại theo yêu cầu, không phải HUD đối thủ realtime. Metric có denominator bằng 0 hoặc thiếu settlement proof sẽ hiển thị — thay vì suy đoán.</p>
            </div>
          </>
        ) : null}
      </div>
    </div>
  );
}
