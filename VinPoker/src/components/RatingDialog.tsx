import { useState } from "react";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogFooter } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Star, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface RatingDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  dealId: string;
  counterpartyName?: string;
  onSubmitted?: () => void;
}

export const RatingDialog = ({ open, onOpenChange, dealId, counterpartyName, onSubmitted }: RatingDialogProps) => {
  const { t } = useTranslation();
  const [rating, setRating] = useState(0);
  const [hover, setHover] = useState(0);
  const [comment, setComment] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (rating < 1 || rating > 5) { toast.error(t("rating.pickStars")); return; }
    setSubmitting(true);
    const { data, error } = await supabase.functions.invoke("submit-rating", {
      body: { deal_id: dealId, rating, comment: comment.trim() || null },
    });
    setSubmitting(false);
    if (error) { toast.error(error.message); return; }
    if ((data as any)?.error) { toast.error((data as any).error); return; }
    toast.success(t("rating.thanks"));
    setRating(0); setComment("");
    onOpenChange(false);
    onSubmitted?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle>{t("rating.title", { name: counterpartyName ?? t("rating.defaultName") })}</DialogTitle>
        </DialogHeader>
        <div className="space-y-4 py-2">
          <div className="flex items-center justify-center gap-1.5">
            {[1,2,3,4,5].map((i) => (
              <button
                key={i}
                type="button"
                onMouseEnter={() => setHover(i)}
                onMouseLeave={() => setHover(0)}
                onClick={() => setRating(i)}
                className="p-1"
              >
                <Star
                  className={`w-9 h-9 transition-colors ${
                    i <= (hover || rating) ? "fill-warning text-warning" : "text-muted-foreground/40"
                  }`}
                />
              </button>
            ))}
          </div>
          <Textarea
            placeholder={t("rating.placeholder")}
            value={comment}
            onChange={(e) => setComment(e.target.value)}
            rows={3}
            maxLength={1000}
          />
          <p className="text-xs text-muted-foreground">{t("rating.hint")}</p>
        </div>
        <DialogFooter>
          <Button variant="outline" onClick={() => onOpenChange(false)}>{t("rating.cancel")}</Button>
          <Button onClick={submit} disabled={submitting || rating === 0}>
            {submitting ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            {t("rating.submit")}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
};
