import { useEffect, useMemo, useState, useCallback, useRef } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { toast } from "sonner";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import {
  Clock, LayoutGrid, Hand, Trophy, List, Settings, RefreshCw, Eye, History,
  Users, Layers, AlertTriangle, ArrowLeft, ListOrdered, Tv,
} from "lucide-react";
import type { RealtimeChannel } from "@supabase/supabase-js";
import type { Tournament, TournamentLevel, TournamentLeaderboard } from "@/types/tournament";
import { ClockPanel } from "./tournament-live/ClockPanel";
import { TableDrawPanel } from "./tournament-live/TableDrawPanel";
import { HandInputPanel } from "./tournament-live/HandInputPanel";
import { LeaderboardPanel } from "./tournament-live/LeaderboardPanel";
import { BlindStructurePanel } from "./tournament-live/BlindStructurePanel";
import { PrizeStructurePanel } from "./tournament-live/PrizeStructurePanel";
import { TournamentLiveView } from "./tournament-live/TournamentLiveView";
import { HandHistoryPanel } from "./tournament-live/HandHistoryPanel";
import { RegistrationQueuePanel } from "./tournament-live/RegistrationQueuePanel";
import { TvDisplaysPanel } from "./tournament-live/TvDisplaysPanel";

const STATUS_STYLES: Record<string, string> = {
  upcoming: "bg-muted text-muted-foreground border-border",
  registering: "bg-amber-500/15 text-amber-400 border-amber-500/30",
  drawing: "bg-purple-500/15 text-purple-400 border-purple-500/30",
  active: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  live: "bg-emerald-500/15 text-emerald-400 border-emerald-500/30",
  break: "bg-sky-500/15 text-sky-400 border-sky-500/30",
  final_table: "bg-red-500/15 text-red-400 border-red-500/30",
};

// Operator-facing labels for tournament live statuses (colors above stay per-status).
const STATUS_LABELS: Record<string, string> = {
  upcoming: "Sắp diễn ra",
  registering: "Đang đăng ký",
  drawing: "Bốc thăm chỗ",
  active: "Đang chơi",
  live: "LIVE",
  break: "Giải lao",
  final_table: "Final Table",
};

function statusLabel(status: string): string {
  return STATUS_LABELS[status] ?? status.replace(/_/g, " ");
}

// Statuses where the floor still has setup work to do before play runs smoothly.
const NEEDS_ATTENTION_STATUSES = new Set(["registering", "drawing"]);

function StatusBadge({ status }: { status: string }) {
  return (
    <span
      className={`inline-flex px-2 py-0.5 rounded-md text-[10px] font-bold uppercase tracking-wide border ${
        STATUS_STYLES[status] || STATUS_STYLES.upcoming
      }`}
    >
      {statusLabel(status)}
    </span>
  );
}

// Which tabs each operator role sees. "full" preserves the original panel
// (default, so existing call sites are unchanged); tracker = live-tracking view,
// floor = room-management view. live_view is in every set, so defaultValue stays valid.
const MODE_TABS: Record<string, string[]> = {
  full: ["live_view", "clock", "table_draw", "queue", "hand_input", "hand_history", "leaderboard", "blinds", "prizes", "tv_displays"],
  tracker: ["live_view", "clock", "hand_input", "hand_history", "leaderboard", "blinds", "tv_displays"],
  floor: ["live_view", "table_draw", "queue", "prizes"],
};

export default function TournamentLivePanel({ clubIds, clubs, mode = "full" }: { clubIds: string[]; clubs: { id: string; name: string }[]; mode?: "full" | "tracker" | "floor" }) {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(false);
  const [listError, setListError] = useState<string | null>(null);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const clubNameMap = useMemo(() => {
    const m: Record<string, string> = {};
    clubs.forEach((c) => { m[c.id] = c.name; });
    return m;
  }, [clubs]);

  const loadTournaments = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("tournaments")
      .select("*")
      .in("status", ["upcoming", "registering", "drawing", "active", "live", "break", "final_table"])
      .order("created_at", { ascending: false });
    if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    if (error) {
      toast.error(error.message);
      setListError(error.message);
      setLoading(false);
      return;
    }
    setListError(null);
    setTournaments((data as unknown as Tournament[]) ?? []);
    setLoading(false);
  }, [clubIds]);

  useEffect(() => { loadTournaments(); }, [loadTournaments]);

  useEffect(() => {
    if (!selectedTournamentId) {
      setSelectedTournament(null);
      return;
    }
    if (!tournaments) return;
    const t = tournaments.find((x) => x.id === selectedTournamentId) ?? null;
    setSelectedTournament(t);
  }, [selectedTournamentId, tournaments]);

  useEffect(() => {
    if (!selectedTournamentId) {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
      return;
    }

    if (channelRef.current) {
      supabase.removeChannel(channelRef.current);
    }

    const channel = supabase.channel(`tournament-live:${selectedTournamentId}`);

    // hands/chips/seats events only bump refreshTrigger for the tab panels that
    // have no realtime channel of their own (TableDraw, Clock, Leaderboard).
    // Reloading the whole tournament list belongs to `tournaments` UPDATE only.
    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_hands", filter: `tournament_id=eq.${selectedTournamentId}` },
        () => {
          setRefreshTrigger((prev) => prev + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${selectedTournamentId}` },
        () => {
          setRefreshTrigger((prev) => prev + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${selectedTournamentId}` },
        () => {
          setRefreshTrigger((prev) => prev + 1);
        }
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "tournaments", filter: `id=eq.${selectedTournamentId}` },
        () => {
          loadTournaments();
        }
      )
      .subscribe();

    channelRef.current = channel;

    return () => {
      if (channelRef.current) {
        supabase.removeChannel(channelRef.current);
        channelRef.current = null;
      }
    };
  }, [selectedTournamentId, loadTournaments]);

  const needsAttention = useMemo(
    () => (tournaments ?? []).filter((t) => NEEDS_ATTENTION_STATUSES.has(t.status)),
    [tournaments]
  );

  const renderOverview = () => {
    if (listError && (!tournaments || tournaments.length === 0)) {
      return (
        <Card className="p-8 text-center space-y-3">
          <AlertTriangle className="w-8 h-8 mx-auto text-destructive" />
          <div className="font-semibold">Không tải được danh sách giải</div>
          <p className="text-xs text-muted-foreground break-all">{listError}</p>
          <Button size="sm" variant="outline" onClick={loadTournaments} disabled={loading}>
            <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} /> Thử lại
          </Button>
        </Card>
      );
    }

    if (tournaments === null) {
      return (
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {[1, 2, 3].map((i) => (
            <Skeleton key={i} className="h-28 rounded-xl" />
          ))}
        </div>
      );
    }

    if (tournaments.length === 0) {
      return (
        <Card className="p-10 text-center">
          <div className="text-muted-foreground">Không có giải active</div>
        </Card>
      );
    }

    return (
      <div className="space-y-3">
        {needsAttention.length > 0 && (
          <div className="px-3 py-2 bg-amber-500/10 border border-amber-500/30 rounded-lg">
            <div className="text-[10px] font-bold text-amber-400 uppercase tracking-widest mb-1">
              Cần chú ý
            </div>
            <div className="flex flex-wrap gap-2">
              {needsAttention.map((t) => (
                <button
                  key={t.id}
                  onClick={() => setSelectedTournamentId(t.id)}
                  className="flex items-center gap-2 px-2.5 py-1 rounded-md bg-card border border-amber-500/30 text-xs hover:border-amber-400/60 transition-colors"
                >
                  <span className="font-semibold">{t.name}</span>
                  <StatusBadge status={t.status} />
                </button>
              ))}
            </div>
          </div>
        )}

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-3">
          {tournaments.map((t) => (
            <button
              key={t.id}
              onClick={() => setSelectedTournamentId(t.id)}
              className="text-left p-4 rounded-xl bg-card border border-border hover:border-emerald-500/50 transition-colors space-y-2"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="font-semibold leading-tight">{t.name}</div>
                <StatusBadge status={t.status} />
              </div>
              {clubNameMap[t.club_id] && (
                <div className="text-xs text-muted-foreground">{clubNameMap[t.club_id]}</div>
              )}
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1">
                  <Users className="w-3.5 h-3.5" />
                  {t.players_remaining != null ? t.players_remaining : "—"}
                </span>
                <span className="flex items-center gap-1">
                  <Layers className="w-3.5 h-3.5" />
                  {t.average_stack != null ? t.average_stack.toLocaleString() : "—"}
                </span>
              </div>
            </button>
          ))}
        </div>
      </div>
    );
  };

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            {selectedTournament && (
              <Button size="sm" variant="ghost" onClick={() => setSelectedTournamentId(null)}>
                <ArrowLeft className="w-3.5 h-3.5 mr-1" /> Tất cả giải
              </Button>
            )}
            <Select value={selectedTournamentId ?? ""} onValueChange={setSelectedTournamentId}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder={t("tournamentLive.selectTournament")} />
              </SelectTrigger>
              <SelectContent>
                {(tournaments ?? []).map((tour) => (
                  <SelectItem key={tour.id} value={tour.id}>
                    <span className="flex items-center gap-2">
                      <span>{tour.name}</span>
                      <span className="text-[10px] text-muted-foreground uppercase">
                        {statusLabel(tour.status)}
                        {clubNameMap[tour.club_id] ? ` · ${clubNameMap[tour.club_id]}` : ""}
                      </span>
                    </span>
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={loadTournaments} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          </div>
          {selectedTournament && (
            <div className="flex items-center gap-2 text-xs text-muted-foreground">
              <StatusBadge status={selectedTournament.status} />
              {selectedTournament.players_remaining != null && (
                <span>· {t("tournamentLive.liveView.playersRemaining")}: {selectedTournament.players_remaining}</span>
              )}
              {selectedTournament.average_stack != null && (
                <span>· AVG: {selectedTournament.average_stack.toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
      </Card>

      {selectedTournament ? (
        (() => {
          const TAB_DEFS = [
            { value: "live_view", icon: Eye, label: t("tournamentLive.liveView.title"), render: () => <TournamentLiveView tournamentId={selectedTournament.id} /> },
            { value: "clock", icon: Clock, label: t("tournamentLive.clock.title"), render: () => <ClockPanel tournamentId={selectedTournament.id} refreshTrigger={refreshTrigger} /> },
            { value: "table_draw", icon: LayoutGrid, label: t("tournamentLive.tableDraw.title"), render: () => <TableDrawPanel tournamentId={selectedTournament.id} refreshTrigger={refreshTrigger} /> },
            { value: "queue", icon: ListOrdered, label: "Hàng chờ", render: () => (
              <RegistrationQueuePanel
                tournamentId={selectedTournament.id}
                tournamentName={selectedTournament.name}
                tournamentDate={(selectedTournament as Tournament & { start_time?: string | null }).start_time ?? null}
                refreshTrigger={refreshTrigger}
              />
            ) },
            { value: "hand_input", icon: Hand, label: t("tournamentLive.tabs.input"), render: () => <HandInputPanel tournamentId={selectedTournament.id} /> },
            { value: "hand_history", icon: History, label: t("tournamentLive.handHistory.title"), render: () => <HandHistoryPanel tournamentId={selectedTournament.id} /> },
            { value: "leaderboard", icon: Trophy, label: t("tournamentLive.leaderboard.title"), render: () => <LeaderboardPanel tournamentId={selectedTournament.id} refreshTrigger={refreshTrigger} /> },
            { value: "blinds", icon: List, label: t("tournamentLive.tabs.blinds"), render: () => <BlindStructurePanel tournamentId={selectedTournament.id} /> },
            { value: "prizes", icon: Settings, label: t("tournamentLive.tabs.prizes"), render: () => <PrizeStructurePanel tournamentId={selectedTournament.id} /> },
            { value: "tv_displays", icon: Tv, label: t("tournamentLive.tvDisplays.tab"), render: () => (
              <TvDisplaysPanel
                tournamentId={selectedTournament.id}
                tournamentName={selectedTournament.name}
                clubId={selectedTournament.club_id}
                tournaments={(tournaments ?? []).map((tour) => ({
                  id: tour.id,
                  name: tour.name,
                  club_id: tour.club_id,
                  status: tour.status,
                }))}
              />
            ) },
          ];
          const allowed = MODE_TABS[mode] ?? MODE_TABS.full;
          const visibleTabs = TAB_DEFS.filter((td) => allowed.includes(td.value));
          const defaultTab = visibleTabs.some((td) => td.value === "live_view") ? "live_view" : visibleTabs[0]?.value;
          return (
            <Tabs defaultValue={defaultTab} className="w-full">
              <div className="overflow-x-auto -mx-2 px-2 pb-1">
                <TabsList className="inline-flex w-max min-w-full">
                  {visibleTabs.map((td) => {
                    const Icon = td.icon;
                    return (
                      <TabsTrigger key={td.value} value={td.value}><Icon className="w-4 h-4 mr-1" /> {td.label}</TabsTrigger>
                    );
                  })}
                </TabsList>
              </div>
              {visibleTabs.map((td) => (
                <TabsContent key={td.value} value={td.value} className="mt-4">{td.render()}</TabsContent>
              ))}
            </Tabs>
          );
        })()
      ) : (
        renderOverview()
      )}
    </div>
  );
}
