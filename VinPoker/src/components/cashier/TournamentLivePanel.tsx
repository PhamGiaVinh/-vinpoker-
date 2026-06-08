import { useEffect, useMemo, useState, useCallback, useRef } from "react";
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

export default function TournamentLivePanel({ clubIds, clubs }: { clubIds: string[]; clubs: { id: string; name: string }[] }) {
  const { user } = useAuth();
  const [tournaments, setTournaments] = useState<Tournament[] | null>(null);
  const [selectedTournamentId, setSelectedTournamentId] = useState<string | null>(null);
  const [selectedTournament, setSelectedTournament] = useState<Tournament | null>(null);
  const [loading, setLoading] = useState(false);
  const [refreshTrigger, setRefreshTrigger] = useState(0);
  const channelRef = useRef<RealtimeChannel | null>(null);

  const loadTournaments = useCallback(async () => {
    setLoading(true);
    let q = supabase
      .from("tournaments")
      .select("*")
      .in("status", ["upcoming", "registering", "drawing", "active", "live", "break", "final_table"])
      .order("created_at", { ascending: false });
    if (clubIds.length) q = q.in("club_id", clubIds);
    const { data, error } = await q;
    if (error) { toast.error(error.message); setTournaments([]); setLoading(false); return; }
    setTournaments(data ?? []);
    setLoading(false);
  }, [clubIds]);

  useEffect(() => { loadTournaments(); }, [loadTournaments]);

  useEffect(() => {
    if (!selectedTournamentId || !tournaments) return;
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

    channel
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_hands", filter: `tournament_id=eq.${selectedTournamentId}` },
        () => {
          setRefreshTrigger((prev) => prev + 1);
          loadTournaments();
        }
      )
      .on(
        "postgres_changes",
        { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${selectedTournamentId}` },
        () => {
          setRefreshTrigger((prev) => prev + 1);
          loadTournaments();
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

  const tournamentOptions = useMemo(() => {
    if (!tournaments) return [];
    return tournaments.map((t) => ({ value: t.id, label: t.name }));
  }, [tournaments]);

  return (
    <div className="space-y-4">
      <Card className="p-4">
        <div className="flex items-center justify-between gap-3 flex-wrap">
          <div className="flex items-center gap-3 flex-wrap">
            <Select value={selectedTournamentId ?? ""} onValueChange={setSelectedTournamentId}>
              <SelectTrigger className="w-[280px]">
                <SelectValue placeholder="Chọn tournament" />
              </SelectTrigger>
              <SelectContent>
                {tournamentOptions.map((opt) => (
                  <SelectItem key={opt.value} value={opt.value}>{opt.label}</SelectItem>
                ))}
              </SelectContent>
            </Select>
            <Button size="sm" variant="outline" onClick={loadTournaments} disabled={loading}>
              <RefreshCw className={`w-3.5 h-3.5 mr-1 ${loading ? "animate-spin" : ""}`} />
              Làm mới
            </Button>
          </div>
          {selectedTournament && (
            <div className="text-xs text-muted-foreground">
              Trạng thái: <span className="font-semibold capitalize">{selectedTournament.status}</span>
              {selectedTournament.players_remaining != null && (
                <span className="ml-2">· Còn lại: {selectedTournament.players_remaining} người</span>
              )}
              {selectedTournament.average_stack != null && (
                <span className="ml-2">· AVG: {selectedTournament.average_stack.toLocaleString()}</span>
              )}
            </div>
          )}
        </div>
      </Card>

      {selectedTournament ? (
        <Tabs defaultValue="live_view" className="w-full">
          <TabsList className="grid w-full grid-cols-3 md:grid-cols-4 lg:grid-cols-8 h-auto">
            <TabsTrigger value="live_view"><Eye className="w-4 h-4 mr-1" /> Live View</TabsTrigger>
            <TabsTrigger value="clock"><Clock className="w-4 h-4 mr-1" /> Clock</TabsTrigger>
            <TabsTrigger value="table_draw"><LayoutGrid className="w-4 h-4 mr-1" /> Table Draw</TabsTrigger>
            <TabsTrigger value="hand_input"><Hand className="w-4 h-4 mr-1" /> Hand Input</TabsTrigger>
            <TabsTrigger value="hand_history"><History className="w-4 h-4 mr-1" /> History</TabsTrigger>
            <TabsTrigger value="leaderboard"><Trophy className="w-4 h-4 mr-1" /> Leaderboard</TabsTrigger>
            <TabsTrigger value="blinds"><List className="w-4 h-4 mr-1" /> Blinds</TabsTrigger>
            <TabsTrigger value="prizes"><Settings className="w-4 h-4 mr-1" /> Prizes</TabsTrigger>
          </TabsList>
          <TabsContent value="live_view" className="mt-4">
            <TournamentLiveView tournamentId={selectedTournament.id} refreshTrigger={refreshTrigger} />
          </TabsContent>
          <TabsContent value="clock" className="mt-4">
            <ClockPanel tournamentId={selectedTournament.id} refreshTrigger={refreshTrigger} />
          </TabsContent>
          <TabsContent value="table_draw" className="mt-4">
            <TableDrawPanel tournamentId={selectedTournament.id} refreshTrigger={refreshTrigger} />
          </TabsContent>
          <TabsContent value="hand_input" className="mt-4">
            <HandInputPanel tournamentId={selectedTournament.id} />
          </TabsContent>
          <TabsContent value="leaderboard" className="mt-4">
            <LeaderboardPanel tournamentId={selectedTournament.id} refreshTrigger={refreshTrigger} />
          </TabsContent>
          <TabsContent value="blinds" className="mt-4">
            <BlindStructurePanel tournamentId={selectedTournament.id} />
          </TabsContent>
          <TabsContent value="prizes" className="mt-4">
            <PrizeStructurePanel tournamentId={selectedTournament.id} />
          </TabsContent>
        </Tabs>
      ) : (
        <Card className="p-10 text-center">
          <div className="text-muted-foreground">Chọn một tournament để bắt đầu quản lý live.</div>
        </Card>
      )}
    </div>
  );
}
