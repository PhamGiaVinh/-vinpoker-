import { useState } from "react";
import { useTranslation } from "react-i18next";
import {
  Dialog,
  DialogContent,
  DialogHeader,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { cn } from "@/lib/utils";
import { localTodayDate, addDays } from "@/lib/dealerApp/clock";
import { useDealerAvailability, type LeaveKind } from "@/hooks/dealer/useDealerAvailability";

/** Request leave / "báo bận" for a date. MOCK = toast only; LIVE wires to
 *  dealer_request_leave_or_swap (planner layer, owner-gated apply). */
export function RequestLeaveDialog({
  dealerId,
  open,
  onOpenChange,
}: {
  dealerId: string | undefined;
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const { t } = useTranslation();
  const today = localTodayDate();
  const [date, setDate] = useState(() => addDays(today, 1));
  const [kind, setKind] = useState<LeaveKind>("leave");
  const [note, setNote] = useState("");
  const { requestLeave } = useDealerAvailability();

  const reset = () => {
    setDate(addDays(today, 1));
    setKind("leave");
    setNote("");
  };

  const submit = async () => {
    if (!dealerId) return;
    await requestLeave.mutateAsync({ dealerId, workDate: date, kind, note: note.trim() || null });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) reset();
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dealer.leave.title", "Xin nghỉ / báo bận")}</DialogTitle>
          <DialogDescription>{t("dealer.leave.subtitle", "Gửi cho quản lý CLB để xếp lịch.")}</DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[12px] text-muted-foreground">{t("dealer.leave.dateLabel", "Ngày")}</label>
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md bg-background border border-border px-3 py-2 text-sm text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-1 bg-card border border-border rounded-xl p-1">
            <KindBtn active={kind === "leave"} onClick={() => setKind("leave")} label={t("dealer.leave.kindLeave", "Xin nghỉ")} />
            <KindBtn active={kind === "unavailable"} onClick={() => setKind("unavailable")} label={t("dealer.leave.kindUnavailable", "Báo bận")} />
          </div>

          <div className="space-y-1.5">
            <label className="text-[12px] text-muted-foreground">{t("dealer.leave.noteLabel", "Lý do (tuỳ chọn)")}</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={3}
              placeholder={t("dealer.leave.notePlaceholder", "Ví dụ: bận việc gia đình…")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!dealerId || requestLeave.isPending}
            className="gradient-neon text-primary-foreground border-0 font-bold w-full"
          >
            {t("dealer.leave.submit", "Gửi yêu cầu")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function KindBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={cn(
        "py-2 rounded-lg text-sm font-bold transition-colors",
        active ? "bg-primary/15 text-primary border border-primary/35" : "text-muted-foreground"
      )}
    >
      {label}
    </button>
  );
}
