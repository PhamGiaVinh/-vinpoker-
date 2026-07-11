import { useCallback, useEffect, useId, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { buildSeatsByTable, type MapSeat, type MapTable } from "@/components/ops/shared/floorAdapter";

export interface FloorState {
  loading: boolean;
  error: string | null;
  tables: MapTable[];
  seatsByTable: Record<string, MapSeat[]>;
}
export type UseFloorSeats = FloorState & { reload: () => void };

/**
 * Đọc bàn + ghế của 1 giải — mirror FloorTableMapPanel.load() (đọc-only). DÙNG CHUNG cho màn Bàn
 * (`OpsTables`) và cockpit giải (`OpsTournamentCockpit`).
 *
 * Lifted VERBATIM từ OpsTables (P0: KHÔNG fallback mock; P0-2 stale-guard requestSeq; P1-2 realtime
 * debounce 200ms). Thêm `opts.enabled` (default true → call cũ y hệt) để cockpit không fetch khi
 * chỉ ở tab đồng hồ. Channel có nonce (useId) → 2 instance không bao giờ đụng channel.
 */
export function useFloorSeats(tournamentId: string | null, opts?: { enabled?: boolean }): UseFloorSeats {
  const enabled = opts?.enabled ?? true;
  const [state, setState] = useState<FloorState>({ loading: false, error: null, tables: [], seatsByTable: {} });
  const seqRef = useRef(0);
  const nonce = useId();

  const load = useCallback(async () => {
    const seq = ++seqRef.current; // P0-2: stale responses (đổi giải nhanh) bị drop
    if (!tournamentId || !enabled) {
      setState({ loading: false, error: null, tables: [], seatsByTable: {} });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [ttRes, seatsRes] = await Promise.all([
        supabase.from("tournament_tables")
          .select("id, table_name, table_number, max_seats, status, table_id")
          .eq("tournament_id", tournamentId),
        supabase.functions.invoke("tournament-live-draw", { body: { tournament_id: tournamentId, action: "get_seats" } }),
      ]);
      if (seq !== seqRef.current) return;
      if (ttRes.error) throw new Error(ttRes.error.message);
      if (seatsRes.error) throw new Error(typeof seatsRes.error === "string" ? seatsRes.error : (seatsRes.error as Error).message ?? "get_seats lỗi");
      const tables: MapTable[] = ((ttRes.data ?? []) as Record<string, unknown>[])
        .map((t) => ({
          tt_id: t.id as string,
          table_id: t.table_id as string,
          table_number: (t.table_number as number | null) ?? null,
          table_name: (t.table_name as string) ?? (t.table_number != null ? `Bàn ${t.table_number}` : "Bàn ?"),
          max_seats: (t.max_seats as number) ?? 9,
          status: (t.status as string) ?? "active",
        }))
        .sort((a, b) => (a.table_number ?? 1e9) - (b.table_number ?? 1e9));
      const seats = ((seatsRes.data as { data?: MapSeat[] } | null)?.data ?? []) as MapSeat[];
      setState({ loading: false, error: null, tables, seatsByTable: buildSeatsByTable(tables, seats) });
    } catch (e) {
      if (seq !== seqRef.current) return;
      // P0-1: lỗi là lỗi — hiện error state, KHÔNG fallback mock.
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Không tải được sơ đồ bàn" }));
    }
  }, [tournamentId, enabled]);

  useEffect(() => { load(); }, [load]);

  // Realtime: seats + chip_counts của giải → debounce 200ms rồi refetch (P1-2).
  useEffect(() => {
    if (!tournamentId || !enabled) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => { if (timer) clearTimeout(timer); timer = setTimeout(() => load(), 200); };
    const ch = supabase
      .channel(`ops-floor:${tournamentId}:${nonce}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${tournamentId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${tournamentId}` }, bump)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [tournamentId, enabled, nonce, load]);

  return { ...state, reload: load };
}
