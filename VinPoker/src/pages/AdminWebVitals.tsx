import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { useQuery } from "@tanstack/react-query";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { ArrowLeft, Activity, Loader2 } from "lucide-react";

type Row = {
  id: string;
  created_at: string;
  metric_name: string;
  metric_value: number;
  rating: string | null;
  page: string | null;
  navigation_type: string | null;
  user_agent: string | null;
};

const RANGES: Record<string, number> = {
  "1h": 1,
  "24h": 24,
  "7d": 24 * 7,
  "30d": 24 * 30,
};

const METRICS = ["LCP", "INP", "CLS", "FCP", "TTFB"] as const;

const fmt = (name: string, v: number) => {
  if (name === "CLS") return v.toFixed(3);
  return `${Math.round(v)} ms`;
};

const ratingColor = (r: string | null) => {
  if (r === "good") return "bg-emerald-500/15 text-emerald-600 border-emerald-500/30";
  if (r === "needs-improvement") return "bg-amber-500/15 text-amber-600 border-amber-500/30";
  if (r === "poor") return "bg-red-500/15 text-red-600 border-red-500/30";
  return "bg-muted text-muted-foreground";
};

const percentile = (arr: number[], p: number) => {
  if (!arr.length) return 0;
  const sorted = [...arr].sort((a, b) => a - b);
  const idx = Math.min(sorted.length - 1, Math.floor((p / 100) * sorted.length));
  return sorted[idx];
};

const AdminWebVitals = () => {
  const nav = useNavigate();
  const { user } = useAuth();
  const [authorized, setAuthorized] = useState<boolean | null>(null);
  const [range, setRange] = useState<keyof typeof RANGES>("24h");

  useEffect(() => {
    (async () => {
      if (!user) {
        setAuthorized(false);
        return;
      }
      const { data } = await supabase
        .from("user_roles")
        .select("role")
        .eq("user_id", user.id);
      const ok = (data || []).some((r: any) => r.role === "super_admin");
      setAuthorized(ok);
    })();
  }, [user]);

  const sinceISO = useMemo(() => {
    const d = new Date();
    d.setHours(d.getHours() - RANGES[range]);
    return d.toISOString();
  }, [range]);

  const { data, isLoading, isFetching, refetch } = useQuery({
    queryKey: ["web-vitals", range, authorized],
    enabled: authorized === true,
    staleTime: 60 * 1000,
    placeholderData: (prev) => prev,
    queryFn: async (): Promise<Row[]> => {
      const { data, error } = await supabase
        .from("web_vitals_events")
        .select("id,created_at,metric_name,metric_value,rating,page,navigation_type,user_agent")
        .gte("created_at", sinceISO)
        .order("created_at", { ascending: false })
        .limit(1000);
      if (error) throw error;
      return (data || []) as Row[];
    },
  });

  const stats = useMemo(() => {
    const out: Record<string, { count: number; p75: number; good: number; ni: number; poor: number }> = {};
    for (const m of METRICS) {
      const rows = (data || []).filter((r) => r.metric_name === m);
      const values = rows.map((r) => Number(r.metric_value));
      out[m] = {
        count: rows.length,
        p75: percentile(values, 75),
        good: rows.filter((r) => r.rating === "good").length,
        ni: rows.filter((r) => r.rating === "needs-improvement").length,
        poor: rows.filter((r) => r.rating === "poor").length,
      };
    }
    return out;
  }, [data]);

  const topPages = useMemo(() => {
    const map = new Map<string, number>();
    for (const r of data || []) {
      const k = r.page || "(unknown)";
      map.set(k, (map.get(k) || 0) + 1);
    }
    return [...map.entries()].sort((a, b) => b[1] - a[1]).slice(0, 10);
  }, [data]);

  if (authorized === null) {
    return (
      <div className="container max-w-3xl mx-auto p-6 flex items-center justify-center min-h-[40vh]">
        <Loader2 className="w-5 h-5 animate-spin text-muted-foreground" />
      </div>
    );
  }
  if (!authorized) {
    return (
      <div className="container max-w-3xl mx-auto p-6">
        <Card className="p-6 text-center text-muted-foreground">
          Bạn không có quyền truy cập trang này.
        </Card>
      </div>
    );
  }

  return (
    <div className="container max-w-5xl mx-auto p-4 space-y-4">
      <div className="flex items-center gap-2">
        <Button variant="ghost" size="icon" onClick={() => nav(-1)}>
          <ArrowLeft className="w-4 h-4" />
        </Button>
        <Activity className="w-5 h-5 text-primary" />
        <h1 className="text-xl font-semibold">Thống kê hiệu năng (Web Vitals)</h1>
        {isFetching && <Loader2 className="w-4 h-4 animate-spin text-muted-foreground ml-2" />}
      </div>

      <div className="flex flex-wrap gap-2">
        {(Object.keys(RANGES) as (keyof typeof RANGES)[]).map((k) => (
          <Button
            key={k}
            size="sm"
            variant={range === k ? "default" : "outline"}
            onClick={() => setRange(k)}
          >
            {k}
          </Button>
        ))}
        <Button size="sm" variant="ghost" onClick={() => refetch()}>
          Làm mới
        </Button>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {METRICS.map((m) => {
          const s = stats[m];
          return (
            <Card key={m} className="p-3">
              <div className="text-xs text-muted-foreground">{m} (p75)</div>
              <div className="text-2xl font-bold mt-1">
                {s.count ? fmt(m, s.p75) : "—"}
              </div>
              <div className="text-xs text-muted-foreground mt-1">{s.count} mẫu</div>
              <div className="flex gap-1 mt-2 text-[10px]">
                <span className="px-1.5 rounded bg-emerald-500/15 text-emerald-600">
                  {s.good}
                </span>
                <span className="px-1.5 rounded bg-amber-500/15 text-amber-600">
                  {s.ni}
                </span>
                <span className="px-1.5 rounded bg-red-500/15 text-red-600">
                  {s.poor}
                </span>
              </div>
            </Card>
          );
        })}
      </div>

      <Card className="p-4">
        <div className="font-medium mb-2">Top trang ({(data || []).length} sự kiện)</div>
        {isLoading ? (
          <div className="text-sm text-muted-foreground">Đang tải…</div>
        ) : topPages.length === 0 ? (
          <div className="text-sm text-muted-foreground">Chưa có dữ liệu trong khoảng thời gian này.</div>
        ) : (
          <div className="space-y-1">
            {topPages.map(([p, c]) => (
              <div key={p} className="flex items-center justify-between text-sm border-b border-border/50 py-1.5 last:border-0">
                <span className="truncate mr-2 font-mono text-xs">{p}</span>
                <span className="text-muted-foreground">{c}</span>
              </div>
            ))}
          </div>
        )}
      </Card>

      <Card className="p-4">
        <div className="font-medium mb-2">Sự kiện gần đây</div>
        <div className="overflow-x-auto">
          <table className="w-full text-xs">
            <thead className="text-muted-foreground">
              <tr className="text-left">
                <th className="py-1 pr-2">Thời gian</th>
                <th className="py-1 pr-2">Metric</th>
                <th className="py-1 pr-2">Giá trị</th>
                <th className="py-1 pr-2">Rating</th>
                <th className="py-1 pr-2">Trang</th>
              </tr>
            </thead>
            <tbody>
              {(data || []).slice(0, 50).map((r) => (
                <tr key={r.id} className="border-t border-border/50">
                  <td className="py-1 pr-2 whitespace-nowrap">
                    {new Date(r.created_at).toLocaleString()}
                  </td>
                  <td className="py-1 pr-2 font-medium">{r.metric_name}</td>
                  <td className="py-1 pr-2">{fmt(r.metric_name, Number(r.metric_value))}</td>
                  <td className="py-1 pr-2">
                    <Badge variant="outline" className={ratingColor(r.rating)}>
                      {r.rating || "—"}
                    </Badge>
                  </td>
                  <td className="py-1 pr-2 font-mono truncate max-w-[200px]">{r.page}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </Card>
    </div>
  );
};

export default AdminWebVitals;
