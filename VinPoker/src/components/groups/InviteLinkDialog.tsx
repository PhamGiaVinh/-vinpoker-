import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Loader2, Copy, Share2, RefreshCw, Link2, Trash2 } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupId: string;
  groupName: string;
}

interface Invite {
  id: string;
  token: string;
  expires_at: string | null;
  max_uses: number | null;
  uses: number;
  revoked_at: string | null;
}

const randomToken = (len = 16) => {
  const chars = "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghjkmnpqrstuvwxyz23456789";
  let out = "";
  const arr = new Uint32Array(len);
  crypto.getRandomValues(arr);
  for (let i = 0; i < len; i++) out += chars[arr[i] % chars.length];
  return out;
};

export const InviteLinkDialog = ({ open, onOpenChange, groupId, groupName }: Props) => {
  const { t, i18n } = useTranslation();
  const { user } = useAuth();
  const [busy, setBusy] = useState(false);
  const [invite, setInvite] = useState<Invite | null>(null);
  const [expiryHours, setExpiryHours] = useState<number | null>(24 * 7);

  const EXPIRY_OPTIONS: { label: string; hours: number | null }[] = [
    { label: t("groupChat.invite.hour1"), hours: 1 },
    { label: t("groupChat.invite.day1"), hours: 24 },
    { label: t("groupChat.invite.days7"), hours: 24 * 7 },
    { label: t("groupChat.invite.neverOpt"), hours: null },
  ];

  const link = invite ? `${window.location.origin}/invite/${invite.token}` : "";

  const load = async () => {
    setBusy(true);
    const { data } = await supabase
      .from("chat_group_invites")
      .select("id, token, expires_at, max_uses, uses, revoked_at")
      .eq("group_id", groupId)
      .is("revoked_at", null)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle();
    setInvite(data as Invite | null);
    setBusy(false);
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, groupId]);

  const create = async () => {
    if (!user) return;
    setBusy(true);
    if (invite) {
      await supabase.from("chat_group_invites").update({ revoked_at: new Date().toISOString() }).eq("id", invite.id);
    }
    const expires_at = expiryHours == null ? null : new Date(Date.now() + expiryHours * 3600_000).toISOString();
    const { data, error } = await supabase
      .from("chat_group_invites")
      .insert({ group_id: groupId, created_by: user.id, token: randomToken(), expires_at })
      .select("id, token, expires_at, max_uses, uses, revoked_at")
      .single();
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setInvite(data as Invite);
    toast.success(t("groupChat.invite.created"));
  };

  const revoke = async () => {
    if (!invite) return;
    if (!confirm(t("groupChat.invite.revokeConfirm"))) return;
    setBusy(true);
    const { error } = await supabase.from("chat_group_invites").update({ revoked_at: new Date().toISOString() }).eq("id", invite.id);
    setBusy(false);
    if (error) { toast.error(error.message); return; }
    setInvite(null);
    toast.success(t("groupChat.invite.revoked"));
  };

  const copy = async () => {
    if (!link) return;
    await navigator.clipboard.writeText(link);
    toast.success(t("groupChat.invite.copied"));
  };

  const share = async () => {
    if (!link) return;
    if ((navigator as any).share) {
      try {
        await (navigator as any).share({
          title: t("groupChat.invite.shareTitle", { name: groupName }),
          text: t("groupChat.invite.shareText", { name: groupName }),
          url: link,
        });
      } catch { /* user cancelled */ }
    } else {
      copy();
    }
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Link2 className="w-5 h-5 text-primary" />{t("groupChat.invite.title")}</DialogTitle>
          <DialogDescription className="text-xs">{t("groupChat.invite.desc", { name: groupName })}</DialogDescription>
        </DialogHeader>

        {busy ? (
          <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
        ) : invite ? (
          <div className="space-y-3">
            <div className="flex gap-2">
              <Input readOnly value={link} className="text-xs" onClick={(e) => (e.target as HTMLInputElement).select()} />
              <Button size="icon" variant="secondary" onClick={copy} title={t("groupChat.invite.copy")}><Copy className="w-4 h-4" /></Button>
              <Button size="icon" onClick={share} title={t("groupChat.invite.share")}><Share2 className="w-4 h-4" /></Button>
            </div>
            <div className="text-[11px] text-muted-foreground space-y-0.5">
              <div>{t("groupChat.invite.expires", { when: invite.expires_at ? new Date(invite.expires_at).toLocaleString(i18n.language) : t("groupChat.invite.never") })}</div>
              <div>{invite.max_uses != null ? t("groupChat.invite.usedMax", { n: invite.uses, max: invite.max_uses }) : t("groupChat.invite.used", { n: invite.uses })}</div>
            </div>
            <div className="flex gap-2">
              <Button variant="outline" size="sm" onClick={create} className="flex-1"><RefreshCw className="w-3.5 h-3.5 mr-1" />{t("groupChat.invite.newLink")}</Button>
              <Button variant="outline" size="sm" onClick={revoke} className="text-destructive border-destructive/40 hover:bg-destructive/10">
                <Trash2 className="w-3.5 h-3.5 mr-1" />{t("groupChat.invite.revoke")}
              </Button>
            </div>
          </div>
        ) : (
          <div className="space-y-3">
            <p className="text-xs text-muted-foreground">{t("groupChat.invite.empty")}</p>
            <div className="space-y-1">
              <Label className="text-xs">{t("groupChat.invite.expiry")}</Label>
              <div className="grid grid-cols-2 gap-2">
                {EXPIRY_OPTIONS.map((o) => (
                  <Button
                    key={o.label}
                    type="button"
                    size="sm"
                    variant={expiryHours === o.hours ? "default" : "outline"}
                    onClick={() => setExpiryHours(o.hours)}
                  >
                    {o.label}
                  </Button>
                ))}
              </div>
            </div>
            <Button onClick={create} className="w-full"><Link2 className="w-4 h-4 mr-1" />{t("groupChat.invite.createBtn")}</Button>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
};
