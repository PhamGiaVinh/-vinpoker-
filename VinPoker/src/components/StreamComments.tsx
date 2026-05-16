import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { MessageSquare, Loader2 } from "lucide-react";

interface CommentRow {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profile?: { display_name: string | null; avatar_url: string | null };
}

const schema = z.object({ content: z.string().trim().min(1, "Hãy nhập nội dung").max(500, "Tối đa 500 ký tự") });

const relativeTime = (iso: string) => {
  const diff = (Date.now() - new Date(iso).getTime()) / 1000;
  if (diff < 60) return "vừa xong";
  if (diff < 3600) return `${Math.floor(diff / 60)} phút trước`;
  if (diff < 86400) return `${Math.floor(diff / 3600)} giờ trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
};

export const StreamComments = ({ tournamentId }: { tournamentId: string }) => {
  const { user } = useAuth();
  const [items, setItems] = useState<CommentRow[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const listRef = useRef<HTMLDivElement>(null);

  const fetchProfiles = async (userIds: string[]) => {
    if (userIds.length === 0) return {};
    const { data } = await supabase.from("profiles").select("user_id,display_name,avatar_url").in("user_id", userIds);
    return Object.fromEntries((data ?? []).map((p: any) => [p.user_id, p]));
  };

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const { data } = await supabase
        .from("stream_comments")
        .select("id,user_id,content,created_at")
        .eq("tournament_id", tournamentId)
        .order("created_at", { ascending: false })
        .limit(50);
      const rows = (data ?? []) as CommentRow[];
      const pmap = await fetchProfiles(Array.from(new Set(rows.map((r) => r.user_id))));
      if (!cancelled) {
        setItems(rows.map((r) => ({ ...r, profile: pmap[r.user_id] })).reverse());
        setLoading(false);
      }
    })();
    return () => { cancelled = true; };
  }, [tournamentId]);

  useEffect(() => {
    const ch = supabase
      .channel(`stream-comments-${tournamentId}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "stream_comments", filter: `tournament_id=eq.${tournamentId}` },
        async (payload) => {
          const c = payload.new as CommentRow;
          const pmap = await fetchProfiles([c.user_id]);
          setItems((prev) => (prev.find((p) => p.id === c.id) ? prev : [...prev, { ...c, profile: pmap[c.user_id] }]));
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tournamentId]);

  useEffect(() => {
    if (listRef.current) listRef.current.scrollTop = listRef.current.scrollHeight;
  }, [items.length]);

  const submit = async () => {
    if (!user) return;
    const parsed = schema.safeParse({ content: text });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? "Nội dung không hợp lệ");
      return;
    }
    setSending(true);
    const { error } = await supabase.from("stream_comments").insert({
      tournament_id: tournamentId,
      user_id: user.id,
      content: parsed.data.content,
    });
    setSending(false);
    if (error) {
      toast.error("Gửi bình luận thất bại");
      return;
    }
    setText("");
  };

  return (
    <Card className="gradient-card border-gold p-4 shadow-gold">
      <h3 className="font-display font-bold text-base mb-3 flex items-center gap-2">
        <MessageSquare className="w-4 h-4 text-gold" /> Bình luận
        <span className="text-xs text-muted-foreground font-normal">({items.length})</span>
      </h3>

      <div ref={listRef} className="max-h-[360px] overflow-y-auto space-y-3 pr-1">
        {loading ? (
          <div className="flex justify-center py-6"><Loader2 className="w-5 h-5 animate-spin text-gold" /></div>
        ) : items.length === 0 ? (
          <p className="text-sm text-muted-foreground text-center py-6">Chưa có bình luận. Hãy là người đầu tiên!</p>
        ) : (
          items.map((c) => (
            <div key={c.id} className="flex gap-2.5">
              <Avatar className="w-8 h-8 shrink-0">
                {c.profile?.avatar_url && <AvatarImage src={c.profile.avatar_url} />}
                <AvatarFallback className="text-xs">{(c.profile?.display_name ?? "?").slice(0, 2).toUpperCase()}</AvatarFallback>
              </Avatar>
              <div className="flex-1 min-w-0">
                <div className="flex items-baseline gap-2">
                  <span className="text-sm font-semibold truncate">{c.profile?.display_name ?? "Người dùng"}</span>
                  <span className="text-[10px] text-muted-foreground">{relativeTime(c.created_at)}</span>
                </div>
                <p className="text-sm whitespace-pre-wrap break-words">{c.content}</p>
              </div>
            </div>
          ))
        )}
      </div>

      <div className="mt-3 pt-3 border-t border-border">
        {user ? (
          <div className="space-y-2">
            <Textarea
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder="Viết bình luận của bạn..."
              maxLength={500}
              rows={2}
              className="resize-none"
            />
            <div className="flex items-center justify-between">
              <span className="text-[10px] text-muted-foreground">{text.length}/500</span>
              <Button size="sm" onClick={submit} disabled={sending || text.trim().length === 0} className="gradient-gold text-primary-foreground border-0">
                {sending ? <Loader2 className="w-3.5 h-3.5 animate-spin" /> : "Gửi"}
              </Button>
            </div>
          </div>
        ) : (
          <Link to="/auth" className="block">
            <Button variant="outline" className="w-full" size="sm">Đăng nhập để bình luận</Button>
          </Link>
        )}
      </div>
    </Card>
  );
};
