import { useCallback, useEffect, useState } from "react";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { Loader2, Trash2, RefreshCw } from "lucide-react";

const sb = supabase as any;

interface PostRow {
  id: string;
  title: string | null;
  body: string;
  channels: string[];
  status: string;
  scheduled_at: string | null;
  sent_at: string | null;
  compliance_status: string;
  compliance_flags: string[];
  created_at: string;
}
interface ChannelRow { post_id: string; channel: string; status: string; error: string | null }

const STATUS_VARIANT: Record<string, "default" | "secondary" | "destructive" | "outline"> = {
  draft: "outline",
  scheduled: "secondary",
  processing: "secondary",
  sent: "default",
  failed: "destructive",
  cancelled: "outline",
};

interface Props { clubId: string; refreshKey: number; onChanged: () => void }

export const PostList = ({ clubId, refreshKey, onChanged }: Props) => {
  const { t } = useTranslation();
  const [posts, setPosts] = useState<PostRow[]>([]);
  const [channelsByPost, setChannelsByPost] = useState<Record<string, ChannelRow[]>>({});
  const [loading, setLoading] = useState(true);
  const [cancelling, setCancelling] = useState<string | null>(null);

  const load = useCallback(async () => {
    if (!clubId) { setPosts([]); setLoading(false); return; }
    setLoading(true);
    try {
      const { data, error } = await sb
        .from("marketing_posts")
        .select("id,title,body,channels,status,scheduled_at,sent_at,compliance_status,compliance_flags,created_at")
        .eq("club_id", clubId)
        .order("created_at", { ascending: false })
        .limit(50);
      if (error) { setPosts([]); setChannelsByPost({}); return; }
      const rows = (data ?? []) as PostRow[];
      setPosts(rows);
      const ids = rows.map((r) => r.id);
      if (ids.length) {
        const { data: cs } = await sb
          .from("post_channel_status")
          .select("post_id,channel,status,error")
          .in("post_id", ids);
        const map: Record<string, ChannelRow[]> = {};
        for (const r of (cs ?? []) as ChannelRow[]) (map[r.post_id] ||= []).push(r);
        setChannelsByPost(map);
      } else {
        setChannelsByPost({});
      }
    } catch {
      setPosts([]); setChannelsByPost({});
    } finally {
      setLoading(false);
    }
  }, [clubId]);

  useEffect(() => { load(); }, [load, refreshKey]);

  const onCancel = async (id: string) => {
    setCancelling(id);
    try {
      const { data, error } = await sb.rpc("marketing_cancel_post", { p_post_id: id });
      if (error || data?.error) { toast.error(error?.message ?? data?.error ?? "error"); return; }
      toast.success(t("marketing.list.cancelled"));
      onChanged();
    } finally { setCancelling(null); }
  };

  if (loading) return <div className="space-y-2"><Skeleton className="h-20 w-full" /><Skeleton className="h-20 w-full" /></div>;

  if (posts.length === 0) {
    return (
      <Card>
        <CardContent className="flex items-center justify-between py-6 text-sm text-muted-foreground">
          {t("marketing.list.empty")}
          <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-4 w-4" />{t("marketing.list.refresh")}</Button>
        </CardContent>
      </Card>
    );
  }

  const fmtTime = (iso: string | null) => (iso ? new Date(iso).toLocaleString("vi-VN") : "—");

  return (
    <div className="space-y-3">
      <div className="flex justify-end">
        <Button variant="ghost" size="sm" onClick={load}><RefreshCw className="mr-1.5 h-4 w-4" />{t("marketing.list.refresh")}</Button>
      </div>
      {posts.map((p) => (
        <Card key={p.id}>
          <CardContent className="space-y-2 py-4">
            <div className="flex items-start justify-between gap-3">
              <div className="min-w-0">
                {p.title && <div className="truncate font-medium text-foreground">{p.title}</div>}
                <div className="line-clamp-2 whitespace-pre-wrap text-sm text-muted-foreground">{p.body}</div>
              </div>
              <Badge variant={STATUS_VARIANT[p.status] ?? "outline"}>{t(`marketing.status.${p.status}`)}</Badge>
            </div>

            <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-xs text-muted-foreground">
              <span>{t("marketing.list.channels")}: {(p.channels ?? []).join(", ") || "—"}</span>
              <span>{t("marketing.list.scheduledAt")}: {fmtTime(p.scheduled_at)}</span>
              {p.sent_at && <span>{t("marketing.list.sentAt")}: {fmtTime(p.sent_at)}</span>}
            </div>

            {p.compliance_status === "blocked" && (
              <div className="text-xs text-destructive">
                {t("marketing.list.blocked")}: {(p.compliance_flags ?? []).join(", ")}
              </div>
            )}

            {(channelsByPost[p.id] ?? []).length > 0 && (
              <div className="flex flex-wrap gap-2 pt-1">
                {(channelsByPost[p.id] ?? []).map((c) => (
                  <Badge key={c.channel} variant={c.status === "sent" ? "default" : c.status === "failed" ? "destructive" : "secondary"}>
                    {c.channel}: {t(`marketing.delivery.${c.status}`)}
                  </Badge>
                ))}
              </div>
            )}

            {(p.status === "draft" || p.status === "scheduled") && (
              <div className="pt-1">
                <Button variant="outline" size="sm" onClick={() => onCancel(p.id)} disabled={cancelling === p.id}>
                  {cancelling === p.id ? <Loader2 className="mr-1.5 h-4 w-4 animate-spin" /> : <Trash2 className="mr-1.5 h-4 w-4" />}
                  {t("marketing.list.cancel")}
                </Button>
              </div>
            )}
          </CardContent>
        </Card>
      ))}
    </div>
  );
};
