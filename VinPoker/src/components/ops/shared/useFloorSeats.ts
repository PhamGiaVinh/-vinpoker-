import { useCallback, useEffect, useId, useMemo, useRef, useState } from "react";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import {
  buildCanonicalOperationalFloor,
  type MapSeat,
  type MapTable,
} from "@/components/ops/shared/floorAdapter";
import { createFloorTableControlV3Client, type FloorTableControlV3Rpc } from "@/lib/floorTableControlV3";
import { parseTournamentParticipation } from "@/lib/tournamentParticipation";
import { useOpsAuth } from "@/ops/auth/OpsAuthProvider";

export interface FloorState {
  loading: boolean;
  error: string | null;
  repairWarnings?: string[];
  readOnlyReason?: string | null;
  tables: MapTable[];
  seatsByTable: Record<string, MapSeat[]>;
}
export type UseFloorSeats = FloorState & { reload: () => void };

/**
 * Canonical session inventory + participation for OpsTables and OpsTournamentCockpit.
 * Preserve actual seat IDs, reject late scope responses, and disable writes while
 * refreshing or when integrity cannot be established. No legacy Edge read fallback.
 */
export function useFloorSeats(tournamentId: string | null, opts?: { enabled?: boolean }): UseFloorSeats {
  const supabase = useSupabaseClient();
  const { user } = useOpsAuth();
  const actorId = user?.id ?? null;
  const canonical = useMemo(() => createFloorTableControlV3Client(
    supabase.rpc.bind(supabase) as unknown as FloorTableControlV3Rpc,
  ), [supabase]);
  const readParticipation = useMemo(() => supabase.rpc.bind(supabase) as unknown as (
    name: "get_tournament_participation_v1", args: { p_tournament_id: string },
  ) => Promise<{ data: unknown; error: { message: string } | null }>, [supabase]);
  const enabled = opts?.enabled ?? true;
  const scope = JSON.stringify([actorId, tournamentId, enabled]);
  const [state, setState] = useState<FloorState & { scope: string }>({ scope, loading: false, error: null, tables: [], seatsByTable: {} });
  const seqRef = useRef(0);
  const nonce = useId();

  const load = useCallback(async () => {
    const seq = ++seqRef.current; // P0-2: stale responses (đổi giải nhanh) bị drop
    if (!tournamentId || !enabled || !actorId) {
      setState({ scope, loading: false, error: null, tables: [], seatsByTable: {} });
      return;
    }
    setState((s) => ({ ...s, loading: true, error: null }));
    try {
      const [inventory, participation] = await Promise.all([
        canonical.getTournamentTableInventory(tournamentId),
        readParticipation("get_tournament_participation_v1", { p_tournament_id: tournamentId }),
      ]);
      if (seq !== seqRef.current) return;
      if (inventory.ok === false) throw new Error(inventory.error);
      if (participation.error) throw new Error(participation.error.message);
      const projection = buildCanonicalOperationalFloor(inventory.data,
        parseTournamentParticipation(participation.data, tournamentId));
      setState({
        scope,
        loading: false,
        error: null,
        ...projection,
      });
    } catch (e) {
      if (seq !== seqRef.current) return;
      // P0-1: lỗi là lỗi — hiện error state, KHÔNG fallback mock.
      setState((s) => ({ ...s, loading: false, error: e instanceof Error ? e.message : "Không tải được sơ đồ bàn" }));
    }
  }, [tournamentId, enabled, canonical, readParticipation, actorId, scope]);

  useEffect(() => {
    setState({ scope, loading: Boolean(tournamentId && enabled && actorId), error: null, tables: [], seatsByTable: {} });
    void load();
    return () => { ++seqRef.current; };
  }, [load, tournamentId, enabled, actorId, scope]);

  // Realtime: seats + chip_counts của giải → debounce 200ms rồi refetch (P1-2).
  useEffect(() => {
    if (!tournamentId || !enabled || !actorId) return;
    let timer: ReturnType<typeof setTimeout> | null = null;
    const bump = () => {
      // An event invalidates write context now, not after the debounced read.
      // Also discard any older snapshot still in flight during this window.
      ++seqRef.current;
      setState((state) => ({ ...state, loading: true }));
      if (timer) clearTimeout(timer);
      timer = setTimeout(() => { timer = null; void load(); }, 200);
    };
    const ch = supabase
      .channel(`ops-floor:${tournamentId}:${nonce}`)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_seats", filter: `tournament_id=eq.${tournamentId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_chip_counts", filter: `tournament_id=eq.${tournamentId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "tournament_tables", filter: `tournament_id=eq.${tournamentId}` }, bump)
      .on("postgres_changes", { event: "*", schema: "public", table: "table_sessions", filter: `tournament_id=eq.${tournamentId}` }, bump)
      .subscribe();
    return () => { if (timer) clearTimeout(timer); supabase.removeChannel(ch); };
  }, [tournamentId, enabled, nonce, load, supabase]);

  const visible = state.scope === scope ? state : { loading: true, error: null, tables: [], seatsByTable: {}, repairWarnings: [] };
  const readOnlyReason = !actorId || !tournamentId || !enabled ? "Chưa xác minh phạm vi vận hành."
    : visible.loading ? "Đang xác minh dữ liệu; chờ tải xong trước khi thao tác."
    : visible.error ? "Không xác minh được dữ liệu. Hãy tải lại trước khi thao tác."
    : visible.repairWarnings?.length ? "Có dữ liệu cần sửa; chỉ xem cho tới khi kiểm tra xong." : null;
  return { ...visible, readOnlyReason, reload: load };
}
