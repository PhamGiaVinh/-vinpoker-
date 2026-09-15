import { useCallback, useEffect, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";

export type TournamentRedrawTvMove = {
  ordinal: number;
  playerName: string;
  fromTableNumber: number;
  fromSeatNumber: number;
  toTableNumber: number;
  toSeatNumber: number;
};

export type TournamentRedrawTvBatch = {
  batchId: string;
  tournamentName: string;
  targetMaxSeats: 8 | 9;
  appliedAt: string;
  moves: TournamentRedrawTvMove[];
};

export function useTournamentRedrawTv(tournamentId: string | undefined, enabled: boolean) {
  const supabase = useSupabaseClient();
  const [data, setData] = useState<TournamentRedrawTvBatch | null>(null);
  const [state, setState] = useState<"loading" | "ready" | "stale" | "empty" | "error">("loading");
  const seq = useRef(0);
  const lastGood = useRef<TournamentRedrawTvBatch | null>(null);

  const refresh = useCallback(async () => {
    if (!enabled || !tournamentId) return;
    const request = ++seq.current;
    const { data: raw, error } = await (supabase.rpc as unknown as (
      name: "get_public_tournament_redraw_v1",
      args: { p_tournament_id: string },
    ) => Promise<{ data: unknown; error: unknown | null }>)("get_public_tournament_redraw_v1", { p_tournament_id: tournamentId });
    if (request !== seq.current) return;
    if (error) {
      setState(lastGood.current ? "stale" : "error");
      return;
    }
    const parsed = parseTournamentRedrawTvBatch(raw);
    if (parsed === "empty") {
      setData(null);
      setState("empty");
    } else if (!parsed) {
      setData(null);
      setState("error");
    } else {
      lastGood.current = parsed;
      setData(parsed);
      setState("ready");
    }
  }, [enabled, supabase, tournamentId]);

  useEffect(() => {
    if (!enabled) return;
    lastGood.current = null;
    setData(null);
    setState("loading");
    void refresh();
    const id = window.setInterval(() => { if (document.visibilityState === "visible") void refresh(); }, 4_000);
    const visible = () => { if (document.visibilityState === "visible") void refresh(); };
    document.addEventListener("visibilitychange", visible);
    return () => {
      seq.current += 1;
      window.clearInterval(id);
      document.removeEventListener("visibilitychange", visible);
    };
  }, [enabled, refresh]);

  return { data, state, refresh };
}

export function parseTournamentRedrawTvBatch(value: unknown): TournamentRedrawTvBatch | "empty" | null {
  if (!value || typeof value !== "object" || Array.isArray(value)) return null;
  const row = value as Record<string, unknown>;
  if (row.batch_id == null) return "empty";
  if (
    typeof row.batch_id !== "string"
    || typeof row.tournament_name !== "string" || !row.tournament_name.trim()
    || (row.target_max_seats !== 8 && row.target_max_seats !== 9)
    || typeof row.applied_at !== "string"
    || !Array.isArray(row.moves)
  ) return null;
  const moves: TournamentRedrawTvMove[] = [];
  const ordinals = new Set<number>();
  const targets = new Set<string>();
  for (const value of row.moves) {
    if (!value || typeof value !== "object" || Array.isArray(value)) return null;
    const move = value as Record<string, unknown>;
    if (
      typeof move.player_name !== "string" || !move.player_name.trim()
      || typeof move.ordinal !== "number" || !Number.isSafeInteger(move.ordinal) || move.ordinal < 1
      || !validTable(move.from_table_number) || !validTable(move.to_table_number)
      || !validSeat(move.from_seat_number) || !validSeat(move.to_seat_number)
      || move.to_seat_number > row.target_max_seats
    ) return null;
    const target = `${move.to_table_number}:${move.to_seat_number}`;
    if (ordinals.has(move.ordinal) || targets.has(target)) return null;
    ordinals.add(move.ordinal);
    targets.add(target);
    moves.push({
      ordinal: move.ordinal,
      playerName: move.player_name,
      fromTableNumber: move.from_table_number,
      fromSeatNumber: move.from_seat_number,
      toTableNumber: move.to_table_number,
      toSeatNumber: move.to_seat_number,
    });
  }
  return { batchId: row.batch_id, tournamentName: row.tournament_name, targetMaxSeats: row.target_max_seats, appliedAt: row.applied_at, moves };
}

function validTable(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 100;
}

function validSeat(value: unknown): value is number {
  return typeof value === "number" && Number.isSafeInteger(value) && value >= 1 && value <= 9;
}
