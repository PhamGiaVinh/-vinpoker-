import { Loader2, ShieldAlert, UserMinus } from "lucide-react";
import {
  AlertDialog,
  AlertDialogAction,
  AlertDialogCancel,
  AlertDialogContent,
  AlertDialogDescription,
  AlertDialogFooter,
  AlertDialogHeader,
  AlertDialogTitle,
} from "@/components/ui/alert-dialog";

/**
 * This is deliberately separate from the normal bust confirmation.  A Manual
 * Floor table may bust a non-zero stack, so the operator must see the exact
 * consequence before an intent reaches the server.  Server-side policy and
 * the active-hand guard remain authoritative.
 */
export function ManualFloorBustConfirmDialog({
  open,
  playerName,
  chipCount,
  busy,
  onOpenChange,
  onConfirm,
}: {
  open: boolean;
  playerName: string;
  chipCount: number;
  busy: boolean;
  onOpenChange: (open: boolean) => void;
  onConfirm: () => void;
}) {
  return (
    <AlertDialog open={open} onOpenChange={(next) => { if (!busy) onOpenChange(next); }}>
      <AlertDialogContent className="w-[calc(100vw-2rem)] max-w-md overflow-x-hidden">
        <AlertDialogHeader>
          <AlertDialogTitle className="flex items-center gap-2">
            <span className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-amber-400/15 text-amber-600 dark:text-amber-300">
              <ShieldAlert className="h-5 w-5" />
            </span>
            Loại còn chip ở Manual Floor
          </AlertDialogTitle>
          <AlertDialogDescription className="break-words">
            {playerName} vẫn còn <strong>{chipCount.toLocaleString("vi-VN")}</strong> chip.
          </AlertDialogDescription>
        </AlertDialogHeader>
        <div className="rounded-lg border border-amber-400/30 bg-amber-400/10 p-3 text-sm leading-5 text-foreground">
          Server sẽ ghi số chip hiện tại vào audit và không tạo payout. Nếu bàn đang có ván chưa kết thúc, server sẽ chặn thao tác.
        </div>
        <AlertDialogFooter className="gap-2 sm:gap-2">
          <AlertDialogCancel disabled={busy}>Huỷ</AlertDialogCancel>
          <AlertDialogAction
            data-testid="floor-manual-bust-confirm"
            disabled={busy}
            className="bg-destructive text-destructive-foreground hover:bg-destructive/90"
            onClick={(event) => { event.preventDefault(); onConfirm(); }}
          >
            {busy ? <><Loader2 className="mr-2 h-4 w-4 animate-spin" />Đang loại</> : <><UserMinus className="mr-2 h-4 w-4" />Xác nhận loại</>}
          </AlertDialogAction>
        </AlertDialogFooter>
      </AlertDialogContent>
    </AlertDialog>
  );
}
