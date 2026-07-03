import {
  AlertDialog,
  AlertDialogContent,
  AlertDialogHeader,
  AlertDialogFooter,
  AlertDialogTitle,
  AlertDialogDescription,
} from "@/components/ui/alert-dialog";
import { Button } from "@/components/ui/button";
import { Trophy, UserMinus, Loader2 } from "lucide-react";
import { formatVND } from "@/lib/format";

/**
 * Floor "Loại" confirm dialog (owner-facing, plain + guided). When the operator busts a
 * player on the floor map, this shows — before the (unchanged) bust runs — the player's
 * finishing place and prize money, so the floor sees "[Tên] về hạng [N] — [tiền]" and can
 * double-check before confirming.
 *
 * Read-only preview: it changes NO backend. The actual bust is the same existing
 * `update_seats is_active=false` call the parent already made; the server auto-records the
 * official finished place + prize (player-history chain) exactly as before. `place` and
 * `prize` are a client-side preview computed by the parent (place = live active-seat count
 * including this player; prize = the `tournament_prizes` row for that place, if any). The
 * math is designed to agree with the eventually-persisted result.
 *
 * ITM (in the money): a prize row exists for `place` → show the amount as the hero.
 * Not ITM (out before the money): show the place only, with a muted "ngoài cơ cấu giải"
 * note — never a fake 0 đ prize.
 */
export function BustConfirmDialog({
  open,
  onOpenChange,
  playerName,
  place,
  prize,
  prizeLoading,
  itmPlaces,
  busting,
  onConfirm,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  playerName: string;
  /** Finishing place preview (null = could not be determined; still allow the bust). */
  place: number | null;
  /** Prize amount if this place is in the money; null = not ITM / unknown. */
  prize: number | null;
  /** True while the tournament's prize table is still being fetched. */
  prizeLoading: boolean;
  itmPlaces: number | null;
  busting: boolean;
  onConfirm: () => void;
}) {
  const isItm = prize != null;

  return (
    <AlertDialog open={open} onOpenChange={(v) => { if (!busting) onOpenChange(v); }}>
      <AlertDialogContent className="max-w-sm">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-destructive/15 text-destructive">
              <UserMinus className="h-4 w-4" />
            </span>
            Xác nhận loại người chơi
          </AlertDialogTitle>
          <AlertDialogDescription>
            Người chơi này sẽ kết thúc giải. Kiểm tra lại hạng và tiền thưởng trước khi xác nhận.
          </AlertDialogDescription>
        </AlertDialogHeader>

        {/* Result preview card */}
        <div className="rounded-xl border border-border bg-card p-4">
          <div className="truncate text-center text-base font-medium text-foreground">
            {playerName}
          </div>

          <div className="mt-2 flex items-baseline justify-center gap-1.5">
            <span className="text-sm text-muted-foreground">Về hạng</span>
            <span className="font-mono text-3xl font-semibold leading-none text-foreground">
              {place != null ? place : "—"}
            </span>
          </div>

          <div className="my-3 border-t border-border" />

          {prizeLoading ? (
            <div className="flex items-center justify-center gap-2 py-1 text-sm text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" /> Đang tính tiền thưởng…
            </div>
          ) : isItm ? (
            <div className="text-center">
              <div className="text-xs uppercase tracking-wide text-muted-foreground">Tiền thưởng</div>
              <div className="mt-1 flex items-center justify-center gap-2 text-2xl font-semibold text-primary">
                <Trophy className="h-5 w-5" />
                {formatVND(prize as number)}
              </div>
            </div>
          ) : place == null ? (
            <div className="text-center text-sm text-muted-foreground">
              Chưa xác định được hạng — vẫn có thể loại người chơi.
            </div>
          ) : (
            <div className="text-center text-sm text-muted-foreground">
              Ngoài cơ cấu giải — chưa tới hạng có thưởng
              {itmPlaces != null ? ` (giải trả top ${itmPlaces})` : ""}.
            </div>
          )}
        </div>

        <AlertDialogFooter>
          <Button variant="outline" disabled={busting} onClick={() => onOpenChange(false)}>
            Huỷ
          </Button>
          <Button disabled={busting} onClick={onConfirm}>
            {busting ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <UserMinus className="mr-1.5 h-4 w-4" />}
            Xác nhận loại
          </Button>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
