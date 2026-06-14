import { useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { supabase } from "@/integrations/supabase/client";
import { Eye, Loader2 } from "lucide-react";

interface Viewer {
  viewer_id: string;
  viewed_at: string;
  profile?: { display_name: string | null; avatar_url: string | null };
}

interface Props {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  storyId: string;
}

function rel(iso: string, t: TFunction) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return t("storyViewers.justNow");
  if (m < 60) return t("storyViewers.minutes", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("storyViewers.hours", { count: h });
  return t("storyViewers.days", { count: Math.floor(h / 24) });
}

export function StoryViewersDialog({ open, onOpenChange, storyId }: Props) {
  const { t } = useTranslation();
  const [viewers, setViewers] = useState<Viewer[]>([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!open) return;
    let mounted = true;
    (async () => {
      setLoading(true);
      const { data } = await supabase
        .from("feed_story_views")
        .select("viewer_id,viewed_at")
        .eq("story_id", storyId)
        .order("viewed_at", { ascending: false });
      const list = (data ?? []) as Viewer[];
      const ids = Array.from(new Set(list.map(v => v.viewer_id)));
      const { data: profs } = ids.length
        ? await supabase.from("profiles").select("user_id,display_name,avatar_url").in("user_id", ids)
        : { data: [] };
      const pMap = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
      if (mounted) {
        setViewers(list.map(v => ({ ...v, profile: pMap.get(v.viewer_id) as any })));
        setLoading(false);
      }
    })();
    return () => { mounted = false; };
  }, [open, storyId]);

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-md">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2"><Eye className="w-5 h-5 text-primary" /> {t("storyViewers.title", { count: viewers.length })}</DialogTitle>
        </DialogHeader>
        <div className="max-h-[60vh] overflow-y-auto space-y-1">
          {loading ? (
            <div className="py-8 flex justify-center"><Loader2 className="w-5 h-5 animate-spin text-primary" /></div>
          ) : viewers.length === 0 ? (
            <div className="py-8 text-center text-sm text-muted-foreground">{t("storyViewers.empty")}</div>
          ) : viewers.map(v => (
            <div key={v.viewer_id} className="flex items-center gap-3 p-2 rounded-lg hover:bg-muted">
              <div className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center text-primary font-display shrink-0">
                {v.profile?.avatar_url ? <img src={v.profile.avatar_url} alt="" className="w-full h-full object-cover" /> : (v.profile?.display_name ?? "?").slice(0, 1)}
              </div>
              <div className="flex-1 min-w-0">
                <div className="text-sm font-semibold truncate">{v.profile?.display_name ?? t("storyViewers.player")}</div>
                <div className="text-[11px] text-muted-foreground">{t("storyViewers.timeAgo", { time: rel(v.viewed_at, t) })}</div>
              </div>
            </div>
          ))}
        </div>
      </DialogContent>
    </Dialog>
  );
}
