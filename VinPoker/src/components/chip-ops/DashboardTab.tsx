import { useEffect, useState, type ReactNode } from "react";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { ChipDisc } from "./ChipDisc";
import { AlertTriangle, Crown, Users, Gauge, CheckCircle2 } from "lucide-react";

// Reads are open-SELECT tournament tables + the server-authoritative inventory (passed in).
const sb = supabase as any;
const fmt = (n: number) => (n ?? 0).toLocaleString("vi-VN");

interface InvDenom { denomination_id: string; value: number; color: string | null; issued_count_total: number; current_count?: number }
interface Inventory { denominations: InvDenom[]; total_value: number; reconciled: boolean }
interface Denom { id: string; value: number; color: string | null }
interface Metrics {
  status: string | null; players_remaining: number | null; average_stack: number | null;
  current_level: number | null; current_blinds: string | null;
  small_blind: number | null; big_blind: number | null; ante: number | null; is_break: boolean | null;
  leader_name: string | null; leader_chips: number | null;
}

/** Live "Tổng quan" dashboard — synced to the tournament. Read-only. */
export function DashboardTab({ tournamentId, inv, denoms }: { tournamentId: string; inv: Inventory | null; denoms: Denom[] }) {
  const [m, setM] = useState<Metrics | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!tournamentId) { setM(null); return; }
    let active = true;
    setLoading(true);
    (async () => {
      const { data: t } = await sb.from("tournaments")
        .select("status,players_remaining,average_stack,current_level,current_blinds,starting_stack")
        .eq("id", tournamentId).maybeSingle();
      let lvl: any = null;
      if (t?.current_level != null) {
        const { data: l } = await sb.from("tournament_levels")
          .select("small_blind,big_blind,ante,is_break")
          .eq("tournament_id", tournamentId).eq("level_number", t.current_level).maybeSingle();
        lvl = l;
      }
      const { data: top } = await sb.from("tournament_chip_counts")
        .select("player_id,chip_count").eq("tournament_id", tournamentId)
        .order("chip_count", { ascending: false }).limit(1);
      let leaderName: string | null = null, leaderChips: number | null = null;
      if (top && top[0]) {
        leaderChips = Number(top[0].chip_count);
        const { data: seat } = await sb.from("tournament_seats")
          .select("player_name").eq("tournament_id", tournamentId).eq("player_id", top[0].player_id).limit(1);
        leaderName = seat?.[0]?.player_name ?? null;
      }
      if (!active) return;
      setM({
        status: t?.status ?? null, players_remaining: t?.players_remaining ?? null, average_stack: t?.average_stack ?? null,
        current_level: t?.current_level ?? null, current_blinds: t?.current_blinds ?? null,
        small_blind: lvl?.small_blind ?? null, big_blind: lvl?.big_blind ?? null, ante: lvl?.ante ?? null, is_break: lvl?.is_break ?? null,
        leader_name: leaderName, leader_chips: leaderChips,
      });
      setLoading(false);
    })().catch(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [tournamentId]);

  if (!inv) {
    return (
      <Card className="border-border"><CardContent className="py-8 text-sm text-muted-foreground">
        Chưa có dữ liệu chip cho giải này. Vào tab <b className="text-foreground">Setup stack</b> để cài đặt bộ chip + mẫu stack.
      </CardContent></Card>
    );
  }

  const chipsInPlay = inv.total_value ?? 0;
  const playersLeft = m?.players_remaining ?? null;
  const computedAvg = playersLeft && playersLeft > 0 ? Math.round(chipsInPlay / playersLeft) : null;
  const bb = m?.big_blind ?? null;
  const countOf = (d: InvDenom) => d.current_count ?? d.issued_count_total;
  const currentByValue = new Map(inv.denominations.map((d) => [d.value, countOf(d)]));
  const dueDenoms = bb ? denoms.filter((d) => d.value < bb && (currentByValue.get(d.value) ?? 0) > 0) : [];

  return (
    <div className="space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <StatCard label="Chips in play" value={fmt(chipsInPlay)} accent
          sub={inv.reconciled ? "khớp số ✓" : "lệch số ⚠"} />
        <StatCard label="Average stack" icon={<Gauge className="h-3.5 w-3.5" />}
          value={computedAvg != null ? fmt(computedAvg) : "—"}
          sub={playersLeft != null ? `${fmt(chipsInPlay)} ÷ ${playersLeft}` : ""} />
        <StatCard label="Người còn lại" icon={<Users className="h-3.5 w-3.5" />}
          value={playersLeft != null ? fmt(playersLeft) : "—"} />
        <StatCard label="Chip leader" icon={<Crown className="h-3.5 w-3.5" />}
          value={m?.leader_chips != null ? fmt(m.leader_chips) : "—"} sub={m?.leader_name ?? ""} />
      </div>

      <Card className="border-border">
        <CardHeader className="flex flex-row items-center justify-between pb-3">
          <CardTitle className="text-base text-foreground">Cấu trúc hiện tại</CardTitle>
          {loading
            ? <Skeleton className="h-5 w-16" />
            : m?.status && <Badge variant="outline" className="uppercase">{m.is_break ? "break" : m.status}</Badge>}
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="grid grid-cols-3 gap-3">
            <Field k="Level" v={m?.current_level != null ? String(m.current_level) : "—"} />
            <Field k="Blinds" v={m?.small_blind != null ? `${fmt(m.small_blind)} / ${fmt(m.big_blind ?? 0)}` : (m?.current_blinds ?? "—")} />
            <Field k="Ante" v={m?.ante != null ? fmt(m.ante) : "—"} />
          </div>
          {dueDenoms.length > 0 && (
            <div className="flex items-start gap-2 rounded-lg border border-warning/30 bg-warning/10 p-3 text-sm text-warning">
              <AlertTriangle className="mt-0.5 h-4 w-4 shrink-0" />
              <div>
                Đến hạn color-up: <b>{dueDenoms.map((d) => `T${fmt(d.value)}`).join(", ")}</b> (nhỏ hơn big blind {fmt(bb ?? 0)}).{" "}
                <span className="text-muted-foreground">Color-up sẽ làm ở bước sau.</span>
              </div>
            </div>
          )}
        </CardContent>
      </Card>

      <Card className="border-border">
        <CardHeader className="pb-3"><CardTitle className="text-base text-foreground">Chip đang lưu hành</CardTitle></CardHeader>
        <CardContent>
          {inv.denominations.length === 0 ? (
            <p className="py-2 text-sm text-muted-foreground">Chưa có mẫu stack hoặc chưa phát bộ nào.</p>
          ) : (
            <div className="flex flex-wrap gap-5">
              {inv.denominations.map((d) => (
                <div key={d.denomination_id} className="flex w-20 flex-col items-center gap-2">
                  <ChipDisc value={d.value} color={d.color} size={52} />
                  <div className="font-display text-sm font-bold tabular-nums text-foreground">{fmt(d.current_count ?? d.issued_count_total)}</div>
                  <div className="text-center text-[11px] leading-tight text-muted-foreground">
                    T{fmt(d.value)}{bb && d.value < bb ? <><br /><span className="text-warning">color-up</span></> : null}
                  </div>
                </div>
              ))}
            </div>
          )}
          <div className="mt-4 flex items-center justify-between border-t border-border pt-3 text-sm">
            <span className="flex items-center gap-1.5 text-muted-foreground">
              {inv.reconciled && <CheckCircle2 className="h-4 w-4 text-primary" />} Tổng giá trị
            </span>
            <span className="font-display font-semibold tabular-nums text-foreground">{fmt(chipsInPlay)}</span>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}

function StatCard({ label, value, sub, accent, icon }: { label: string; value: string; sub?: string; accent?: boolean; icon?: ReactNode }) {
  return (
    <Card className={`border-border ${accent ? "ring-1 ring-primary/20" : ""}`}>
      <CardContent className="py-4">
        <div className="flex items-center gap-1.5 text-[11px] uppercase tracking-wide text-muted-foreground">{icon}{label}</div>
        <div className={`mt-1 font-display text-2xl font-bold tabular-nums ${accent ? "text-primary" : "text-foreground"}`}>{value}</div>
        {sub ? <div className="mt-1 text-xs text-muted-foreground">{sub}</div> : null}
      </CardContent>
    </Card>
  );
}

function Field({ k, v }: { k: string; v: string }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-muted-foreground">{k}</div>
      <div className="font-display text-lg font-semibold tabular-nums text-foreground">{v}</div>
    </div>
  );
}
