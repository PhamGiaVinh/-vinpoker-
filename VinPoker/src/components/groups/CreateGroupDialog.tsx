import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Button } from "@/components/ui/button";
import { Switch } from "@/components/ui/switch";
import { Loader2, Users } from "lucide-react";
import { ProofUploader } from "@/components/ProofUploader";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onCreated?: () => void;
}

export const CreateGroupDialog = ({ open, onOpenChange, onCreated }: Props) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const nav = useNavigate();
  const [name, setName] = useState("");
  const [isPublic, setIsPublic] = useState(true);
  const [avatarUrl, setAvatarUrl] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const reset = () => { setName(""); setIsPublic(true); setAvatarUrl(null); };

  const submit = async () => {
    if (!user) return;
    const trimmed = name.trim();
    if (trimmed.length < 2 || trimmed.length > 60) {
      toast.error(t("groupChat.create.nameInvalid"));
      return;
    }
    setSaving(true);
    const { data, error } = await supabase
      .from("chat_groups")
      .insert({ name: trimmed, is_public: isPublic, avatar_url: avatarUrl, created_by: user.id })
      .select("id")
      .single();
    setSaving(false);
    if (error) { toast.error(error.message); return; }
    toast.success(t("groupChat.create.created"));
    onOpenChange(false);
    reset();
    onCreated?.();
    nav(`/group/${data.id}`);
  };

  return (
    <Dialog open={open} onOpenChange={(o) => { onOpenChange(o); if (!o) reset(); }}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Users className="w-5 h-5 text-primary" />{t("groupChat.create.title")}</DialogTitle>
          <DialogDescription className="text-xs">{t("groupChat.create.desc")}</DialogDescription>
        </DialogHeader>
        <div className="space-y-3">
          <div className="space-y-1">
            <Label className="text-xs">{t("groupChat.create.nameLabel")}</Label>
            <Input value={name} onChange={(e) => setName(e.target.value)} maxLength={60} placeholder={t("groupChat.create.namePh")} />
          </div>
          <div className="space-y-1">
            <Label className="text-xs">{t("groupChat.create.avatarLabel")}</Label>
            <ProofUploader folder="chat-groups/avatars" value={avatarUrl} onChange={setAvatarUrl} label={t("groupChat.create.avatarBtn")} />
          </div>
          <div className="flex items-center justify-between rounded-lg border border-border/40 bg-card/40 p-3">
            <div className="text-xs">
              <div className="font-semibold">{isPublic ? t("groupChat.create.public") : t("groupChat.create.private")}</div>
              <div className="text-muted-foreground">{isPublic ? t("groupChat.create.publicDesc") : t("groupChat.create.privateDesc")}</div>
            </div>
            <Switch checked={isPublic} onCheckedChange={setIsPublic} />
          </div>
          <Button onClick={submit} disabled={saving || !name.trim()} className="w-full">
            {saving ? <Loader2 className="w-4 h-4 mr-1 animate-spin" /> : null}
            {t("groupChat.create.submit")}
          </Button>
        </div>
      </DialogContent>
    </Dialog>
  );
};
