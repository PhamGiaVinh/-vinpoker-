import { useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { z } from "zod";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { toast } from "sonner";
import { Send, Loader2 } from "lucide-react";
import { useTranslation } from "react-i18next";

interface CommentRow {
  id: string;
  user_id: string;
  content: string;
  created_at: string;
  profile?: { display_name: string | null; avatar_url: string | null };
}

interface ProfileRow {
  user_id: string;
  display_name: string | null;
  avatar_url: string | null;
}

const makeSchema = (errEmpty: string, errMax: string) =>
  z.object({ content: z.string().trim().min(1, errEmpty).max(300, errMax) });

const TTL_MS = 60_000;

const isFreshComment = (createdAt: string) => {
  const ts = new Date(createdAt).getTime();
  return Number.isFinite(ts) && Date.now() - ts < TTL_MS;
};

const fetchProfiles = async (userIds: string[]) => {
  if (userIds.length === 0) return {};
  const { data } = await supabase
    .from("profiles")
    .select("user_id,display_name,avatar_url")
    .in("user_id", userIds);
  return Object.fromEntries(((data ?? []) as ProfileRow[]).map((p) => [p.user_id, p]));
};

interface Props {
  tournamentId: string;
  /** Render only the floating overlay (absolute). Use inside the video container. */
  overlay?: boolean;
  /** Render only the input form. Use below the video. */
  inputOnly?: boolean;
  /** Render persistent scrollable comment list (no TTL expiry). */
  listOnly?: boolean;
}

export const FloatingStreamComments = ({ tournamentId, overlay, inputOnly, listOnly }: Props) => {
  const { t } = useTranslation();
  const { user } = useAuth();
  const [items, setItems] = useState<CommentRow[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const seen = useRef<Set<string>>(new Set());

  // Load latest to seed (only fetch comments < TTL old)
  useEffect(() => {
    if (inputOnly) return;
    let cancelled = false;
    (async () => {
      const sinceIso = new Date(Date.now() - TTL_MS).toISOString();
      const { data } = await supabase
        .from("stream_comments")
        .select("id,user_id,content,created_at")
        .eq("tournament_id", tournamentId)
        .gte("created_at", sinceIso)
        .order("created_at", { ascending: false })
        .limit(listOnly ? 100 : 10);
      const rows = ((data ?? []) as CommentRow[]).filter((r) => isFreshComment(r.created_at));
      const pmap = await fetchProfiles(Array.from(new Set(rows.map((r) => r.user_id))));
      if (cancelled) return;
      const enriched = rows
        .map((r) => ({ ...r, profile: pmap[r.user_id] }))
        .reverse();
      enriched.forEach((r) => seen.current.add(r.id));
      setItems(enriched);
    })();
    return () => { cancelled = true; };
  }, [tournamentId, inputOnly, listOnly]);

  // Hard expiry tick: keeps both overlay and live comment list in sync even if mobile timers are throttled.
  useEffect(() => {
    if (inputOnly) return;
    const prune = () => setItems((prev) => prev.filter((p) => isFreshComment(p.created_at)));
    prune();
    const timer = window.setInterval(prune, 1000);
    return () => window.clearInterval(timer);
  }, [inputOnly]);

  // Realtime subscribe
  useEffect(() => {
    if (inputOnly) return;
    const ch = supabase
      .channel(`floating-comments-${tournamentId}-${listOnly ? "list" : "overlay"}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "stream_comments", filter: `tournament_id=eq.${tournamentId}` },
        async (payload) => {
          const c = payload.new as CommentRow;
          if (seen.current.has(c.id)) return;
          seen.current.add(c.id);
          const pmap = await fetchProfiles([c.user_id]);
          const row = { ...c, profile: pmap[c.user_id] };
          setItems((prev) => [...prev.filter((p) => isFreshComment(p.created_at)), row]);
        },
      )
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [tournamentId, inputOnly, listOnly]);

  const submit = async () => {
    if (!user) return;
    const parsed = makeSchema(t("livestream.errEmpty"), t("livestream.errMax")).safeParse({ content: text });
    if (!parsed.success) {
      toast.error(parsed.error.issues[0]?.message ?? t("livestream.errInvalid"));
      return;
    }
    setSending(true);
    const { error } = await supabase.from("stream_comments").insert({
      tournament_id: tournamentId,
      user_id: user.id,
      content: parsed.data.content,
    });
    setSending(false);
    if (error) { toast.error(t("livestream.errSend")); return; }
    setText("");
  };

  if (overlay) {
    return (
      <div className="pointer-events-none absolute inset-x-0 bottom-0 max-h-[55%] overflow-hidden flex flex-col justify-end gap-1.5 p-2">
        {items.slice(-8).map((c) => (
          <div
            key={c.id}
            className="float-in flex items-center gap-2 bg-black/60 backdrop-blur-sm rounded-full pl-1 pr-3 py-1 max-w-[85%] w-fit text-white"
          >
            <Avatar className="w-6 h-6 shrink-0">
              {c.profile?.avatar_url && <AvatarImage src={c.profile.avatar_url} />}
              <AvatarFallback className="text-[10px] bg-muted text-foreground">
                {(c.profile?.display_name ?? "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0">
              <div className="text-[10px] font-bold opacity-80 truncate">
                {c.profile?.display_name ?? t("livestream.anonymous")}
              </div>
              <div className="text-xs leading-snug break-words">{c.content}</div>
            </div>
          </div>
        ))}
        <style>{`
          @keyframes floatIn { from { transform: translateY(20px); opacity: 0 } to { transform: translateY(0); opacity: 1 } }
          .float-in { animation: floatIn .35s ease-out both; }
        `}</style>
      </div>
    );
  }

  if (listOnly) {
    return (
      <div className="flex flex-col gap-2 max-h-[280px] overflow-y-auto px-1 py-2">
        {items.length === 0 && (
          <div className="text-xs text-muted-foreground text-center py-4">
            {t("livestream.noComments")}
          </div>
        )}
        {items.map((c) => (
          <div key={c.id} className="flex items-start gap-2 py-1.5 border-b border-border/40 last:border-0">
            <Avatar className="w-8 h-8 shrink-0">
              {c.profile?.avatar_url && <AvatarImage src={c.profile.avatar_url} />}
              <AvatarFallback className="text-[10px] bg-muted text-foreground">
                {(c.profile?.display_name ?? "?").slice(0, 2).toUpperCase()}
              </AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="text-xs font-semibold text-foreground truncate">
                {c.profile?.display_name ?? t("livestream.anonymous")}
              </div>
              <div className="text-sm text-foreground/90 break-words leading-snug">{c.content}</div>
            </div>
          </div>
        ))}
      </div>
    );
  }

  if (inputOnly) {
    return (
      <div>
        {user ? (
          <div className="flex items-center gap-2">
            <Input
              value={text}
              onChange={(e) => setText(e.target.value)}
              onBlur={() => {
                if (typeof window !== "undefined" && window.matchMedia("(max-width: 767px)").matches) {
                  window.dispatchEvent(new CustomEvent("livestream:resume"));
                }
              }}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }}
              placeholder={t("livestream.writeComment")}
              maxLength={300}
              className="rounded-full"
            />
            <Button
              size="icon"
              onClick={submit}
              disabled={sending || text.trim().length === 0}
              className="rounded-full gradient-gold text-primary-foreground border-0 shrink-0"
            >
              {sending ? <Loader2 className="w-4 h-4 animate-spin" /> : <Send className="w-4 h-4" />}
            </Button>
          </div>
        ) : (
          <Link to="/auth">
            <Button variant="outline" size="sm" className="w-full rounded-full">
              {t("livestream.loginToComment")}
            </Button>
          </Link>
        )}
      </div>
    );
  }

  return null;
};
