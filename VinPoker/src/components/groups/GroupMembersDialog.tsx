import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Loader2, UserMinus, Crown, LogOut, UserPlus } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";
import { AddMemberDialog } from "./AddMemberDialog";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupId: string;
  createdBy: string;
  onLeft?: () => void;
}

interface Member {
  user_id: string;
  joined_at: string;
  display_name?: string | null;
  avatar_url?: string | null;
}

export const GroupMembersDialog = ({ open, onOpenChange, groupId, createdBy, onLeft }: Props) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [members, setMembers] = useState<Member[]>([]);
  const [busy, setBusy] = useState(false);
  const [acting, setActing] = useState<string | null>(null);
  const [openAdd, setOpenAdd] = useState(false);

  const isCreator = user?.id === createdBy;

  const load = async () => {
    setBusy(true);
    const { data: m } = await supabase
      .from("chat_group_members")
      .select("user_id, joined_at")
      .eq("group_id", groupId)
      .order("joined_at", { ascending: true });
    const ids = (m ?? []).map((x: any) => x.user_id);
    const { data: profs } = ids.length
      ? await supabase.from("profiles").select("user_id, display_name, avatar_url").in("user_id", ids)
      : { data: [] as any[] };
    const profMap: Record<string, any> = Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p]));
    setMembers((m ?? []).map((x: any) => ({ ...x, ...profMap[x.user_id] })));
    setBusy(false);
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, groupId]);

  const kick = async (uid: string) => {
    if (!confirm(t("groupChat.members.kickConfirm"))) return;
    setActing(uid);
    const { error } = await supabase.from("chat_group_members").delete().eq("group_id", groupId).eq("user_id", uid);
    setActing(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("groupChat.members.kicked"));
    load();
  };

  const leave = async () => {
    if (!user) return;
    if (!confirm(t("groupChat.members.leaveConfirm"))) return;
    setActing(user.id);
    const { error } = await supabase.from("chat_group_members").delete().eq("group_id", groupId).eq("user_id", user.id);
    setActing(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("groupChat.members.left"));
    onOpenChange(false);
    onLeft?.();
  };

  return (
    <>
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle>{t("groupChat.members.title", { n: members.length })}</DialogTitle>
        </DialogHeader>
        <Button variant="outline" size="sm" onClick={() => setOpenAdd(true)}>
          <UserPlus className="w-3.5 h-3.5 mr-1" /> {t("groupChat.members.addBtn")}
        </Button>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {busy ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : (
            members.map((m) => (
              <div key={m.user_id} className="flex items-center gap-3 p-2 rounded-lg border border-border/40">
                <Link to={`/player/${m.user_id}`} className="flex items-center gap-3 flex-1 min-w-0">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={m.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {(m.display_name ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate flex items-center gap-1.5">
                      {m.display_name ?? t("groupChat.members.unknown")}
                      {m.user_id === createdBy && <Crown className="w-3 h-3 text-warning" />}
                    </div>
                    {m.user_id === user?.id && <Badge variant="outline" className="text-[10px] mt-0.5">{t("groupChat.members.you")}</Badge>}
                  </div>
                </Link>
                {isCreator && m.user_id !== createdBy && (
                  <Button size="icon" variant="ghost" onClick={() => kick(m.user_id)} disabled={acting === m.user_id} className="h-8 w-8">
                    {acting === m.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <UserMinus className="w-3.5 h-3.5 text-destructive" />}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
        {!isCreator && user && (
          <Button variant="outline" onClick={leave} disabled={acting === user.id} className="text-destructive border-destructive/40 hover:bg-destructive/10">
            <LogOut className="w-3.5 h-3.5 mr-1" /> {t("groupChat.members.leaveBtn")}
          </Button>
        )}
      </DialogContent>
    </Dialog>
    <AddMemberDialog open={openAdd} onOpenChange={setOpenAdd} groupId={groupId} onAdded={load} />
    </>
  );
};
