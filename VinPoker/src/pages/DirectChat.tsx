import { useEffect, useRef, useState } from "react";
import { Navigate, useNavigate, useParams } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Loader2, Send, ArrowLeft, MessageCircle, ImagePlus, X } from "lucide-react";
import { toast } from "sonner";

interface Message {
  id: string;
  sender_id: string;
  content: string;
  kind: string;
  created_at: string;
}

const DirectChat = () => {
  const { t, i18n } = useTranslation();
  const { userId: otherId } = useParams<{ userId: string }>();
  const { user, loading: authLoading } = useAuth();
  const nav = useNavigate();
  const [chatId, setChatId] = useState<string | null>(null);
  const [other, setOther] = useState<{ display_name: string; avatar_url?: string | null } | null>(null);
  const [msgs, setMsgs] = useState<Message[]>([]);
  const [text, setText] = useState("");
  const [busy, setBusy] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const fileRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (authLoading) return;
    if (!user || !otherId || user.id === otherId) { setBusy(false); return; }
    (async () => {
      const { data: prof } = await supabase
        .from("profiles")
        .select("display_name, avatar_url")
        .eq("user_id", otherId)
        .maybeSingle();
      if (!prof) { toast.error(t("directChat.userNotFound")); nav("/inbox"); return; }
      setOther(prof);

      const [a, b] = [user.id, otherId].sort();
      let { data: existing } = await supabase
        .from("direct_chats")
        .select("id")
        .eq("user_a", a)
        .eq("user_b", b)
        .maybeSingle();
      if (!existing) {
        const { data: created, error } = await supabase
          .from("direct_chats")
          .insert({ user_a: a, user_b: b })
          .select("id")
          .single();
        if (error) { toast.error(error.message); setBusy(false); return; }
        existing = created;
      }
      setChatId(existing!.id);

      const { data: m } = await supabase
        .from("direct_messages")
        .select("*")
        .eq("chat_id", existing!.id)
        .order("created_at", { ascending: true })
        .limit(500);
      setMsgs((m ?? []) as Message[]);
      setBusy(false);

      const isA = user.id === a;
      await supabase.from("direct_chats")
        .update(isA ? { user_a_last_read_at: new Date().toISOString() } : { user_b_last_read_at: new Date().toISOString() })
        .eq("id", existing!.id);
    })();
  }, [user, authLoading, otherId, nav, t]);

  useEffect(() => {
    if (!chatId) return;
    const ch = supabase
      .channel(`dm:${chatId}`)
      .on("postgres_changes",
        { event: "INSERT", schema: "public", table: "direct_messages", filter: `chat_id=eq.${chatId}` },
        (payload) => {
          setMsgs((prev) => [...prev, payload.new as Message]);
        })
      .subscribe();
    return () => { supabase.removeChannel(ch); };
  }, [chatId]);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [msgs.length]);

  const send = async () => {
    const content = text.trim();
    if (!content || !chatId || !user) return;
    if (content.length > 2000) return toast.error(t("directChat.msgMax"));
    setSending(true);
    const { error } = await supabase
      .from("direct_messages")
      .insert({ chat_id: chatId, sender_id: user.id, kind: "text", content });
    setSending(false);
    if (error) toast.error(error.message); else setText("");
  };

  const onPickImage = async (e: React.ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = "";
    if (!file || !chatId || !user) return;
    if (!file.type.startsWith("image/")) return toast.error(t("directChat.imgOnly"));
    if (file.size > 8 * 1024 * 1024) return toast.error(t("directChat.max8"));
    setUploading(true);
    try {
      const ext = file.name.split(".").pop()?.toLowerCase() || "jpg";
      const path = `dm/${chatId}/${user.id}/${Date.now()}.${ext}`;
      const { error: upErr } = await supabase.storage.from("chat-uploads").upload(path, file, {
        cacheControl: "3600", upsert: false, contentType: file.type,
      });
      if (upErr) throw upErr;
      const { data: pub } = supabase.storage.from("chat-uploads").getPublicUrl(path);
      const { error } = await supabase
        .from("direct_messages")
        .insert({ chat_id: chatId, sender_id: user.id, kind: "image", content: pub.publicUrl });
      if (error) throw error;
    } catch (err: any) {
      toast.error(err.message || t("directChat.uploadFail"));
    } finally {
      setUploading(false);
    }
  };

  if (authLoading || busy) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) return <Navigate to="/auth" replace />;
  if (!otherId || user.id === otherId) return <Navigate to="/inbox" replace />;

  const timeLocale = i18n.language?.startsWith("zh") ? "zh-CN" : i18n.language?.startsWith("en") ? "en-US" : "vi-VN";

  return (
    <div className="max-w-2xl mx-auto flex flex-col h-[calc(100vh-12rem)]">
      <div className="flex items-center gap-3 pb-3 border-b border-border">
        <Button variant="ghost" size="icon" onClick={() => nav("/inbox")}>
          <ArrowLeft className="w-5 h-5" />
        </Button>
        {other?.avatar_url ? (
          <img src={other.avatar_url} alt={other.display_name} className="w-10 h-10 rounded-full object-cover" />
        ) : (
          <div className="w-10 h-10 rounded-full bg-muted flex items-center justify-center">
            <MessageCircle className="w-5 h-5 text-muted-foreground" />
          </div>
        )}
        <div>
          <div className="font-semibold">{other?.display_name ?? t("directChat.defaultUser")}</div>
          <div className="text-[11px] text-muted-foreground">{t("directChat.directLabel")}</div>
        </div>
      </div>

      <div ref={scrollRef} className="flex-1 overflow-y-auto py-4 space-y-2">
        {msgs.length === 0 ? (
          <div className="text-center text-sm text-muted-foreground py-10">{t("directChat.noMessages")}</div>
        ) : msgs.map((m) => {
          const mine = m.sender_id === user.id;
          const isImage = m.kind === "image";
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl ${isImage ? "p-1" : "px-3.5 py-2"} text-sm ${mine ? "bg-primary text-primary-foreground" : "bg-card border border-border"}`}>
                {isImage ? (
                  <a href={m.content} target="_blank" rel="noreferrer">
                    <img src={m.content} alt={t("directChat.noMsgImg")} className="rounded-xl max-h-64 object-cover" loading="lazy" />
                  </a>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                )}
                <div className={`text-[10px] mt-1 ${isImage ? "px-2 pb-1" : ""} ${mine ? "text-primary-foreground/70" : "text-muted-foreground"}`}>
                  {new Date(m.created_at).toLocaleTimeString(timeLocale, { hour: "2-digit", minute: "2-digit" })}
                </div>
              </div>
            </div>
          );
        })}
      </div>

      <div className="flex gap-2 pt-3 border-t border-border">
        <input ref={fileRef} type="file" accept="image/*" className="hidden" onChange={onPickImage} />
        <Button
          variant="outline"
          size="icon"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || sending}
          title={t("directChat.sendImg")}
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        </Button>
        <Input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); send(); } }}
          placeholder={t("directChat.typeMsg")}
          maxLength={2000}
          disabled={sending || uploading}
        />
        <Button onClick={send} disabled={!text.trim() || sending} className="gradient-neon text-primary-foreground border-0">
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default DirectChat;
