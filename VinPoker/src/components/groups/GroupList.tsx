import { useEffect, useState, useMemo } from "react";
import { Link } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Loader2, Users, Plus, Compass, Lock, Globe, MessageCircle } from "lucide-react";
import { CreateGroupDialog } from "./CreateGroupDialog";
import { DiscoverGroupsDialog } from "./DiscoverGroupsDialog";

interface MemberRow {
  group_id: string;
  last_read_at: string;
  joined_at: string;
}
interface Group {
  id: string;
  name: string;
  avatar_url: string | null;
  is_public: boolean;
  updated_at: string;
}
interface LastMsg { group_id: string; content: string; created_at: string; sender_id: string }

export const GroupList = () => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [members, setMembers] = useState<Record<string, MemberRow>>({});
  const [groups, setGroups] = useState<Group[]>([]);
  const [lastMsgs, setLastMsgs] = useState<Record<string, LastMsg>>({});
  const [unread, setUnread] = useState<Record<string, number>>({});
  const [busy, setBusy] = useState(true);
  const [openCreate, setOpenCreate] = useState(false);
  const [openDiscover, setOpenDiscover] = useState(false);

  const load = async () => {
    if (!user) return;
    const { data: mems } = await supabase
      .from("chat_group_members")
      .select("group_id, last_read_at, joined_at")
      .eq("user_id", user.id);
    const memMap: Record<string, MemberRow> = {};
    (mems ?? []).forEach((m: any) => { memMap[m.group_id] = m; });
    setMembers(memMap);
    const ids = Object.keys(memMap);
    if (ids.length === 0) { setGroups([]); setBusy(false); return; }
    const [{ data: gs }, { data: msgs }] = await Promise.all([
      supabase.from("chat_groups").select("id, name, avatar_url, is_public, updated_at").in("id", ids).is("deleted_at", null).order("updated_at", { ascending: false }),
      supabase.from("chat_group_messages").select("group_id, content, created_at, sender_id").in("group_id", ids).is("deleted_at", null).order("created_at", { ascending: false }).limit(500),
    ]);
    setGroups((gs ?? []) as Group[]);
    const latest: Record<string, LastMsg> = {};
    const counts: Record<string, number> = {};
    for (const m of (msgs ?? []) as any[]) {
      if (!latest[m.group_id]) latest[m.group_id] = m;
      const lr = memMap[m.group_id]?.last_read_at;
      if (lr && new Date(m.created_at) > new Date(lr) && m.sender_id !== user.id) {
        counts[m.group_id] = (counts[m.group_id] ?? 0) + 1;
      }
    }
    setLastMsgs(latest);
    setUnread(counts);
    setBusy(false);
  };

  useEffect(() => {
    setBusy(true);
    load();
    const ch = supabase.channel("groups-list")
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_group_messages" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_group_members" }, load)
      .on("postgres_changes", { event: "*", schema: "public", table: "chat_groups" }, load)
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line
  }, [user?.id]);

  const sorted = useMemo(() =>
    [...groups].sort((a, b) => {
      const la = lastMsgs[a.id]?.created_at ?? a.updated_at;
      const lb = lastMsgs[b.id]?.created_at ?? b.updated_at;
      return new Date(lb).getTime() - new Date(la).getTime();
    }), [groups, lastMsgs]);

  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <Button size="sm" className="flex-1" onClick={() => setOpenCreate(true)}>
          <Plus className="w-3.5 h-3.5 mr-1" /> {t("groupChat.list.create")}
        </Button>
        <Button size="sm" variant="outline" className="flex-1" onClick={() => setOpenDiscover(true)}>
          <Compass className="w-3.5 h-3.5 mr-1" /> {t("groupChat.list.discover")}
        </Button>
      </div>

      {busy ? (
        <div className="space-y-2">
          {[0, 1, 2].map((i) => <Skeleton key={i} className="h-16 w-full" />)}
        </div>
      ) : sorted.length === 0 ? (
        <Card className="p-10 text-center gradient-card">
          <Users className="w-10 h-10 mx-auto text-muted-foreground mb-2" />
          <p className="text-sm text-muted-foreground">{t("groupChat.list.empty")}</p>
          <p className="text-xs text-muted-foreground mt-1">{t("groupChat.list.emptyHint")}</p>
        </Card>
      ) : (
        <div className="space-y-2">
          {sorted.map((g) => {
            const lm = lastMsgs[g.id];
            const u = unread[g.id] ?? 0;
            return (
              <Link key={g.id} to={`/group/${g.id}`}>
                <Card className="p-3 hover:border-primary/40 transition-colors flex items-center gap-3 bg-card/40 border-border/40">
                  <Avatar className="h-12 w-12">
                    <AvatarImage src={g.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary"><Users className="w-5 h-5" /></AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="flex items-center gap-2">
                      <span className="font-semibold text-sm truncate">{g.name}</span>
                      {g.is_public ? <Globe className="w-3 h-3 text-muted-foreground shrink-0" /> : <Lock className="w-3 h-3 text-muted-foreground shrink-0" />}
                    </div>
                    <div className="text-xs text-muted-foreground truncate mt-0.5">
                      {lm ? lm.content : <span className="italic">{t("groupChat.list.noMessages")}</span>}
                    </div>
                  </div>
                  {u > 0 && (
                    <Badge className="bg-primary text-primary-foreground">{u > 99 ? "99+" : u}</Badge>
                  )}
                </Card>
              </Link>
            );
          })}
        </div>
      )}

      <CreateGroupDialog open={openCreate} onOpenChange={setOpenCreate} onCreated={load} />
      <DiscoverGroupsDialog open={openDiscover} onOpenChange={setOpenDiscover} onJoined={load} />
    </div>
  );
};
