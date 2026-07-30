import { useMemo, useState } from "react";
import { LayoutGrid, Plus, RefreshCw, Users } from "lucide-react";
import { Button } from "@/components/ui/button";
import { OpenTableDialog } from "@/components/cashier/tournament-live/OpenTableDialog";
import { FloorTableDetailSheet } from "@/components/cashier/tournament-live/FloorTableDetailSheet";
import {
  FloorPlayerActions,
  type FloorSeatTarget,
} from "@/components/ops/shared/FloorPlayerActions";
import { toMockSeat, type MapSeat, type MapTable } from "@/components/ops/shared/floorAdapter";
import type { UseFloorSeats } from "@/components/ops/shared/useFloorSeats";
import { useTournamentOps } from "@/ops/floor/TournamentOpsProvider";

export default function TablesWorkspace() {
  const {
    tournament,
    tournamentId,
    floor,
    seatEntryIds,
    refresh,
  } = useTournamentOps();
  const [openTable, setOpenTable] = useState(false);
  const [selectedTableId, setSelectedTableId] = useState<string | null>(null);
  const [playerTarget, setPlayerTarget] = useState<FloorSeatTarget | null>(null);

  const selectedTable = floor.tables.find((table) => table.tt_id === selectedTableId) ?? null;
  const selectedSeats = selectedTable ? (floor.seatsByTable[selectedTable.table_id] ?? []) : [];
  const unlinkedActiveSeatCount = selectedSeats.filter(
    (seat) => !seatEntryIds.get(seat.seat_id),
  ).length;
  const floorForActions = useMemo<UseFloorSeats>(
    () => ({ ...floor, reload: refresh }),
    [floor, refresh],
  );

  const openPlayer = (seat: MapSeat, table: MapTable) => {
    setSelectedTableId(null);
    requestAnimationFrame(() => {
      setPlayerTarget({
        real: seat,
        seat: toMockSeat(seat),
        tableNo: table.table_number ?? 0,
      });
    });
  };

  return (
    <div className="min-w-0 space-y-4">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Không gian giải</p>
          <h2 className="mt-1 text-2xl font-semibold text-white">Bàn</h2>
          <p className="mt-1 text-sm text-[#91a49b]">
            Một sơ đồ duy nhất cho mọi thiết bị. Chạm bàn để xem đủ 9 ghế và thao tác.
          </p>
        </div>
        <div className="flex gap-2">
          <Button
            type="button"
            variant="outline"
            className="min-h-11 border-white/10 bg-white/5 text-white"
            onClick={refresh}
          >
            <RefreshCw className="h-4 w-4 sm:mr-2" />
            <span className="hidden sm:inline">Làm mới</span>
          </Button>
          <Button type="button" className="min-h-11" onClick={() => setOpenTable(true)}>
            <Plus className="mr-2 h-4 w-4" />
            Mở bàn
          </Button>
        </div>
      </header>

      {floor.error ? (
        <div className="rounded-2xl border border-rose-300/20 bg-rose-300/5 p-4 text-sm text-rose-200">
          {floor.error}
        </div>
      ) : floor.tables.length === 0 ? (
        <div className="rounded-3xl border border-dashed border-white/12 bg-white/[0.025] p-8 text-center">
          <LayoutGrid className="mx-auto h-8 w-8 text-[#789084]" />
          <h3 className="mt-3 font-semibold text-white">Chưa có bàn đang mở</h3>
          <p className="mt-1 text-sm text-[#91a49b]">Mở bàn mới và chọn số 1–100 cùng chế độ Manual/Tracker.</p>
        </div>
      ) : (
        <div className="grid min-w-0 grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-4 2xl:grid-cols-5">
          {floor.tables.map((table) => {
            const seats = floor.seatsByTable[table.table_id] ?? [];
            return (
              <button
                key={table.tt_id}
                type="button"
                onClick={() => setSelectedTableId(table.tt_id)}
                className="min-h-32 min-w-0 rounded-3xl border border-white/10 bg-white/[0.035] p-4 text-left transition hover:border-emerald-300/30 hover:bg-emerald-300/[0.055] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate text-lg font-semibold text-white">
                    Bàn {table.table_number ?? "—"}
                  </span>
                  <span className={`h-2.5 w-2.5 rounded-full ${seats.length > 0 ? "bg-sky-400" : "bg-emerald-400"}`} />
                </div>
                <div className="mt-5 flex items-center gap-2 text-sm text-[#a9bab1]">
                  <Users className="h-4 w-4" />
                  <span className="font-mono">{seats.length}/9 ghế</span>
                </div>
                <div className="mt-2 truncate text-xs text-[#789084]">
                  {table.floor_control_mode === "tracker" ? "Live Tracker" : "Manual Floor"}
                </div>
              </button>
            );
          })}
        </div>
      )}

      {tournament && (
        <>
          <FloorTableDetailSheet
            open={Boolean(selectedTable)}
            onOpenChange={(open) => { if (!open) setSelectedTableId(null); }}
            table={selectedTable}
            seats={selectedSeats}
            onSeatTap={(seat) => {
              if (selectedTable) openPlayer(seat, selectedTable);
            }}
            tournamentId={tournamentId}
            tournamentName={tournament.name}
            tournamentDate={tournament.start_time}
            unlinkedActiveSeatCount={unlinkedActiveSeatCount}
            canManageTableControl
            onChanged={refresh}
          />
          <OpenTableDialog
            open={openTable}
            onOpenChange={setOpenTable}
            tournamentId={tournamentId}
            onDone={refresh}
          />
          <FloorPlayerActions
            tournamentId={tournamentId}
            tournamentName={tournament.name}
            tournamentDate={tournament.start_time}
            floor={floorForActions}
            target={playerTarget}
            onClose={() => setPlayerTarget(null)}
          />
        </>
      )}
    </div>
  );
}
