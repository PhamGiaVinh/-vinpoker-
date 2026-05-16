import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Button } from "@/components/ui/button";
import { Loader2, Search, UserPlus, Check } from "lucide-react";
import { supabase } from "@/integrations/supabase/client";
import { toast } from "sonner";

interface Props {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  groupId: string;
  onAdded?: () => void;
}

interface Profile {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

export const AddMemberDialog = ({ open, onOpenChange, groupId, onAdded }: Props) => {
  const { t } = useTranslation();
  const [q, setQ] = useState("");
  const [results, setResults] = useState<Profile[]>([]);
  const [memberIds, setMemberIds] = useState<Set<string>>(new Set());
  const [adding, setAdding] = useState<string | null>(null);
  const [added, setAdded] = useState<Set<string>>(new Set());
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!open) return;
    (async () => {
      const { data } = await supabase.from("chat_group_members").select("user_id").eq("group_id", groupId);
      setMemberIds(new Set((data ?? []).map((m: any) => m.user_id)));
    })();
  }, [open, groupId]);

  useEffect(() => {
    if (!open) return;
    const term = q.trim();
    if (term.length < 2) { setResults([]); return; }
    const tm = setTimeout(async () => {
      setBusy(true);
      const { data } = await supabase
        .from("profiles")
        .select("user_id, display_name, avatar_url")
        .ilike("display_name", `%${term}%`)
        .limit(20);
      setResults((data ?? []) as Profile[]);
      setBusy(false);
    }, 300);
    return () => clearTimeout(tm);
  }, [q, open]);

  const add = async (p: Profile) => {
    setAdding(p.user_id);
    const { error } = await supabase.from("chat_group_members").insert({ group_id: groupId, user_id: p.user_id });
    setAdding(null);
    if (error) { toast.error(error.message); return; }
    setAdded((prev) => new Set(prev).add(p.user_id));
    setMemberIds((prev) => new Set(prev).add(p.user_id));
    toast.success(t("groupChat.add.addedToast", { name: p.display_name ?? t("groupChat.add.unknown") }));
    onAdded?.();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md max-h-[80vh] flex flex-col">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><UserPlus className="w-5 h-5 text-primary" />{t("groupChat.add.title")}</DialogTitle>
          <DialogDescription className="text-xs">{t("groupChat.add.desc")}</DialogDescription>
        </DialogHeader>
        <div className="relative">
          <Search className="w-4 h-4 absolute left-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
          <Input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("groupChat.add.search")} className="pl-9" autoFocus />
        </div>
        <div className="flex-1 overflow-y-auto space-y-2 pr-1 min-h-[120px]">
          {busy ? (
            <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : q.trim().length < 2 ? (
            <p className="text-center text-xs text-muted-foreground py-6">{t("groupChat.add.hint")}</p>
          ) : results.length === 0 ? (
            <p className="text-center text-xs text-muted-foreground py-6">{t("groupChat.add.notFound")}</p>
          ) : (
            results.map((p) => {
              const isMember = memberIds.has(p.user_id);
              const justAdded = added.has(p.user_id);
              return (
                <div key={p.user_id} className="flex items-center gap-3 p-2 rounded-lg border border-border/40">
                  <Avatar className="h-9 w-9">
                    <AvatarImage src={p.avatar_url ?? undefined} />
                    <AvatarFallback className="bg-primary/20 text-primary text-xs">
                      {(p.display_name ?? "?").slice(0, 1).toUpperCase()}
                    </AvatarFallback>
                  </Avatar>
                  <div className="flex-1 min-w-0">
                    <div className="text-sm font-semibold truncate">{p.display_name ?? t("groupChat.add.unknown")}</div>
                  </div>
                  {isMember ? (
                    <Button size="sm" variant="ghost" disabled>
                      <Check className="w-3.5 h-3.5 mr-1" />{justAdded ? t("groupChat.add.justAdded") : t("groupChat.add.inGroup")}
                    </Button>
                  ) : (
                    <Button size="sm" onClick={() => add(p)} disabled={adding === p.user_id}>
                      {adding === p.user_id ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : <><UserPlus className="w-3.5 h-3.5 mr-1" />{t("groupChat.add.addBtn")}</>}
                    </Button>
                  )}
                </div>
              );
            })
          )}
        </div>
      </DialogContent>
    </Dialog>
  );
};
