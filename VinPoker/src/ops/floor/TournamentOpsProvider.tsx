import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { useFloorSeats, type UseFloorSeats } from "@/components/ops/shared/useFloorSeats";
import { useOpsCapabilities } from "@/ops/auth/OpsCapabilityProvider";

export type TournamentOpsTournament = {
  id: string;
  club_id: string;
  name: string;
  status: string;
  start_time: string | null;
  buy_in: number;
  starting_stack: number;
  players_remaining: number | null;
  average_stack: number | null;
  prize_pool: number | null;
};

export type TournamentOpsEntry = {
  id: string;
  playerId: string;
  playerName: string;
  entryNumber: number;
  currentStack: number;
  finishedPlace: number | null;
  status: string;
};

export type TournamentOpsPrize = {
  id: string;
  position: number;
  amount: number;
  percentage: number;
};

export type TournamentOpsLevel = {
  id: string;
  levelNumber: number;
  smallBlind: number;
  bigBlind: number;
  ante: number;
  durationMinutes: number;
  isBreak: boolean;
};

export type TournamentOpsClock = {
  status: string;
  is_running: boolean;
  remaining_seconds: number;
  is_break?: boolean;
  message?: string | null;
  control_revision: string;
  current_level: {
    id?: string;
    level_number: number;
    small_blind?: number;
    big_blind?: number;
    ante?: number;
    duration_minutes?: number;
    is_break?: boolean;
  } | null;
  next_level?: {
    id?: string;
    level_number: number;
    small_blind?: number;
    big_blind?: number;
    ante?: number;
    duration_minutes?: number;
    is_break?: boolean;
  } | null;
};

export type TournamentOpsDisplay = {
  id: string;
  name: string | null;
  zone: string | null;
  status: string;
  layout: string;
  lastSeenAt: string | null;
};

type SnapshotErrors = Partial<Record<"entries" | "clock" | "levels" | "payout" | "screens", string>>;

type TournamentOpsContextValue = {
  tournamentId: string;
  tournament: TournamentOpsTournament | null;
  floor: UseFloorSeats;
  entries: TournamentOpsEntry[];
  prizes: TournamentOpsPrize[];
  levels: TournamentOpsLevel[];
  clock: TournamentOpsClock | null;
  displays: TournamentOpsDisplay[];
  seatEntryIds: ReadonlyMap<string, string | null>;
  loading: boolean;
  error: string | null;
  errors: SnapshotErrors;
  refreshedAt: number | null;
  refresh: () => void;
};

const TournamentOpsContext = createContext<TournamentOpsContextValue | null>(null);

export function TournamentOpsProvider({
  tournamentId,
  children,
}: {
  tournamentId: string;
  children: ReactNode;
}) {
  const client = useSupabaseClient();
  const { floorClubIds } = useOpsCapabilities();
  const floor = useFloorSeats(tournamentId, { realtime: false });
  const requestSequence = useRef(0);
  const [revision, setRevision] = useState(0);
  const [tournament, setTournament] = useState<TournamentOpsTournament | null>(null);
  const [entries, setEntries] = useState<TournamentOpsEntry[]>([]);
  const [prizes, setPrizes] = useState<TournamentOpsPrize[]>([]);
  const [levels, setLevels] = useState<TournamentOpsLevel[]>([]);
  const [clock, setClock] = useState<TournamentOpsClock | null>(null);
  const [displays, setDisplays] = useState<TournamentOpsDisplay[]>([]);
  const [seatEntryIds, setSeatEntryIds] = useState<ReadonlyMap<string, string | null>>(new Map());
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [errors, setErrors] = useState<SnapshotErrors>({});
  const [refreshedAt, setRefreshedAt] = useState<number | null>(null);
  const reloadFloor = floor.reload;
  const workspaceErrors = useMemo<SnapshotErrors>(
    () => floor.error
      ? { ...errors, entries: errors.entries ?? floor.error }
      : errors,
    [errors, floor.error],
  );

  const refresh = useCallback(() => {
    setRevision((value) => value + 1);
    void reloadFloor();
  }, [reloadFloor]);

  useEffect(() => {
    const sequence = ++requestSequence.current;
    setLoading(true);
    setError(null);
    setErrors({});

    void (async () => {
      try {
        if (floorClubIds.length === 0) throw new Error("missing_floor_scope");
        const tournamentResult = await client
          .from("tournaments")
          .select("id,club_id,name,status,start_time,buy_in,starting_stack,players_remaining,average_stack,prize_pool")
          .eq("id", tournamentId)
          .in("club_id", floorClubIds)
          .maybeSingle();
        if (sequence !== requestSequence.current) return;
        if (tournamentResult.error || !tournamentResult.data) {
          throw new Error("tournament_out_of_scope");
        }
        const nextTournament = tournamentResult.data as TournamentOpsTournament;

        const [entryResult, prizeResult, levelResult, clockResult, seatResult, displayResult] =
          await Promise.all([
            client
              .from("tournament_entries")
              .select("id,player_id,entry_no,current_stack,finished_place,status")
              .eq("tournament_id", tournamentId),
            client
              .from("tournament_prizes")
              .select("id,position,amount,percentage")
              .eq("tournament_id", tournamentId)
              .order("position"),
            client
              .from("tournament_levels")
              .select("id,level_number,small_blind,big_blind,ante,duration_minutes,is_break")
              .eq("tournament_id", tournamentId)
              .order("level_number"),
            client.rpc("get_tournament_clock", { p_tournament_id: tournamentId }),
            client
              .from("tournament_seats")
              .select("id,entry_id,player_id,entry_number,player_name,is_active")
              .eq("tournament_id", tournamentId),
            client
              .from("tv_displays")
              .select("id,name,zone,status,layout,last_seen_at")
              .eq("club_id", nextTournament.club_id)
              .eq("assigned_tournament_id", tournamentId),
          ]);
        if (sequence !== requestSequence.current) return;

        const nextErrors: SnapshotErrors = {};
        if (entryResult.error || seatResult.error) nextErrors.entries = "Không tải được danh sách người chơi.";
        if (prizeResult.error) nextErrors.payout = "Không tải được cơ cấu trả thưởng.";
        if (levelResult.error) nextErrors.levels = "Không tải được cấu trúc blind.";
        if (clockResult.error) nextErrors.clock = "Không tải được đồng hồ giải.";
        if (displayResult.error) nextErrors.screens = "Không tải được danh sách màn hình.";

        const seatRows = (seatResult.data ?? []) as {
          id: string;
          entry_id: string | null;
          player_id: string;
          entry_number: number;
          player_name: string;
          is_active: boolean;
        }[];
        const seatNameByEntry = new Map(
          seatRows
            .filter((seat) => Boolean(seat.player_name))
            .map((seat) => [`${seat.player_id}:${seat.entry_number}`, seat.player_name]),
        );
        const rawEntries = (entryResult.data ?? []) as {
          id: string;
          player_id: string;
          entry_no: number;
          current_stack: number;
          finished_place: number | null;
          status: string;
        }[];
        const missingProfileIds = [...new Set(
          rawEntries
            .filter((entry) => !seatNameByEntry.has(`${entry.player_id}:${entry.entry_no}`))
            .map((entry) => entry.player_id),
        )];
        const profileNameById = new Map<string, string>();
        if (missingProfileIds.length > 0) {
          const profileResult = await client
            .from("profiles")
            .select("user_id,display_name")
            .in("user_id", missingProfileIds);
          if (sequence !== requestSequence.current) return;
          for (const profile of profileResult.data ?? []) {
            if (profile.display_name) profileNameById.set(profile.user_id, profile.display_name);
          }
        }

        setTournament(nextTournament);
        setEntries(rawEntries.map((entry) => ({
          id: entry.id,
          playerId: entry.player_id,
          playerName:
            seatNameByEntry.get(`${entry.player_id}:${entry.entry_no}`)
            ?? profileNameById.get(entry.player_id)
            ?? `Người chơi ${entry.player_id.slice(0, 8)}`,
          entryNumber: entry.entry_no,
          currentStack: entry.current_stack,
          finishedPlace: entry.finished_place,
          status: entry.status,
        })));
        setPrizes(((prizeResult.data ?? []) as {
          id: string;
          position: number;
          amount: number;
          percentage: number;
        }[]).map((prize) => ({
          id: prize.id,
          position: prize.position,
          amount: prize.amount,
          percentage: prize.percentage,
        })));
        setLevels(((levelResult.data ?? []) as {
          id: string;
          level_number: number;
          small_blind: number;
          big_blind: number;
          ante: number;
          duration_minutes: number;
          is_break: boolean;
        }[]).map((level) => ({
          id: level.id,
          levelNumber: level.level_number,
          smallBlind: level.small_blind,
          bigBlind: level.big_blind,
          ante: level.ante,
          durationMinutes: level.duration_minutes,
          isBreak: level.is_break,
        })));
        setClock(clockResult.error ? null : (clockResult.data as unknown as TournamentOpsClock));
        setDisplays(((displayResult.data ?? []) as {
          id: string;
          name: string | null;
          zone: string | null;
          status: string;
          layout: string;
          last_seen_at: string | null;
        }[]).map((display) => ({
          id: display.id,
          name: display.name,
          zone: display.zone,
          status: display.status,
          layout: display.layout,
          lastSeenAt: display.last_seen_at,
        })));
        setSeatEntryIds(new Map(seatRows.map((seat) => [seat.id, seat.entry_id])));
        setErrors(nextErrors);
        setRefreshedAt(Date.now());
        setLoading(false);
      } catch (cause) {
        if (sequence !== requestSequence.current) return;
        setTournament(null);
        setError(
          cause instanceof Error && cause.message === "tournament_out_of_scope"
            ? "Giải đấu không thuộc phạm vi Floor của tài khoản này."
            : "Không tải được không gian giải đấu.",
        );
        setLoading(false);
      }
    })();

    return () => {
      requestSequence.current += 1;
    };
  }, [client, floorClubIds, revision, tournamentId]);

  useEffect(() => {
    let timer: ReturnType<typeof setTimeout> | null = null;
    const scheduleRefresh = () => {
      if (timer) clearTimeout(timer);
      timer = setTimeout(refresh, 200);
    };
    const channel = client
      .channel(`ops-tournament-workspace:${tournamentId}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournaments", filter: `id=eq.${tournamentId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_tables", filter: `tournament_id=eq.${tournamentId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${tournamentId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${tournamentId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_entries", filter: `tournament_id=eq.${tournamentId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_prizes", filter: `tournament_id=eq.${tournamentId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_levels", filter: `tournament_id=eq.${tournamentId}` }, scheduleRefresh)
      .on("postgres_changes", { event: "*", schema: "public", table: "tv_displays", filter: `assigned_tournament_id=eq.${tournamentId}` }, scheduleRefresh)
      .subscribe();
    return () => {
      if (timer) clearTimeout(timer);
      void client.removeChannel(channel);
    };
  }, [client, refresh, tournamentId]);

  const value = useMemo<TournamentOpsContextValue>(() => ({
    tournamentId,
    tournament,
    floor,
    entries,
    prizes,
    levels,
    clock,
    displays,
    seatEntryIds,
    loading: loading || floor.loading,
    error,
    errors: workspaceErrors,
    refreshedAt,
    refresh,
  }), [
    clock,
    displays,
    entries,
    error,
    floor,
    levels,
    loading,
    prizes,
    refresh,
    refreshedAt,
    seatEntryIds,
    tournament,
    tournamentId,
    workspaceErrors,
  ]);

  return <TournamentOpsContext.Provider value={value}>{children}</TournamentOpsContext.Provider>;
}

// eslint-disable-next-line react-refresh/only-export-components
export function useTournamentOps(): TournamentOpsContextValue {
  const value = useContext(TournamentOpsContext);
  if (!value) throw new Error("useTournamentOps must be used inside TournamentOpsProvider.");
  return value;
}
