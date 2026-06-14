import { useEffect, useRef, useState, useCallback } from "react";
import { Navigate, useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import type { TFunction } from "i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { toast } from "sonner";
import { Heart, MessageCircle, Image as ImageIcon, X, Loader2, Plus, Spade, Eye } from "lucide-react";
import { cn } from "@/lib/utils";
import { CardSlot, cardToSymbol, type CardCode } from "@/components/poker/CardSlot";
import { CreateStoryMultiDialog } from "@/components/feed/CreateStoryMultiDialog";
import { StoryViewersDialog } from "@/components/feed/StoryViewersDialog";
import { StoryMusicSticker, type StickerMusic } from "@/components/feed/StoryMusicSticker";

type PostType = "general" | "hand_review" | "achievement";

interface FeedPost {
  id: string;
  author_id: string;
  content: string;
  post_type: PostType;
  poker_hand: any;
  media_urls: string[];
  like_count: number;
  comment_count: number;
  created_at: string;
  author?: { display_name: string | null; avatar_url: string | null };
  is_liked?: boolean;
}

interface FeedStory {
  id: string;
  author_id: string;
  media_url: string;
  media_type: "image" | "video";
  caption: string | null;
  created_at: string;
  music_source: "library" | "soundcloud" | null;
  music_url: string | null;
  music_name: string | null;
  music_artist: string | null;
  music_thumbnail_url: string | null;
  music_soundcloud_url: string | null;
  music_html: string | null;
  author?: { display_name: string | null; avatar_url: string | null };
  is_viewed?: boolean;
}

function relTime(iso: string, t: TFunction) {
  const d = Date.now() - new Date(iso).getTime();
  const m = Math.floor(d / 60000);
  if (m < 1) return t("timeAgo.justNow");
  if (m < 60) return t("timeAgo.minutesShort", { count: m });
  const h = Math.floor(m / 60);
  if (h < 24) return t("timeAgo.hoursShort", { count: h });
  return t("timeAgo.daysShort", { count: Math.floor(h / 24) });
}

export default function Feed() {
  const { t } = useTranslation();
  const { user, loading: authLoading } = useAuth();
  const [posts, setPosts] = useState<FeedPost[]>([]);
  const [stories, setStories] = useState<FeedStory[]>([]);
  const [loading, setLoading] = useState(true);
  const [createOpen, setCreateOpen] = useState(false);
  const [storyOpen, setStoryOpen] = useState<FeedStory | null>(null);
  const [createStoryOpen, setCreateStoryOpen] = useState(false);

  const loadPosts = useCallback(async () => {
    const { data, error } = await supabase
      .from("feed_posts")
      .select("id,author_id,content,post_type,poker_hand,media_urls,like_count,comment_count,created_at")
      .eq("is_deleted", false)
      .order("created_at", { ascending: false })
      .limit(50);
    if (error) { console.error(error); return; }
    const list = (data ?? []) as FeedPost[];
    const authorIds = Array.from(new Set(list.map(p => p.author_id)));
    const [{ data: profiles }, { data: liked }] = await Promise.all([
      supabase.from("profiles").select("user_id,display_name,avatar_url").in("user_id", authorIds.length ? authorIds : ["00000000-0000-0000-0000-000000000000"]),
      user
        ? supabase.from("feed_post_likes").select("post_id").eq("user_id", user.id).in("post_id", list.map(p => p.id).length ? list.map(p => p.id) : ["00000000-0000-0000-0000-000000000000"])
        : Promise.resolve({ data: [] as any[] } as any),
    ]);
    const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
    const likedSet = new Set((liked ?? []).map((l: any) => l.post_id));
    setPosts(list.map(p => ({
      ...p,
      author: pMap.get(p.author_id) as any,
      is_liked: likedSet.has(p.id),
    })));
    setLoading(false);
  }, [user]);

  const loadStories = useCallback(async () => {
    const since = new Date(Date.now() - 24 * 60 * 60 * 1000).toISOString();
    const { data } = await supabase
      .from("feed_stories")
      .select("id,author_id,media_url,media_type,caption,created_at,music_source,music_url,music_name,music_artist,music_thumbnail_url,music_soundcloud_url,music_html")
      .gte("created_at", since)
      .order("created_at", { ascending: false });
    const list = (data ?? []) as FeedStory[];
    const authorIds = Array.from(new Set(list.map(s => s.author_id)));
    const [{ data: profiles }, { data: views }] = await Promise.all([
      supabase.from("profiles").select("user_id,display_name,avatar_url").in("user_id", authorIds.length ? authorIds : ["00000000-0000-0000-0000-000000000000"]),
      user
        ? supabase.from("feed_story_views").select("story_id").eq("viewer_id", user.id).in("story_id", list.map(s => s.id).length ? list.map(s => s.id) : ["00000000-0000-0000-0000-000000000000"])
        : Promise.resolve({ data: [] as any[] } as any),
    ]);
    const pMap = new Map((profiles ?? []).map((p: any) => [p.user_id, p]));
    const viewedSet = new Set((views ?? []).map((v: any) => v.story_id));
    setStories(list.map(s => ({ ...s, author: pMap.get(s.author_id) as any, is_viewed: viewedSet.has(s.id) })));
  }, [user]);

  useEffect(() => {
    if (authLoading) return;
    loadPosts(); loadStories();
    const ch = supabase
      .channel("feed-rt")
      .on("postgres_changes", { event: "*", schema: "public", table: "feed_posts" }, () => loadPosts())
      .on("postgres_changes", { event: "*", schema: "public", table: "feed_post_likes" }, () => loadPosts())
      .on("postgres_changes", { event: "*", schema: "public", table: "feed_post_comments" }, () => loadPosts())
      .on("postgres_changes", { event: "*", schema: "public", table: "feed_stories" }, () => loadStories())
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [authLoading, loadPosts, loadStories]);

  const toggleLike = async (post: FeedPost) => {
    if (!user) { toast.error(t("feed.loginRequired")); return; }
    if (post.is_liked) {
      await supabase.from("feed_post_likes").delete().eq("post_id", post.id).eq("user_id", user.id);
    } else {
      await supabase.from("feed_post_likes").insert({ post_id: post.id, user_id: user.id });
    }
    // optimistic
    setPosts(prev => prev.map(p => p.id === post.id ? {
      ...p, is_liked: !post.is_liked, like_count: p.like_count + (post.is_liked ? -1 : 1),
    } : p));
  };

  const openStory = async (s: FeedStory) => {
    setStoryOpen(s);
    if (user && !s.is_viewed) {
      await supabase.from("feed_story_views").insert({ story_id: s.id, viewer_id: user.id });
      setStories(prev => prev.map(x => x.id === s.id ? { ...x, is_viewed: true } : x));
    }
  };

  if (authLoading) {
    return <div className="flex items-center justify-center min-h-[50vh]"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  }
  if (!user) return <Navigate to="/auth" replace />;

  const myStory = stories.find(s => s.author_id === user.id);
  const otherStories = stories.filter(s => s.author_id !== user.id);

  return (
    <div className="max-w-2xl mx-auto px-3 sm:px-4 py-4 space-y-4">
      <section className="relative rounded-2xl bg-gradient-to-br from-card/60 to-card/40 border border-gold/30 p-6 backdrop-blur-sm overflow-hidden">
        <div className="absolute inset-0 pointer-events-none">
          <div className="absolute -top-40 -right-40 w-80 h-80 bg-primary/20 rounded-full blur-3xl opacity-30" />
          <div className="absolute -bottom-40 -left-40 w-96 h-96 bg-primary/10 rounded-full blur-[120px] opacity-20" />
        </div>
        <div className="relative">
          <h1 className="font-display text-3xl md:text-5xl lg:text-6xl font-bold tracking-tight text-foreground">
            {t("feed.title")}
          </h1>
        </div>
      </section>

      {/* Stories row */}
      <div className="flex gap-3 overflow-x-auto pb-2 -mx-1 px-1">
        <StoryBubble
          name={t("feed.yourStory")}
          avatarUrl={myStory?.author?.avatar_url ?? null}
          viewed={false}
          isOwn
          onClick={() => myStory ? openStory(myStory) : setCreateStoryOpen(true)}
          onAdd={() => setCreateStoryOpen(true)}
        />
        {otherStories.map(s => (
          <StoryBubble
            key={s.id}
            name={s.author?.display_name ?? t("feed.anonymousPlayer")}
            avatarUrl={s.author?.avatar_url ?? null}
            viewed={!!s.is_viewed}
            onClick={() => openStory(s)}
          />
        ))}
      </div>

      {/* Create post trigger */}
      <button
        onClick={() => setCreateOpen(true)}
        className="w-full flex items-center gap-3 p-3 rounded-xl bg-card border border-border hover:border-primary/40 transition text-left"
      >
        <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center text-primary font-display">
          {(user.email ?? "?").slice(0, 1).toUpperCase()}
        </div>
        <span className="text-muted-foreground text-sm">{t("feed.sharePrompt")}</span>
      </button>

      {/* Posts */}
      {loading ? (
        <div className="flex justify-center py-10"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>
      ) : posts.length === 0 ? (
        <div className="text-center text-muted-foreground py-12">{t("feed.empty")}</div>
      ) : (
        posts.map(p => (
          <PostCard key={p.id} post={p} onLike={() => toggleLike(p)} currentUserId={user.id} />
        ))
      )}

      {createOpen && (
        <CreatePostDialog onClose={() => setCreateOpen(false)} onCreated={() => { setCreateOpen(false); loadPosts(); }} userId={user.id} />
      )}
      {createStoryOpen && (
        <CreateStoryMultiDialog onClose={() => setCreateStoryOpen(false)} onCreated={() => { setCreateStoryOpen(false); loadStories(); }} userId={user.id} />
      )}
      {storyOpen && (
        <StoryViewer story={storyOpen} currentUserId={user.id} onClose={() => setStoryOpen(null)} />
      )}
    </div>
  );
}

function StoryBubble({ name, avatarUrl, viewed, isOwn, onClick, onAdd }: { name: string; avatarUrl: string | null; viewed: boolean; isOwn?: boolean; onClick: () => void; onAdd?: () => void }) {
  const { t } = useTranslation();
  return (
    <button onClick={onClick} className="flex flex-col items-center gap-1.5 shrink-0 w-[72px]">
      <div className={cn(
        "w-16 h-16 rounded-full p-[2px] relative",
        viewed ? "bg-muted" : "gradient-neon",
      )}>
        <div className="w-full h-full rounded-full bg-card flex items-center justify-center overflow-hidden">
          {avatarUrl ? <img src={avatarUrl} alt={name} className="w-full h-full object-cover rounded-full" /> : <span className="text-primary font-display text-lg">{name.slice(0, 1)}</span>}
        </div>
        {isOwn && (
          <span
            role="button"
            tabIndex={0}
            onClick={(e) => { e.stopPropagation(); onAdd?.(); }}
            onKeyDown={(e) => { if (e.key === "Enter" || e.key === " ") { e.stopPropagation(); onAdd?.(); } }}
            className="absolute bottom-0 right-0 w-5 h-5 rounded-full bg-primary text-primary-foreground flex items-center justify-center border-2 border-card cursor-pointer hover:scale-110 transition"
            aria-label={t("feed.addStory")}
          >
            <Plus className="w-3 h-3" />
          </span>
        )}
      </div>
      <span className="text-[11px] text-muted-foreground truncate w-full text-center">{name}</span>
    </button>
  );
}

function PostCard({ post, onLike, currentUserId }: { post: FeedPost; onLike: () => void; currentUserId: string }) {
  const { t } = useTranslation();
  const [showComments, setShowComments] = useState(false);
  const [comments, setComments] = useState<any[]>([]);
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const navigate = useNavigate();

  const loadComments = useCallback(async () => {
    const { data } = await supabase
      .from("feed_post_comments")
      .select("id,user_id,content,created_at")
      .eq("post_id", post.id).eq("is_deleted", false)
      .order("created_at", { ascending: true });
    const list = data ?? [];
    const uids = Array.from(new Set(list.map((c: any) => c.user_id)));
    const { data: profs } = await supabase.from("profiles").select("user_id,display_name,avatar_url").in("user_id", uids.length ? uids : ["00000000-0000-0000-0000-000000000000"]);
    const pMap = new Map((profs ?? []).map((p: any) => [p.user_id, p]));
    setComments(list.map((c: any) => ({ ...c, author: pMap.get(c.user_id) })));
  }, [post.id]);

  const submitComment = async () => {
    const t = text.trim();
    if (!t) return;
    setPosting(true);
    const { error } = await supabase.from("feed_post_comments").insert({ post_id: post.id, user_id: currentUserId, content: t });
    setPosting(false);
    if (error) { toast.error(error.message); return; }
    setText("");
    loadComments();
  };

  return (
    <article className="rounded-xl bg-card border border-border overflow-hidden">
      <header className="flex items-center gap-3 p-3">
        <button onClick={() => navigate(`/player/${post.author_id}`)} className="w-10 h-10 rounded-full bg-muted overflow-hidden flex items-center justify-center text-primary font-display">
          {post.author?.avatar_url ? <img src={post.author.avatar_url} alt="" className="w-full h-full object-cover" /> : (post.author?.display_name ?? "?").slice(0, 1)}
        </button>
        <div className="flex-1 min-w-0">
          <div className="text-sm font-semibold truncate">{post.author?.display_name ?? t("feed.anonymousPlayer")}</div>
          <div className="text-[11px] text-muted-foreground">{relTime(post.created_at, t)} {t("feed.ago")}</div>
        </div>
        {post.post_type === "hand_review" && (
          <span className="text-[10px] px-2 py-0.5 rounded-full border border-primary/40 text-primary">HAND</span>
        )}
      </header>

      {post.content && (
        <p className="px-3 pb-2 text-[15px] whitespace-pre-wrap leading-relaxed">{post.content}</p>
      )}

      {post.poker_hand && (
        <div className="mx-3 mb-2 p-3 rounded-lg bg-muted/40 border border-border text-xs space-y-1">
          {post.poker_hand.cards?.length > 0 && (
            <div className="flex gap-1.5">
              {(post.poker_hand.cards as any[]).map((c, i) => (
                <span key={i} className={cn(
                  "px-2 py-1 rounded bg-card border border-border font-display",
                  (c.suit === "♥" || c.suit === "♦") && "text-destructive",
                )}>{c.rank}{c.suit}</span>
              ))}
            </div>
          )}
          <div className="flex flex-wrap gap-x-3 gap-y-1 text-muted-foreground">
            {post.poker_hand.game_type && <span>Game: <b className="text-foreground">{post.poker_hand.game_type}</b></span>}
            {post.poker_hand.pot_size > 0 && <span>Pot: <b className="text-foreground">{post.poker_hand.pot_size.toLocaleString()}</b></span>}
            {post.poker_hand.result && (
              <span className={post.poker_hand.result === "win" ? "text-primary font-semibold" : "text-destructive font-semibold"}>
                {post.poker_hand.result === "win" ? "↑ WIN" : "↓ LOSS"}
              </span>
            )}
          </div>
        </div>
      )}

      {post.media_urls?.length > 0 && (
        <div className={cn("grid gap-1", post.media_urls.length === 1 ? "grid-cols-1" : "grid-cols-2")}>
          {post.media_urls.map((url, i) => (
            /\.(mp4|webm|mov|m4v)(\?|$)/i.test(url) ? (
              <video key={i} src={url} controls playsInline preload="metadata" className="w-full max-h-[480px] bg-black" />
            ) : (
              <img key={i} src={url} alt="" className="w-full max-h-[480px] object-cover" />
            )
          ))}
        </div>
      )}

      <div className="px-3 py-2 flex items-center gap-1 border-t border-border">
        <Button variant="ghost" size="sm" onClick={onLike} className={cn("flex-1", post.is_liked && "text-primary")}>
          <Heart className={cn("w-4 h-4", post.is_liked && "fill-primary")} />
          <span>{post.like_count}</span>
        </Button>
        <Button variant="ghost" size="sm" className="flex-1" onClick={() => { setShowComments(v => !v); if (!showComments) loadComments(); }}>
          <MessageCircle className="w-4 h-4" /> <span>{post.comment_count}</span>
        </Button>
      </div>

      {showComments && (
        <div className="border-t border-border p-3 space-y-2 bg-background/40">
          {comments.map(c => (
            <div key={c.id} className="flex gap-2 text-sm">
              <div className="w-7 h-7 rounded-full bg-muted shrink-0 overflow-hidden flex items-center justify-center text-xs">
                {c.author?.avatar_url ? <img src={c.author.avatar_url} alt="" className="w-full h-full object-cover" /> : (c.author?.display_name ?? "?").slice(0,1)}
              </div>
              <div className="bg-muted rounded-2xl px-3 py-1.5">
                <div className="text-[12px] font-semibold">{c.author?.display_name ?? t("feed.anonymousPlayer")}</div>
                <div>{c.content}</div>
              </div>
            </div>
          ))}
          <div className="flex gap-2 pt-1">
            <input
              value={text}
              onChange={e => setText(e.target.value)}
              onKeyDown={e => e.key === "Enter" && submitComment()}
              placeholder={t("feed.comment.placeholder")}
              maxLength={1000}
              className="flex-1 bg-muted rounded-full px-3 py-1.5 text-sm outline-none focus:ring-1 focus:ring-primary"
            />
            <Button size="sm" onClick={submitComment} disabled={posting || !text.trim()}>{t("feed.comment.send")}</Button>
          </div>
        </div>
      )}
    </article>
  );
}

function CreatePostDialog({ onClose, onCreated, userId }: { onClose: () => void; onCreated: () => void; userId: string }) {
  const { t } = useTranslation();
  const [content, setContent] = useState("");
  const [files, setFiles] = useState<File[]>([]);
  const [posting, setPosting] = useState(false);
  // hand review optional
  const [heroCards, setHeroCards] = useState<(CardCode | null)[]>([null, null]);
  const [boardCards, setBoardCards] = useState<(CardCode | null)[]>([null, null, null, null, null]);
  const [hand, setHand] = useState({ game_type: "NLH", pot_size: 0, result: "" as "" | "win" | "loss" });
  const fileRef = useRef<HTMLInputElement>(null);
  const usedCards = new Set<CardCode>([...heroCards, ...boardCards].filter(Boolean) as CardCode[]);

  const submit = async () => {
    if (!content.trim() && files.length === 0) { toast.error(t("feed.create.errEmpty")); return; }
    setPosting(true);
    try {
      const urls: string[] = [];
      for (const f of files) {
        const isVideo = f.type.startsWith("video/");
        const max = isVideo ? 50 * 1024 * 1024 : 10 * 1024 * 1024;
        if (f.size > max) { toast.error(t("feed.create.errSize", { name: f.name, limit: isVideo ? "50MB" : "10MB" })); continue; }
        const ext = f.name.split(".").pop() ?? "bin";
        const path = `${userId}/posts/${Date.now()}-${Math.random().toString(36).slice(2)}.${ext}`;
        const { error: upErr } = await supabase.storage.from("feed-media").upload(path, f);
        if (upErr) throw upErr;
        const { data } = supabase.storage.from("feed-media").getPublicUrl(path);
        urls.push(data.publicUrl);
      }
      const hero = heroCards.filter(Boolean) as CardCode[];
      const board = boardCards.filter(Boolean) as CardCode[];
      const hasHand = hero.length > 0 || board.length > 0 || hand.pot_size > 0 || !!hand.result;
      const poker_hand = hasHand ? {
        hero: hero.map(cardToSymbol),
        board: board.map(cardToSymbol),
        cards: [...hero, ...board].map(cardToSymbol),
        game_type: hand.game_type,
        pot_size: Number(hand.pot_size) || 0,
        result: hand.result || undefined,
      } : null;
      const { error } = await supabase.from("feed_posts").insert({
        author_id: userId,
        content: content.trim(),
        post_type: hasHand ? "hand_review" : "general",
        media_urls: urls,
        poker_hand,
      });
      if (error) throw error;
      toast.success(t("feed.create.ok"));
      onCreated();
    } catch (e: any) {
      toast.error(e.message ?? t("feed.create.fail"));
    } finally { setPosting(false); }
  };

  return (
    <Dialog open onOpenChange={(v) => !v && onClose()}>
      <DialogContent className="max-w-lg max-h-[90vh] overflow-y-auto">
        <DialogHeader><DialogTitle>{t("feed.create.title")}</DialogTitle></DialogHeader>
        <div className="space-y-3">
          <Textarea value={content} onChange={e => setContent(e.target.value)} placeholder={t("feed.create.placeholder")} maxLength={5000} className="min-h-[120px]" />

          {files.length > 0 && (
            <div className="grid grid-cols-3 gap-2">
              {files.map((f, i) => {
                const url = URL.createObjectURL(f);
                const isVideo = f.type.startsWith("video/");
                return (
                  <div key={i} className="relative">
                    {isVideo ? (
                      <video src={url} muted playsInline className="w-full h-24 object-cover rounded bg-black" />
                    ) : (
                      <img src={url} alt="" className="w-full h-24 object-cover rounded" />
                    )}
                    <button onClick={() => setFiles(prev => prev.filter((_, idx) => idx !== i))} className="absolute top-1 right-1 w-5 h-5 bg-black/60 rounded-full flex items-center justify-center">
                      <X className="w-3 h-3 text-white" />
                    </button>
                  </div>
                );
              })}
            </div>
          )}

          <details className="rounded-lg border border-border p-3">
            <summary className="cursor-pointer text-sm font-semibold flex items-center gap-2"><Spade className="w-4 h-4 text-primary" /> {t("feed.create.addHand")}</summary>
            <div className="mt-3 space-y-2 text-sm">
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{t("feed.create.heroCards")}</div>
                <div className="flex gap-1.5">
                  {[0, 1].map((i) => (
                    <CardSlot
                      key={i}
                      value={heroCards[i]}
                      used={usedCards}
                      onChange={(c) => {
                        const nc = heroCards.slice(); nc[i] = c; setHeroCards(nc);
                      }}
                    />
                  ))}
                </div>
              </div>
              <div>
                <div className="text-xs text-muted-foreground mb-1.5">{t("feed.create.board")}</div>
                <div className="flex gap-1.5 items-center">
                  {[0, 1, 2].map((i) => (
                    <CardSlot key={i} value={boardCards[i]} used={usedCards} onChange={(c) => { const nc = boardCards.slice(); nc[i] = c; setBoardCards(nc); }} />
                  ))}
                  <div className="w-2 h-px bg-border" />
                  <CardSlot value={boardCards[3]} used={usedCards} onChange={(c) => { const nc = boardCards.slice(); nc[3] = c; setBoardCards(nc); }} />
                  <div className="w-2 h-px bg-border" />
                  <CardSlot value={boardCards[4]} used={usedCards} onChange={(c) => { const nc = boardCards.slice(); nc[4] = c; setBoardCards(nc); }} />
                </div>
              </div>
              <div className="flex gap-2">
                <input value={hand.game_type} onChange={e => setHand({...hand, game_type: e.target.value})} placeholder={t("feed.create.gamePlaceholder")} className="flex-1 bg-muted rounded px-3 py-2 outline-none" />
                <input type="number" value={hand.pot_size || ""} onChange={e => setHand({...hand, pot_size: Number(e.target.value)})} placeholder={t("feed.create.potPlaceholder")} className="w-32 bg-muted rounded px-3 py-2 outline-none" />
              </div>
              <div className="flex gap-2">
                <Button type="button" size="sm" variant={hand.result === "win" ? "default" : "outline"} onClick={() => setHand({...hand, result: hand.result === "win" ? "" : "win"})}>{t("feed.create.win")}</Button>
                <Button type="button" size="sm" variant={hand.result === "loss" ? "destructive" : "outline"} onClick={() => setHand({...hand, result: hand.result === "loss" ? "" : "loss"})}>{t("feed.create.loss")}</Button>
              </div>
            </div>
          </details>

          <div className="flex items-center justify-between pt-2 border-t border-border">
            <Button variant="ghost" size="sm" onClick={() => fileRef.current?.click()} disabled={posting}>
              <ImageIcon className="w-4 h-4" /> {t("feed.create.mediaBtn")}
            </Button>
            <input ref={fileRef} type="file" accept="image/*,video/mp4,video/webm,video/quicktime" multiple hidden onChange={e => setFiles([...files, ...Array.from(e.target.files ?? [])])} />
            <Button onClick={submit} disabled={posting}>{posting ? <Loader2 className="w-4 h-4 animate-spin" /> : t("feed.create.submit")}</Button>
          </div>
        </div>
      </DialogContent>
    </Dialog>
  );
}

function StoryViewer({ story, currentUserId, onClose }: { story: FeedStory; currentUserId: string; onClose: () => void }) {
  const { t } = useTranslation();
  const isMine = story.author_id === currentUserId;
  const [viewersOpen, setViewersOpen] = useState(false);
  const [viewsCount, setViewsCount] = useState(0);

  useEffect(() => {
    const t = setTimeout(onClose, story.media_type === "video" ? 15000 : 8000);
    return () => clearTimeout(t);
  }, [onClose, story.media_type]);

  useEffect(() => {
    if (!isMine) return;
    (async () => {
      const { count } = await supabase
        .from("feed_story_views")
        .select("*", { count: "exact", head: true })
        .eq("story_id", story.id);
      setViewsCount(count ?? 0);
    })();
  }, [isMine, story.id]);

  // Build sticker music from story fields
  const stickerMusic: StickerMusic | null = (() => {
    if (story.music_source === "soundcloud" && story.music_html && story.music_name) {
      return {
        source: "soundcloud",
        name: story.music_name,
        artist: story.music_artist,
        thumbnail_url: story.music_thumbnail_url,
        iframe_src: story.music_html,
        soundcloud_url: story.music_soundcloud_url,
      };
    }
    if (story.music_url && story.music_name) {
      return {
        source: "library",
        name: story.music_name,
        artist: story.music_artist,
        thumbnail_url: story.music_thumbnail_url,
        file_url: story.music_url,
      };
    }
    return null;
  })();

  const durationMs = story.media_type === "video" ? 15000 : 8000;

  return (
    <>
      <Dialog open onOpenChange={(v) => !v && onClose()}>
        <DialogContent
          className="p-0 border-0 bg-black w-screen h-[100dvh] max-w-none sm:w-auto sm:h-auto sm:max-w-[420px] sm:rounded-2xl overflow-hidden"
        >
          <div className="relative w-full h-full sm:aspect-[9/16] sm:h-auto bg-black flex items-center justify-center">
            {/* Top progress bar */}
            <div className="absolute top-2 left-2 right-2 z-20 h-[3px] bg-white/20 rounded-full overflow-hidden">
              <div
                className="h-full bg-white/90 rounded-full"
                style={{ animation: `storyProgress ${durationMs}ms linear forwards` }}
              />
            </div>

            {/* Header: avatar + name + time */}
            <div className="absolute top-5 left-3 right-12 flex items-center gap-2 z-20 pt-[env(safe-area-inset-top)]">
              <div className="w-8 h-8 rounded-full bg-muted overflow-hidden shrink-0 ring-2 ring-white/30">
                {story.author?.avatar_url && <img src={story.author.avatar_url} alt="" className="w-full h-full object-cover" />}
              </div>
              <span className="text-white text-sm font-semibold truncate drop-shadow">
                {story.author?.display_name ?? t("feed.anonymousPlayer")}
              </span>
              <span className="text-white/70 text-xs drop-shadow">
                {relTime(story.created_at, t)} {t("feed.ago")}
              </span>
            </div>

            {/* Media — full image visible */}
            {story.media_type === "video" ? (
              <video src={story.media_url} className="w-full h-full object-contain bg-black" autoPlay controls playsInline />
            ) : (
              <img src={story.media_url} alt="" className="w-full h-full object-contain bg-black" />
            )}

            {stickerMusic && <StoryMusicSticker music={stickerMusic} />}

            {story.caption && (
              <div className="absolute bottom-16 left-4 right-4 z-10 text-white text-sm bg-black/50 backdrop-blur-sm p-2.5 rounded-lg">
                {story.caption}
              </div>
            )}

            {isMine && (
              <button
                onClick={() => setViewersOpen(true)}
                className="absolute bottom-4 left-4 z-10 flex items-center gap-1.5 px-3 py-1.5 rounded-full bg-black/60 backdrop-blur-sm text-white text-xs"
              >
                <Eye className="w-3.5 h-3.5" /> {viewsCount}
              </button>
            )}
          </div>
        </DialogContent>
      </Dialog>

      {isMine && (
        <StoryViewersDialog open={viewersOpen} onOpenChange={setViewersOpen} storyId={story.id} />
      )}
    </>
  );
}
