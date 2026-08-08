import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { PlayerActionSheets } from "@/components/ops/shared/PlayerActionSheets";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
import { buildEligibleFloorMoveTargets, type MapSeat } from "@/components/ops/shared/floorAdapter";
import type { MockSeat } from "@/components/ops/mock/opsData";
import type { UseFloorSeats } from "@/components/ops/shared/useFloorSeats";
import { preflightFloorSeatEntry } from "@/components/ops/shared/floorSeatEntryPreflight";
import { floorOpsErrorMessage, floorOpsFunctionErrorCode } from "@/lib/floorOpsErrors";
import { findFloorTableControlRow } from "@/lib/floorTableControlMode";

type UnappliedFloorRpcResult = { data: unknown; error: { message?: string; code?: string } | null };
/**
 * FloorPlayerActions — host DÙNG CHUNG cho luồng thao tác người chơi trên floor (màn Bàn + cockpit).
 * Giữ TOÀN BỘ state ghi + handler money-path (Sửa chip / Loại / Chuyển / Phiếu) + render
 * PlayerActionSheets + SeatReceiptDialog ở MỘT NƠI DUY NHẤT — được lift NGUYÊN VĂN từ OpsTables
 * (chỉ đổi nguồn biến: playerReal→target.real, tourId/user/floor.reload/selectedTour → props).
 *
 * Chỉ nhận target là GHẾ ĐANG NGỒI (đang chơi, có `MapSeat` thật). Người đã busted KHÔNG có ghế
 * active → hiển thị read-only ở danh sách, KHÔNG đưa vào đây (tránh sửa chip "hồi sinh"/move fail).
 */
export interface FloorSeatTarget {
  seat: MockSeat;   // presentational (PlayerActionSheets)
  tableNo: number;
  real: MapSeat;    // identity ghế THẬT để ghi update_seats / move / receipt
}

export function FloorPlayerActions({
  tournamentId, tournamentName, tournamentDate, floor, target, onClose,
}: {
  tournamentId: string | null;
  tournamentName: string;
  tournamentDate: string | null;
  floor: UseFloorSeats;
  target: FloorSeatTarget | null;
  onClose: () => void;
}) {
  const supabase = useSupabaseClient();
  const untypedFloorRpc = useMemo(
    () => supabase.rpc.bind(supabase) as unknown as (
      name: string,
      args: Record<string, unknown>,
    ) => Promise<UnappliedFloorRpcResult>,
    [supabase],
  );
  const real = target?.real ?? null;
  const bustTable = useMemo(
    () => findFloorTableControlRow(floor.tables, real?.table_id),
    [floor.tables, real?.table_id],
  );
  const chipEditDisabledReason = !real
    ? null
    : !bustTable
      ? "Không xác minh được chế độ bàn. Hãy tải lại trước khi sửa chip."
      : bustTable.floor_control_mode === "tracker"
        ? "Bàn Live Tracker do Tracker quản lý chip."
        : null;
  const [bustInfo, setBustInfo] = useState<{ loading: boolean; place: number | null; prize: number | null } | null>(null);
  const [receiptData, setReceiptData] = useState<SeatReceiptData | null>(null);

  const verifyActiveEntry = useCallback(async (): Promise<boolean> => {
    if (!real || !tournamentId) {
      toast.error("Thiếu dữ liệu ghế — mở lại người chơi.");
      return false;
    }
    try {
      const { data, error } = await supabase.from("tournament_seats")
        .select("id, entry_id, is_active")
        .eq("id", real.seat_id)
        .eq("tournament_id", tournamentId)
        .maybeSingle();
      if (error) {
        toast.error("Không kiểm tra được lượt đăng ký của ghế. Hãy tải lại trước khi thao tác.");
        return false;
      }
      const result = preflightFloorSeatEntry(data);
      if (result.ok === false) {
        toast.error(floorOpsErrorMessage(result.error, "Không thể xác minh lượt đăng ký của ghế."));
        return false;
      }
      return true;
    } catch {
      toast.error("Không kiểm tra được lượt đăng ký của ghế. Hãy tải lại trước khi thao tác.");
      return false;
    }
  }, [real, supabase, tournamentId]);

  // Sửa chip qua Edge với compare-and-set theo chip hiện tại; không cập nhật lạc hậu ở client.
  const saveChip = useCallback(async (newChip: number): Promise<boolean> => {
    if (!real || !tournamentId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    if (!bustTable) {
      toast.error("Không xác minh được chế độ bàn. Hãy tải lại trước khi sửa chip.");
      return false;
    }
    if (bustTable.floor_control_mode === "tracker") {
      toast.error("Bàn Live Tracker do Tracker quản lý chip.");
      return false;
    }
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId,
          action: "update_seats",
          seats: [{
            seat_id: real.seat_id, player_id: real.player_id, entry_number: real.entry_number,
            table_id: real.table_id, seat_number: real.seat_number,
            expected_chip_count: real.chip_count ?? 0, chip_count: newChip,
            is_active: true, player_name: real.player_name,
          }],
        },
      });
      const code = await floorOpsFunctionErrorCode(data, error);
      if (code) { toast.error(floorOpsErrorMessage(code, "Sửa chip thất bại")); return false; }
      toast.success(`Đã cập nhật chip ${real.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Sửa chip thất bại");
      return false;
    }
  }, [real, tournamentId, floor, bustTable, supabase]);

  // Loại qua Edge/RPC nguyên tử, audit-only: luồng này không gọi payout dù một
  // feature flag khác có thay đổi trong tương lai.
  const openBust = useCallback(async (): Promise<boolean> => {
    if (!real || !tournamentId) return false;
    if (!bustTable) {
      toast.error("Không xác minh được chế độ bàn. Hãy tải lại trước khi loại.");
      return false;
    }
    if (bustTable.floor_control_mode === "tracker" && real.chip_count > 0) {
      toast.error("Bàn Live Tracker chỉ cho phép loại khi chip đã về 0.");
      return false;
    }
    if (!await verifyActiveEntry()) return false;
    setBustInfo({ loading: true, place: null, prize: null });
    try {
      const [seatsRes, prizeRes] = await Promise.all([
        supabase.functions.invoke("tournament-live-draw", { body: { tournament_id: tournamentId, action: "get_seats" } }),
        supabase.from("tournament_prizes").select("position, amount").eq("tournament_id", tournamentId),
      ]);
      const active = (((seatsRes.data as { data?: MapSeat[] } | null)?.data ?? []) as MapSeat[]).filter((x) => x.is_active).length;
      const place = active > 0 ? active : null;
      const prize = place != null ? (((prizeRes.data ?? []) as { position: number; amount: number }[]).find((p) => p.position === place)?.amount ?? null) : null;
      setBustInfo({ loading: false, place, prize });
      return true;
    } catch {
      setBustInfo({ loading: false, place: null, prize: null });
      return true;
    }
  }, [real, tournamentId, bustTable, supabase, verifyActiveEntry]);
  const bustPlayer = useCallback(async (): Promise<boolean> => {
    if (!real || !tournamentId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    try {
      if (!await verifyActiveEntry()) return false;
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId, action: "update_seats",
          seats: [{
            seat_id: real.seat_id, player_id: real.player_id, entry_number: real.entry_number,
            table_id: real.table_id, seat_number: real.seat_number,
            expected_chip_count: real.chip_count ?? 0, chip_count: real.chip_count ?? 0,
            is_active: false, player_name: real.player_name,
          }],
        },
      });
      const code = await floorOpsFunctionErrorCode(data, error);
      if (code) { toast.error(floorOpsErrorMessage(code, "Loại thất bại")); return false; }
      toast.success(`Đã loại ${real.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Loại thất bại"); return false; }
  }, [real, tournamentId, floor, supabase, verifyActiveEntry]);

  // Chuyển ghế (move_player_seat). Ghế trống mỗi bàn từ get_seats hiện tại; entry_id KHÔNG có trong
  // get_seats → tra tournament_seats theo seat_id (đúng cách desktop MovePlayerDialog).
  const moveTargets = useMemo(
    () => buildEligibleFloorMoveTargets(floor.tables, floor.seatsByTable),
    [floor.tables, floor.seatsByTable],
  );
  const movePlayer = useCallback(async (toTtId: string, toSeat: number, reason: string): Promise<boolean> => {
    if (!real || !tournamentId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    try {
      const { data: seatRow, error: seErr } = await supabase.from("tournament_seats")
        .select("entry_id").eq("id", real.seat_id).maybeSingle();
      if (seErr || !seatRow?.entry_id) { toast.error("Không tìm được lượt đăng ký (entry) của người chơi."); return false; }
      const { data, error } = await untypedFloorRpc("move_player_seat", {
        p_entry_id: seatRow.entry_id,
        p_to_tournament_table_id: toTtId,
        p_to_seat_number: toSeat,
        p_reason: reason,
      });
      const res = (data ?? null) as { ok?: boolean; error?: string; max_seats?: number } | null;
      if (error || !res?.ok) { toast.error(floorOpsErrorMessage(res?.error ?? error?.message, "Chuyển thất bại")); return false; }
      toast.success(`Đã chuyển ${real.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Chuyển thất bại"); return false; }
  }, [real, tournamentId, floor, supabase, untypedFloorRpc]);

  // Phiếu (READ-ONLY): tái dùng SeatReceiptDialog desktop. receiptCode/qrValue = entry_id (tra
  // tournament_seats theo seat_id, fallback seat_id). KHÔNG ghi DB.
  const openReceipt = useCallback(async () => {
    const r = target?.real;
    const tableNo = target?.tableNo ?? null;   // capture đồng bộ trước await (act() gọi close() ngay sau)
    if (!r) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return; }
    let code = r.seat_id;
    try {
      const { data } = await supabase.from("tournament_seats").select("entry_id").eq("id", r.seat_id).maybeSingle();
      if (data?.entry_id) code = data.entry_id as string;
    } catch { /* giữ fallback seat_id */ }
    setReceiptData({
      tournamentName,
      tournamentDate,
      playerName: r.player_name || r.player_id.slice(0, 8),
      tableNumber: tableNo,
      seatNumber: r.seat_number,
      receiptCode: code,
      startingStack: r.chip_count,
      qrValue: code,
    });
  }, [supabase, target, tournamentName, tournamentDate]);

  return (
    <>
      <PlayerActionSheets
        target={target ? { seat: target.seat, tableNo: target.tableNo, chipCount: target.real.chip_count } : null}
        onClose={() => { setBustInfo(null); onClose(); }}
        onSaveChip={saveChip}
        onBustPlayer={bustPlayer}
        onOpenBust={openBust}
        bustInfo={bustInfo}
        moveTargets={moveTargets}
        onMovePlayer={movePlayer}
        onOpenReceipt={openReceipt}
        infoLive
        bustControlMode={bustTable?.floor_control_mode ?? null}
        chipEditDisabledReason={chipEditDisabledReason}
      />
      <SeatReceiptDialog open={receiptData !== null} onOpenChange={(v) => { if (!v) setReceiptData(null); }} receipt={receiptData} />
    </>
  );
}
