import { useCallback, useMemo, useState } from "react";
import { toast } from "sonner";
import { supabase } from "@/integrations/supabase/client";
import { PlayerActionSheets } from "@/components/ops/shared/PlayerActionSheets";
import { SeatReceiptDialog } from "@/components/tournament/seat/SeatReceiptDialog";
import type { SeatReceiptData } from "@/components/tournament/seat/SeatReceipt";
import type { MapSeat } from "@/components/ops/shared/floorAdapter";
import type { MockSeat } from "@/components/ops/mock/opsData";
import type { UseFloorSeats } from "@/components/ops/shared/useFloorSeats";

/**
 * FloorPlayerActions — host DÙNG CHUNG cho luồng thao tác người chơi trên floor (màn Bàn + cockpit).
 * Giữ TOÀN BỘ state ghi + handler money-path (Sửa chip / Loại / Chuyển / Phiếu) + render
 * PlayerActionSheets + SeatReceiptDialog ở MỘT NƠI DUY NHẤT — được lift NGUYÊN VĂN từ OpsTables
 * (chỉ đổi nguồn biến: playerReal→target.real, tourId/user/floor.reload/selectedTour → props).
 *
 * Chỉ nhận target là GHẾ ĐANG NGỒI (đang chơi, có `MapSeat` thật). Người đã busted KHÔNG có ghế
 * active → hiển thị read-only ở danh sách, KHÔNG đưa vào đây (tránh sửa chip "hồi sinh"/move fail).
 */
const PENDING_NOTICE = "Chức năng đang nối dữ liệu — chưa thao tác trên live.";

/** Copy VERBATIM từ OpsTables.moveError (permission/entry/seat conflict). */
function moveError(res: { error?: string; max_seats?: number } | null, raw?: string): string {
  const code = res?.error ?? raw;
  switch (code) {
    case "entry_not_found": return "Không tìm thấy entry của người chơi.";
    case "entry_not_seated": return "Người chơi không còn ở trạng thái đang ngồi.";
    case "actor_not_allowed": return "Không có quyền chuyển ghế cho CLB này.";
    case "no_active_seat": return "Người chơi không có ghế active — kiểm tra Table Draw.";
    case "invalid_destination_table": return "Bàn đích không hợp lệ hoặc đã đóng — tải lại danh sách bàn.";
    case "invalid_seat_number": return `Số ghế không hợp lệ${res?.max_seats ? ` (1–${res.max_seats})` : ""}.`;
    case "seat_occupied": return "Ghế vừa có người khác ngồi — chọn ghế khác.";
    default: return code ? `Chuyển thất bại (${code})` : "Chuyển thất bại";
  }
}

export interface FloorSeatTarget {
  seat: MockSeat;   // presentational (PlayerActionSheets)
  tableNo: number;
  real: MapSeat;    // identity ghế THẬT để ghi update_seats / move / receipt
}

export function FloorPlayerActions({
  tournamentId, tournamentName, tournamentDate, userId, floor, target, onClose,
}: {
  tournamentId: string | null;
  tournamentName: string;
  tournamentDate: string | null;
  userId: string | undefined;
  floor: UseFloorSeats;
  target: FloorSeatTarget | null;
  onClose: () => void;
}) {
  const real = target?.real ?? null;
  const [bustInfo, setBustInfo] = useState<{ loading: boolean; place: number | null; prize: number | null } | null>(null);
  const [receiptData, setReceiptData] = useState<SeatReceiptData | null>(null);

  // Sửa chip → Edge tournament-live-draw update_seats (ungated, mirror EditChipsDialog).
  const saveChip = useCallback(async (newChip: number): Promise<boolean> => {
    if (!real || !tournamentId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId,
          action: "update_seats",
          seats: [{
            seat_id: real.seat_id, player_id: real.player_id, entry_number: real.entry_number,
            table_id: real.table_id, seat_number: real.seat_number, chip_count: newChip,
            is_active: true, player_name: real.player_name,
          }],
        },
      });
      const err = error?.message || (data as { error?: string } | null)?.error;
      if (err) { toast.error(err.includes("permission") || err.includes("denied") ? "Không có quyền sửa chip." : `Sửa chip thất bại: ${err}`); return false; }
      toast.success(`Đã cập nhật chip ${real.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) {
      toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Sửa chip thất bại");
      return false;
    }
  }, [real, tournamentId, floor]);

  // Loại (💰 ITM). openBust ĐỌC LẠI số người còn + cơ cấu thưởng NGAY khi mở (P0-5, không cache);
  // bustPlayer ghi update_seats is_active:false. Server tự ghi hạng/thưởng chính thức.
  const openBust = useCallback(async () => {
    if (!tournamentId) return;
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
    } catch {
      setBustInfo({ loading: false, place: null, prize: null });
    }
  }, [tournamentId]);
  const bustPlayer = useCallback(async (): Promise<boolean> => {
    if (!real || !tournamentId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    try {
      const { data, error } = await supabase.functions.invoke("tournament-live-draw", {
        body: {
          tournament_id: tournamentId, action: "update_seats",
          seats: [{
            seat_id: real.seat_id, player_id: real.player_id, entry_number: real.entry_number,
            table_id: real.table_id, seat_number: real.seat_number, chip_count: real.chip_count ?? 0,
            is_active: false, player_name: real.player_name,
          }],
        },
      });
      if (error) { toast.error(typeof error === "string" ? error : (error as Error).message ?? "Loại thất bại"); return false; }
      const res = data as { error?: string } | null;
      if (res?.error) { toast.error(`Loại thất bại (${res.error})`); return false; }
      toast.success(`Đã loại ${real.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Loại thất bại"); return false; }
  }, [real, tournamentId, floor]);

  // Chuyển ghế (move_player_seat). Ghế trống mỗi bàn từ get_seats hiện tại; entry_id KHÔNG có trong
  // get_seats → tra tournament_seats theo seat_id (đúng cách desktop MovePlayerDialog).
  const moveTargets = useMemo(() => floor.tables.map((tb) => {
    const occ = new Set((floor.seatsByTable[tb.table_id] ?? []).filter((x) => x.is_active).map((x) => x.seat_number));
    const freeSeats = Array.from({ length: tb.max_seats }, (_, i) => i + 1).filter((n) => !occ.has(n));
    return { tt_id: tb.tt_id, table_number: tb.table_number, freeSeats };
  }).filter((tb) => tb.freeSeats.length > 0), [floor.tables, floor.seatsByTable]);
  const movePlayer = useCallback(async (toTtId: string, toSeat: number, reason: string): Promise<boolean> => {
    if (!real || !tournamentId || !userId) { toast.error("Thiếu dữ liệu ghế — mở lại người chơi."); return false; }
    try {
      const { data: seatRow, error: seErr } = await supabase.from("tournament_seats")
        .select("entry_id").eq("id", real.seat_id).maybeSingle();
      if (seErr || !seatRow?.entry_id) { toast.error("Không tìm được lượt đăng ký (entry) của người chơi."); return false; }
      const { data, error } = await (supabase.rpc as any)("move_player_seat", {
        p_entry_id: seatRow.entry_id,
        p_to_tournament_table_id: toTtId,
        p_to_seat_number: toSeat,
        p_actor_user_id: userId,
        p_reason: reason,
      });
      const res = (data ?? null) as { ok?: boolean; error?: string; max_seats?: number } | null;
      if (error || !res?.ok) { toast.error(moveError(res, error?.message)); return false; }
      toast.success(`Đã chuyển ${real.player_name || "người chơi"}`);
      floor.reload();
      return true;
    } catch (e) { toast.error(e instanceof Error ? `Lỗi mạng: ${e.message}` : "Chuyển thất bại"); return false; }
  }, [real, tournamentId, userId, floor]);

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
  }, [target, tournamentName, tournamentDate]);

  return (
    <>
      <PlayerActionSheets
        target={target ? { seat: target.seat, tableNo: target.tableNo, chipCount: target.real.chip_count } : null}
        onClose={() => { setBustInfo(null); onClose(); }}
        pendingNotice={PENDING_NOTICE}
        onSaveChip={saveChip}
        onBustPlayer={bustPlayer}
        onOpenBust={openBust}
        bustInfo={bustInfo}
        moveTargets={moveTargets}
        onMovePlayer={movePlayer}
        onOpenReceipt={openReceipt}
        infoLive
      />
      <SeatReceiptDialog open={receiptData !== null} onOpenChange={(v) => { if (!v) setReceiptData(null); }} receipt={receiptData} />
    </>
  );
}
