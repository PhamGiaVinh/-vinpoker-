/**
 * CloseTourDialog — "Archive & Close Tour" 2-step destructive confirm.
 *
 * Step 1: preview the archive summary (tables, dealers, reserved, archive name).
 * Step 2: type-to-confirm ("DONG TOUR") before the close can run.
 *
 * PRESENTATION ONLY — receives a derived preview + an optional onConfirm. When
 * onConfirm is undefined (PR1, no backend yet) the final button is disabled and
 * shows "Sắp có"; the dialog NEVER closes a tour on its own.
 */
import { useEffect, useState } from "react";
import {
  Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription, DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Loader2, Archive, AlertTriangle } from "lucide-react";

export interface CloseTourPreview {
  tourName: string;
  activeTables: number;
  assignedDealers: number;
  onBreakDealers: number;
  reservedDealers: number;
  archiveFilename: string;
}

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  preview: CloseTourPreview | null;
  /** Undefined until the server RPC is wired (PR3) → button disabled "Sắp có". */
  onConfirm?: () => Promise<void> | void;
  busy?: boolean;
}

const CONFIRM_PHRASE = "DONG TOUR";

function Stat({ label, value }: { label: string; value: number }) {
  return (
    <div className="rounded-lg border border-border bg-muted/30 px-3 py-2">
      <div className="text-lg font-semibold tabular-nums leading-none">{value}</div>
      <div className="text-[11px] text-muted-foreground mt-1 leading-tight">{label}</div>
    </div>
  );
}

export default function CloseTourDialog({ open, onOpenChange, preview, onConfirm, busy }: Props) {
  const [step, setStep] = useState<1 | 2>(1);
  const [typed, setTyped] = useState("");

  useEffect(() => {
    if (!open) { setStep(1); setTyped(""); }
  }, [open]);

  if (!preview) return null;

  const totalDealers = preview.assignedDealers + preview.onBreakDealers;
  const phraseOk = typed.trim().toUpperCase() === CONFIRM_PHRASE;
  const canConfirm = phraseOk && !!onConfirm && !busy;

  return (
    <Dialog open={open} onOpenChange={(o) => { if (!busy) onOpenChange(o); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <Archive className="w-4 h-4 text-destructive" /> Xác nhận đóng tour?
          </DialogTitle>
          <DialogDescription className="font-medium text-foreground">{preview.tourName}</DialogDescription>
        </DialogHeader>

        {step === 1 ? (
          <div className="space-y-3 text-sm">
            <div className="grid grid-cols-2 gap-2">
              <Stat label="Bàn đang mở" value={preview.activeTables} />
              <Stat label="Dealer đang bàn" value={preview.assignedDealers} />
              <Stat label="Dealer đang nghỉ" value={preview.onBreakDealers} />
              <Stat label="Đang giữ chỗ" value={preview.reservedDealers} />
            </div>
            <div className="rounded-lg border border-border bg-muted/30 px-3 py-2 text-xs">
              <div className="text-muted-foreground">Bản lưu trữ Swing</div>
              <div className="font-mono text-[11px] mt-0.5 break-all">{preview.archiveFilename}</div>
            </div>
            <div className="flex items-start gap-2 rounded-lg border border-destructive/30 bg-destructive/10 px-3 py-2 text-xs text-destructive">
              <AlertTriangle className="w-3.5 h-3.5 flex-shrink-0 mt-0.5" />
              <span>
                Hành động này sẽ lưu trữ toàn bộ lịch sử Swing, giải phóng {preview.activeTables} bàn
                và đưa {totalDealers} dealer về Break Pool. Không thể hoàn tác trực tiếp.
              </span>
            </div>
          </div>
        ) : (
          <div className="space-y-2 text-sm">
            <p className="text-xs text-muted-foreground">
              Để xác nhận, gõ <span className="font-semibold text-foreground">DONG TOUR</span> bên dưới:
            </p>
            <Input
              value={typed}
              onChange={(e) => setTyped(e.target.value)}
              placeholder="DONG TOUR"
              autoFocus
              className="min-h-[40px]"
            />
            {!onConfirm && (
              <p className="text-xs text-warning">Tính năng sắp có — cần bật RPC phía máy chủ.</p>
            )}
          </div>
        )}

        <DialogFooter className="gap-2 sm:gap-2">
          {step === 1 ? (
            <>
              <Button variant="ghost" onClick={() => onOpenChange(false)} disabled={busy} className="min-h-[40px]">
                Huỷ
              </Button>
              <Button
                variant="outline"
                onClick={() => setStep(2)}
                className="min-h-[40px] border-destructive text-destructive hover:bg-destructive/10"
              >
                Tiếp tục
              </Button>
            </>
          ) : (
            <>
              <Button variant="ghost" onClick={() => setStep(1)} disabled={busy} className="min-h-[40px]">
                Quay lại
              </Button>
              <Button
                onClick={() => onConfirm?.()}
                disabled={!canConfirm}
                className="min-h-[40px] bg-destructive hover:bg-destructive text-destructive-foreground"
              >
                {busy ? <Loader2 className="w-4 h-4 animate-spin" /> : (onConfirm ? "Lưu trữ & Đóng tour" : "Sắp có")}
              </Button>
            </>
          )}
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
