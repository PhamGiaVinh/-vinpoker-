import { useMemo, useRef, useState } from "react";
import { RotateCcw, ShieldAlert, UserRoundCheck, UsersRound } from "lucide-react";
import { toast } from "sonner";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog,
  DialogContent,
  DialogDescription,
  DialogHeader,
  DialogTitle,
} from "@/components/ui/dialog";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import {
  FloorPlayerActions,
  type FloorSeatTarget,
} from "@/components/ops/shared/FloorPlayerActions";
import {
  buildEligibleFloorMoveTargets,
  toMockSeat,
  type MapSeat,
} from "@/components/ops/shared/floorAdapter";
import type { UseFloorSeats } from "@/components/ops/shared/useFloorSeats";
import { useSupabaseClient } from "@/integrations/supabase/SupabaseClientContext";
import { floorOpsErrorMessage, floorOpsResponseErrorCode } from "@/lib/floorOpsErrors";
import {
  type TournamentOpsEntry,
  useTournamentOps,
} from "@/ops/floor/TournamentOpsProvider";

type RestoreResponse = {
  ok?: boolean;
  error?: string;
  to_table_number?: number;
};

const chips = (value: number | null | undefined) =>
  value == null ? "—" : value.toLocaleString("vi-VN");

export default function PlayersWorkspace() {
  const client = useSupabaseClient();
  const {
    tournament,
    tournamentId,
    floor,
    entries,
    seatEntryIds,
    errors,
    refresh,
  } = useTournamentOps();
  const [actionTarget, setActionTarget] = useState<FloorSeatTarget | null>(null);
  const [restoreTarget, setRestoreTarget] = useState<TournamentOpsEntry | null>(null);
  const [restoreTableId, setRestoreTableId] = useState<string>("");
  const [restoreSeat, setRestoreSeat] = useState<string>("");
  const [confirmed, setConfirmed] = useState(false);
  const [restoreBusy, setRestoreBusy] = useState(false);
  const restoreGuard = useRef(false);

  const activeSeats = useMemo(() => {
    const rows: Array<MapSeat & { tableNumber: number | null }> = [];
    for (const table of floor.tables) {
      for (const seat of floor.seatsByTable[table.table_id] ?? []) {
        if (seat.is_active) rows.push({ ...seat, tableNumber: table.table_number });
      }
    }
    return rows.sort((a, b) =>
      (a.tableNumber ?? Number.MAX_SAFE_INTEGER) - (b.tableNumber ?? Number.MAX_SAFE_INTEGER)
      || a.seat_number - b.seat_number,
    );
  }, [floor.seatsByTable, floor.tables]);

  const activeEntryIds = useMemo(
    () => new Set(
      activeSeats
        .map((seat) => seatEntryIds.get(seat.seat_id))
        .filter((entryId): entryId is string => Boolean(entryId)),
    ),
    [activeSeats, seatEntryIds],
  );
  const waitingEntries = useMemo(
    () => entries.filter((entry) =>
      entry.status !== "busted"
      && entry.status !== "cancelled"
      && entry.status !== "finished"
      && !activeEntryIds.has(entry.id),
    ),
    [activeEntryIds, entries],
  );
  const bustedEntries = useMemo(
    () => entries
      .filter((entry) => entry.status === "busted")
      .sort((a, b) => (a.finishedPlace ?? Number.MAX_SAFE_INTEGER) - (b.finishedPlace ?? Number.MAX_SAFE_INTEGER)),
    [entries],
  );
  const restoreTargets = useMemo(
    () => buildEligibleFloorMoveTargets(floor.tables, floor.seatsByTable),
    [floor.seatsByTable, floor.tables],
  );
  const selectedRestoreTable = restoreTargets.find((target) => target.tt_id === restoreTableId) ?? null;
  const floorForActions = useMemo<UseFloorSeats>(
    () => ({ ...floor, reload: refresh }),
    [floor, refresh],
  );

  const openRestore = (entry: TournamentOpsEntry) => {
    const table = restoreTargets[0] ?? null;
    setRestoreTarget(entry);
    setRestoreTableId(table?.tt_id ?? "");
    setRestoreSeat(table?.freeSeats[0]?.toString() ?? "");
    setConfirmed(false);
  };

  const restorePlayer = async () => {
    const seatNumber = Number(restoreSeat);
    if (
      !restoreTarget
      || !restoreTableId
      || !Number.isInteger(seatNumber)
      || !selectedRestoreTable?.freeSeats.includes(seatNumber)
      || !confirmed
      || restoreGuard.current
    ) {
      return;
    }

    restoreGuard.current = true;
    setRestoreBusy(true);
    try {
      const { data, error } = await client.rpc("restore_busted_player_to_seat", {
        p_entry_id: restoreTarget.id,
        p_to_tournament_table_id: restoreTableId,
        p_to_seat_number: seatNumber,
        p_reason: "ops_floor_restore",
      });
      const result = (data ?? null) as RestoreResponse | null;
      const code = floorOpsResponseErrorCode(result) ?? error?.message;
      if (error || !result?.ok) {
        toast.error(floorOpsErrorMessage(code, "Khôi phục thất bại"));
        await Promise.resolve(refresh());
        return;
      }
      toast.success(
        `Đã khôi phục ${restoreTarget.playerName} vào Bàn ${result.to_table_number ?? selectedRestoreTable.table_number ?? "?"}, ghế ${seatNumber}.`,
      );
      setRestoreTarget(null);
      setConfirmed(false);
      refresh();
    } catch (cause) {
      toast.error(cause instanceof Error ? `Lỗi mạng: ${cause.message}` : "Khôi phục thất bại");
    } finally {
      restoreGuard.current = false;
      setRestoreBusy(false);
    }
  };

  return (
    <div className="min-w-0 space-y-5">
      <header>
        <p className="text-xs font-semibold uppercase tracking-[0.16em] text-emerald-300">Không gian giải</p>
        <h2 className="mt-1 text-2xl font-semibold text-white">Người chơi</h2>
        <p className="mt-1 text-sm text-[#91a49b]">
          Một danh sách chung cho người đang ngồi, đang chờ và đã bị loại.
        </p>
      </header>

      {errors.entries && (
        <div className="flex items-start gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-4 text-sm text-amber-100">
          <ShieldAlert className="mt-0.5 h-5 w-5 shrink-0" />
          {errors.entries}
        </div>
      )}

      <section className="space-y-3" aria-labelledby="playing-heading">
        <div className="flex items-center justify-between">
          <h3 id="playing-heading" className="font-semibold text-white">Đang chơi</h3>
          <span className="rounded-full bg-sky-400/10 px-2.5 py-1 text-xs text-sky-200">{activeSeats.length}</span>
        </div>
        {activeSeats.length === 0 ? (
          <EmptyState label="Chưa có người chơi đang ngồi." />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {activeSeats.map((seat) => (
              <button
                key={seat.seat_id}
                type="button"
                onClick={() => setActionTarget({
                  real: seat,
                  seat: toMockSeat(seat),
                  tableNo: seat.tableNumber ?? 0,
                })}
                className="flex min-h-16 min-w-0 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.035] px-4 py-3 text-left hover:border-sky-300/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-emerald-300"
              >
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{seat.player_name || `Người chơi ${seat.player_id.slice(0, 8)}`}</p>
                  <p className="mt-0.5 text-xs text-[#91a49b]">
                    Bàn {seat.tableNumber ?? "—"} · Ghế {seat.seat_number} · Entry {seat.entry_number}
                  </p>
                </div>
                <span className="shrink-0 font-mono text-sm text-emerald-200">{chips(seat.chip_count)}</span>
              </button>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="waiting-heading">
        <div className="flex items-center justify-between">
          <h3 id="waiting-heading" className="font-semibold text-white">Đang chờ xếp bàn</h3>
          <span className="rounded-full bg-amber-300/10 px-2.5 py-1 text-xs text-amber-200">{waitingEntries.length}</span>
        </div>
        {waitingEntries.length === 0 ? (
          <EmptyState label="Không có lượt vào đang chờ." />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {waitingEntries.map((entry) => (
              <div key={entry.id} className="flex min-h-16 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{entry.playerName}</p>
                  <p className="mt-0.5 text-xs text-[#91a49b]">Entry {entry.entryNumber} · {entry.status}</p>
                </div>
                <span className="shrink-0 text-xs text-amber-200">Chưa có ghế</span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="space-y-3" aria-labelledby="busted-heading">
        <div className="flex items-center justify-between">
          <h3 id="busted-heading" className="font-semibold text-white">Đã bị loại</h3>
          <span className="rounded-full bg-rose-300/10 px-2.5 py-1 text-xs text-rose-200">{bustedEntries.length}</span>
        </div>
        {bustedEntries.length === 0 ? (
          <EmptyState label="Chưa có người chơi bị loại." />
        ) : (
          <div className="grid gap-2 lg:grid-cols-2">
            {bustedEntries.map((entry) => (
              <div key={entry.id} className="flex min-h-16 min-w-0 items-center justify-between gap-3 rounded-2xl border border-white/10 bg-white/[0.025] px-4 py-3">
                <div className="min-w-0">
                  <p className="truncate font-medium text-white">{entry.playerName}</p>
                  <p className="mt-0.5 text-xs text-[#91a49b]">
                    Entry {entry.entryNumber} · Hạng {entry.finishedPlace ?? "chưa chốt"} · Chip cuối {chips(entry.currentStack)}
                  </p>
                </div>
                <Button
                  type="button"
                  variant="outline"
                  className="min-h-11 shrink-0 border-white/10 bg-white/5"
                  disabled={restoreTargets.length === 0}
                  onClick={() => openRestore(entry)}
                >
                  <RotateCcw className="mr-2 h-4 w-4" />
                  Khôi phục
                </Button>
              </div>
            ))}
          </div>
        )}
      </section>

      {tournament && (
        <FloorPlayerActions
          tournamentId={tournamentId}
          tournamentName={tournament.name}
          tournamentDate={tournament.start_time}
          floor={floorForActions}
          target={actionTarget}
          onClose={() => setActionTarget(null)}
        />
      )}

      <Dialog
        open={restoreTarget !== null}
        onOpenChange={(open) => {
          if (!open && !restoreBusy) {
            setRestoreTarget(null);
            setConfirmed(false);
          }
        }}
      >
        <DialogContent className="max-h-[90dvh] overflow-y-auto border-white/10 bg-[#07100c] text-white sm:max-w-lg">
          <DialogHeader>
            <DialogTitle>Khôi phục người chơi</DialogTitle>
            <DialogDescription className="text-[#91a49b]">
              Server sẽ kiểm tra lại entry, bàn và ghế trước khi ghi. Không có thao tác payout.
            </DialogDescription>
          </DialogHeader>
          {restoreTarget && (
            <div className="space-y-4">
              <div className="rounded-2xl border border-white/10 bg-white/[0.035] p-4">
                <p className="font-semibold">{restoreTarget.playerName}</p>
                <p className="mt-1 text-sm text-[#91a49b]">Entry {restoreTarget.entryNumber}</p>
              </div>
              <label className="block space-y-2 text-sm">
                <span className="text-[#b9c7c0]">Bàn đích</span>
                <Select
                  value={restoreTableId}
                  onValueChange={(value) => {
                    const table = restoreTargets.find((target) => target.tt_id === value);
                    setRestoreTableId(value);
                    setRestoreSeat(table?.freeSeats[0]?.toString() ?? "");
                    setConfirmed(false);
                  }}
                >
                  <SelectTrigger className="min-h-11 border-white/10 bg-white/5">
                    <SelectValue placeholder="Chọn bàn" />
                  </SelectTrigger>
                  <SelectContent>
                    {restoreTargets.map((target) => (
                      <SelectItem key={target.tt_id} value={target.tt_id}>
                        Bàn {target.table_number ?? "—"} · {target.freeSeats.length} ghế trống
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="block space-y-2 text-sm">
                <span className="text-[#b9c7c0]">Ghế trống</span>
                <Select
                  value={restoreSeat}
                  onValueChange={(value) => {
                    setRestoreSeat(value);
                    setConfirmed(false);
                  }}
                  disabled={!selectedRestoreTable}
                >
                  <SelectTrigger className="min-h-11 border-white/10 bg-white/5">
                    <SelectValue placeholder="Chọn ghế" />
                  </SelectTrigger>
                  <SelectContent>
                    {(selectedRestoreTable?.freeSeats ?? []).map((seat) => (
                      <SelectItem key={seat} value={seat.toString()}>Ghế {seat}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </label>
              <label className="flex min-h-11 items-start gap-3 rounded-2xl border border-amber-300/20 bg-amber-300/5 p-3 text-sm text-amber-50">
                <Checkbox
                  checked={confirmed}
                  onCheckedChange={(checked) => setConfirmed(checked === true)}
                  className="mt-0.5"
                />
                <span>Tôi xác nhận đúng người chơi, đúng bàn và đúng ghế TEST/UAT cần khôi phục.</span>
              </label>
              <Button
                type="button"
                className="min-h-12 w-full"
                disabled={!confirmed || !restoreTableId || !restoreSeat || restoreBusy}
                onClick={() => void restorePlayer()}
              >
                {restoreBusy ? (
                  <UsersRound className="mr-2 h-4 w-4 animate-pulse" />
                ) : (
                  <UserRoundCheck className="mr-2 h-4 w-4" />
                )}
                Xác nhận khôi phục
              </Button>
            </div>
          )}
        </DialogContent>
      </Dialog>
    </div>
  );
}

function EmptyState({ label }: { label: string }) {
  return (
    <div className="rounded-2xl border border-dashed border-white/10 bg-white/[0.02] px-4 py-6 text-center text-sm text-[#789084]">
      {label}
    </div>
  );
}
