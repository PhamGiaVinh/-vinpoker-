import { useEffect, useState } from "react";
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
import { useDealerAvailability } from "@/hooks/dealer/useDealerAvailability";
import { useShiftTemplates } from "@/hooks/dealer/useShiftTemplates";

/**
 * Unified "Đăng ký lịch làm việc" — for a work date the dealer picks a desired SHIFT
 * (preferred + template), "rảnh mọi ca" (available), "xin nghỉ" (leave) or "báo bận"
 * (unavailable). Preferred/available → submitAvailability; leave/unavailable → requestLeave
 * (both on the planner layer → dealer_availability_requests, which the operator Shift Planner
 * reads). MOCK = toast only; LIVE wires the RPCs (owner-gated apply of 20260906000000).
 */
type Mode = "shift" | "available" | "leave" | "unavailable";

export function RequestShiftDialog({
  dealerId,
  open,
  onOpenChange,
  initialDate,
}: {
  dealerId: string | undefined;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  initialDate?: string;
}) {
  const { t } = useTranslation();
  const today = localTodayDate();
  const defaultDate = initialDate ?? addDays(today, 1);
  const [date, setDate] = useState(defaultDate);
  const [mode, setMode] = useState<Mode>("shift");
  const [templateId, setTemplateId] = useState<string | null>(null);
  const [note, setNote] = useState("");
  const { submitAvailability, requestLeave } = useDealerAvailability();
  const { templates } = useShiftTemplates();
  const pending = submitAvailability.isPending || requestLeave.isPending;

  // Sync the date when opened from a specific day (week-cell tap).
  useEffect(() => {
    if (open && initialDate) setDate(initialDate);
  }, [open, initialDate]);

  const reset = () => {
    setDate(initialDate ?? addDays(today, 1));
    setMode("shift");
    setTemplateId(null);
    setNote("");
  };

  const submit = async () => {
    if (!dealerId) return;
    const n = note.trim() || null;
    if (mode === "shift") {
      await submitAvailability.mutateAsync({ dealerId, workDate: date, kind: "preferred", templateId, note: n });
    } else if (mode === "available") {
      await submitAvailability.mutateAsync({ dealerId, workDate: date, kind: "available", templateId: null, note: n });
    } else {
      await requestLeave.mutateAsync({ dealerId, workDate: date, kind: mode, note: n });
    }
    reset();
    onOpenChange(false);
  };

  const modes: { value: Mode; label: string }[] = [
    { value: "shift", label: t("dealer.shiftRequest.modeShift", "Ca cụ thể") },
    { value: "available", label: t("dealer.shiftRequest.modeAvailable", "Rảnh mọi ca") },
    { value: "leave", label: t("dealer.shiftRequest.modeLeave", "Xin nghỉ") },
    { value: "unavailable", label: t("dealer.shiftRequest.modeUnavailable", "Báo bận") },
  ];

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
          <DialogTitle>{t("dealer.shiftRequest.title", "Đăng ký lịch làm việc")}</DialogTitle>
          <DialogDescription>
            {t("dealer.shiftRequest.subtitle", "Chọn ca mong muốn / báo rảnh / xin nghỉ — gửi cho quản lý CLB xếp lịch.")}
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          <div className="space-y-1.5">
            <label className="text-[12px] text-muted-foreground">{t("dealer.shiftRequest.dateLabel", "Ngày")}</label>
            <input
              type="date"
              value={date}
              min={today}
              onChange={(e) => setDate(e.target.value)}
              className="w-full rounded-md bg-background border border-border px-3 py-2 text-sm text-foreground"
            />
          </div>

          <div className="grid grid-cols-2 gap-1 bg-card border border-border rounded-xl p-1">
            {modes.map((m) => (
              <ModeBtn key={m.value} active={mode === m.value} onClick={() => setMode(m.value)} label={m.label} />
            ))}
          </div>

          {mode === "shift" && (
            <div className="space-y-1.5">
              <label className="text-[12px] text-muted-foreground">{t("dealer.shiftRequest.shiftLabel", "Chọn ca")}</label>
              {templates.length === 0 ? (
                <p className="text-[12px] text-muted-foreground">
                  {t("dealer.shiftRequest.noTemplates", "Chưa có mẫu ca — bạn vẫn gửi được (quản lý sẽ xếp ca phù hợp).")}
                </p>
              ) : (
                <div className="grid grid-cols-3 gap-1.5">
                  {templates.map((tpl) => (
                    <button
                      key={tpl.id}
                      type="button"
                      onClick={() => setTemplateId(templateId === tpl.id ? null : tpl.id)}
                      className={cn(
                        "rounded-lg border px-1 py-1.5 text-[11px] font-bold transition-colors",
                        templateId === tpl.id ? "bg-primary/15 text-primary border-primary/40" : "border-border text-muted-foreground",
                      )}
                    >
                      {tpl.timeLabel}
                    </button>
                  ))}
                </div>
              )}
            </div>
          )}

          <div className="space-y-1.5">
            <label className="text-[12px] text-muted-foreground">{t("dealer.shiftRequest.noteLabel", "Ghi chú (tuỳ chọn)")}</label>
            <Textarea
              value={note}
              onChange={(e) => setNote(e.target.value)}
              rows={2}
              placeholder={t("dealer.shiftRequest.notePlaceholder", "Ví dụ: tuần sau muốn ca sớm…")}
            />
          </div>
        </div>

        <DialogFooter>
          <Button
            onClick={submit}
            disabled={!dealerId || pending}
            className="gradient-neon text-primary-foreground border-0 font-bold w-full"
          >
            {t("dealer.shiftRequest.submit", "Gửi yêu cầu")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}

function ModeBtn({ active, onClick, label }: { active: boolean; onClick: () => void; label: string }) {
  return (
    <button
      onClick={onClick}
      type="button"
      className={cn(
        "py-2 rounded-lg text-[13px] font-bold transition-colors",
        active ? "bg-primary/15 text-primary border border-primary/35" : "text-muted-foreground",
      )}
    >
      {label}
    </button>
  );
}
