import { useState } from "react";
import { useTranslation } from "react-i18next";
import { toast } from "sonner";
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
import type { CareerProgramView } from "@/types/dealerApp";

/** Apply to a program. Inc 5 = mock (optimistic local "applied" state + toast);
 *  the live apply RPC (dealer_apply_to_program) wires in Inc 7. */
export function ApplyDialog({
  program,
  open,
  onOpenChange,
  onSubmitted,
}: {
  program: CareerProgramView | null;
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onSubmitted: (programId: string) => void;
}) {
  const { t } = useTranslation();
  const [note, setNote] = useState("");

  const submit = () => {
    if (!program) return;
    onSubmitted(program.id);
    setNote("");
    toast.success(t("dealer.careers.apply.submitted", "Đã gửi đơn ứng tuyển (demo)"));
  };

  return (
    <Dialog
      open={open}
      onOpenChange={(o) => {
        if (!o) setNote("");
        onOpenChange(o);
      }}
    >
      <DialogContent className="max-w-sm">
        <DialogHeader>
          <DialogTitle>{t("dealer.careers.apply.title", "Ứng tuyển")}</DialogTitle>
          <DialogDescription>{program?.title}</DialogDescription>
        </DialogHeader>
        <div className="space-y-1.5">
          <label className="text-[12px] text-muted-foreground">
            {t("dealer.careers.apply.noteLabel", "Lời nhắn (tuỳ chọn)")}
          </label>
          <Textarea
            value={note}
            onChange={(e) => setNote(e.target.value)}
            rows={3}
            placeholder={t("dealer.careers.apply.notePlaceholder", "Giới thiệu ngắn về bạn…")}
          />
        </div>
        <DialogFooter>
          <Button onClick={submit} className="gradient-neon text-primary-foreground border-0 font-bold w-full">
            {t("dealer.careers.apply.submit", "Gửi đơn")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
