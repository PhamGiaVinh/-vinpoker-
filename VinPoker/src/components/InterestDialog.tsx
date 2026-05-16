import { useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Slider } from "@/components/ui/slider";
import { Textarea } from "@/components/ui/textarea";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  playerId: string;
  playerName: string;
}

export const InterestDialog = ({ open, onOpenChange, playerId, playerName }: Props) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [pct, setPct] = useState(20);
  const [msg, setMsg] = useState("");
  const [loading, setLoading] = useState(false);

  const submit = async () => {
    if (!user) {
      toast.error(t("interestDialog.loginRequired"));
      return;
    }
    if (user.id === playerId) {
      toast.error(t("interestDialog.selfNotAllowed"));
      return;
    }
    if (msg.trim().length > 500) {
      toast.error(t("interestDialog.messageMax"));
      return;
    }
    setLoading(true);
    const { error } = await supabase.from("backing_interests").insert({
      player_id: playerId,
      interested_user_id: user.id,
      percentage_interested: pct,
      message: msg.trim() || null,
    });
    setLoading(false);
    if (error) {
      toast.error(error.message);
      return;
    }
    toast.success(t("interestDialog.sent"));
    onOpenChange(false);
    setMsg("");
    setPct(20);
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent>
        <DialogHeader>
          <DialogTitle>{t("interestDialog.title", { name: playerName })}</DialogTitle>
          <DialogDescription>{t("interestDialog.description")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-4">
          <div>
            <div className="flex items-center justify-between mb-2">
              <span className="text-sm">{t("interestDialog.interestedIn")}</span>
              <span className="text-primary font-bold">{t("interestDialog.actionPercent", { n: pct })}</span>
            </div>
            <Slider min={5} max={50} step={5} value={[pct]} onValueChange={(v) => setPct(v[0])} />
          </div>
          <div>
            <label className="text-sm mb-1 block">{t("interestDialog.messageOptional")}</label>
            <Textarea
              value={msg}
              onChange={(e) => setMsg(e.target.value)}
              placeholder={t("interestDialog.messagePlaceholder")}
              maxLength={500}
              rows={4}
            />
            <div className="text-xs text-muted-foreground text-right mt-1">{msg.length}/500</div>
          </div>
          <Button onClick={submit} disabled={loading} className="w-full">
            {loading ? t("interestDialog.sending") : t("interestDialog.send")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
