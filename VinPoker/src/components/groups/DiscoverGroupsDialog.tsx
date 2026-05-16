import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Loader2, Search, Users, Lock, Globe } from "lucide-react";
import { Input } from "@/components/ui/input";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  onJoined?: () => void;
}

interface Group {
  id: string;
  name: string;
  avatar_url: string | null;
  is_public: boolean;
  member_count?: number;
}

export const DiscoverGroupsDialog = ({ open, onOpenChange, onJoined }: Props) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [groups, setGroups] = useState<Group[]>([]);
  const [busy, setBusy] = useState(false);
  const [joining, setJoining] = useState<string | null>(null);
  const [q, setQ] = useState("");

  const [mineIds, setMineIds] = useState<Set<string>>(new Set());

  const load = async () => {
    if (!user) return;
    setBusy(true);
    const { data: mine } = await supabase
      .from("chat_group_members")
      .select("group_id")
      .eq("user_id", user.id);
    const ids = new Set<string>((mine ?? []).map((m: any) => m.group_id));
    setMineIds(ids);
    const { data } = await supabase
      .from("chat_groups")
      .select("id, name, avatar_url, is_public")
      .eq("is_public", true)
      .is("deleted_at", null)
      .order("updated_at", { ascending: false })
      .limit(100);
    setGroups((data ?? []) as Group[]);
    setBusy(false);
  };

  useEffect(() => { if (open) load(); /* eslint-disable-next-line */ }, [open, user?.id]);

  const join = async (g: Group) => {
    if (!user) return;
    if (!g.is_public) {
      toast.error(t("groupChat.discover.privateError"));
      return;
    }
    setJoining(g.id);
    const { error } = await supabase
      .from("chat_group_members")
      .insert({ group_id: g.id, user_id: user.id });
    setJoining(null);
    if (error) { toast.error(error.message); return; }
    toast.success(t("groupChat.discover.joinedToast", { name: g.name }));
    setMineIds((prev) => new Set(prev).add(g.id));
    onJoined?.();
  };

  const filtered = groups.filter((g) => g.name.toLowerCase().includes(q.toLowerCase()));

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Globe className="w-5 h-5 text-primary" />{t("groupChat.discover.title")}</DialogTitle>
          <DialogDescription className="text-xs">{t("groupChat.discover.desc")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("groupChat.discover.search")} className="pl-9" />
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1">
          {busy ? (
            <div className="flex justify-center py-8"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : filtered.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-8">{t("groupChat.discover.empty")}</p>
          ) : (
            filtered.map((g) => (
              <div key={g.id} className="flex items-center gap-3 p-3 rounded-lg border border-border/40 bg-card/40">
                <Avatar className="h-10 w-10">
                  <AvatarImage src={g.avatar_url ?? undefined} />
                  <AvatarFallback className="bg-primary/20 text-primary"><Users className="w-4 h-4" /></AvatarFallback>
                </Avatar>
                <div className="flex-1 min-w-0">
                  <div className="font-semibold text-sm truncate">{g.name}</div>
                  <div className="flex items-center gap-1.5 mt-0.5">
                    <Badge variant="outline" className="text-[10px]">
                      {g.is_public ? <><Globe className="w-2.5 h-2.5 mr-1" />{t("groupChat.discover.public")}</> : <><Lock className="w-2.5 h-2.5 mr-1" />{t("groupChat.discover.private")}</>}
                    </Badge>
                    {mineIds.has(g.id) && (
                      <Badge variant="secondary" className="text-[10px]">{t("groupChat.discover.joined")}</Badge>
                    )}
                  </div>
                </div>
                {mineIds.has(g.id) ? (
                  <Button size="sm" variant="outline" disabled>
                    {t("groupChat.discover.joined")}
                  </Button>
                ) : (
                  <Button size="sm" onClick={() => join(g)} disabled={joining === g.id}>
                    {joining === g.id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : t("groupChat.discover.join")}
                  </Button>
                )}
              </div>
            ))
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
