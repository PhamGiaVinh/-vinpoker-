import { useEffect, useRef, useState } from "react";
import { useNavigate, useParams, useSearchParams } from "react-router-dom";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { toast } from "sonner";
import { ArrowLeft, Loader2, Send, X, CreditCard, ImagePlus, ArchiveRestore } from "lucide-react";
import { playNotifySound } from "@/lib/notifySound";
import { compressImage } from "@/lib/compressImage";

const BookingChat = () => {
  const { tournamentId } = useParams();
  const [params] = useSearchParams();
  const asReceptionistChatId = params.get("asReceptionist");
  const nav = useNavigate();
  const { user, loading: authLoading, isAdmin } = useAuth();
  const [chat, setChat] = useState<any>(null);
  const [tournament, setTournament] = useState<any>(null);
  const [club, setClub] = useState<any>(null);
  const [messages, setMessages] = useState<any[]>([]);
  const [profiles, setProfiles] = useState<Record<string, any>>({});
  const [text, setText] = useState("");
  const [loading, setLoading] = useState(true);
  const [sending, setSending] = useState(false);
  const [uploading, setUploading] = useState(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const isReceptionist = !!club && !!user && (club.owner_id === user.id || isAdmin) && chat?.player_id !== user.id;

  const setup = async () => {
    if (!tournamentId || !user) return;
    setLoading(true);
    const { data: t } = await supabase.from("tournaments")
      .select("*, club:clubs(id,name,owner_id,address,bot_enabled,bot_qr_url,bot_welcome_message)").eq("id", tournamentId).maybeSingle();
    if (!t) { toast.error("Tournament not found"); nav(-1); return; }
    setTournament(t);
    setClub(t.club);

    let existing: any = null;

    if (asReceptionistChatId) {
      // Receptionist opening a specific player's chat
      const { data } = await supabase.from("booking_chats").select("*")
        .eq("id", asReceptionistChatId).maybeSingle();
      existing = data;
    } else {
      const { data } = await supabase.from("booking_chats").select("*")
        .eq("tournament_id", tournamentId).eq("player_id", user.id).maybeSingle();
      existing = data;

      if (!existing && t.club?.owner_id !== user.id && !isAdmin) {
        const { data: created, error } = await supabase.from("booking_chats").insert({
          tournament_id: tournamentId, club_id: t.club.id, player_id: user.id,
        }).select("*").single();
        if (error) { toast.error("Cannot create chat: " + error.message); setLoading(false); return; }
        existing = created;
        await supabase.from("chat_messages").insert({
          chat_id: created.id, sender_id: null, kind: "system",
          content: `I'd like to book a stack for [${t.name}]`,
        });

        // Auto-send chatbot welcome (QR + message) if club has it enabled
        if (t.club?.bot_enabled) {
          const botMsgs: any[] = [];
          if (t.club?.bot_qr_url) {
            botMsgs.push({
              chat_id: created.id, sender_id: null, kind: "image", content: t.club.bot_qr_url,
            });
          }
          const welcome = (t.club?.bot_welcome_message ?? "").trim();
          if (welcome) {
            botMsgs.push({
              chat_id: created.id, sender_id: null, kind: "text", content: welcome,
            });
          }
          if (botMsgs.length) {
            await supabase.from("chat_messages").insert(botMsgs);
          }
        }
      }
    }

    if (!existing) { toast.error("Chat not found"); setLoading(false); return; }
    setChat(existing);
    await loadMessages(existing.id);
    // Mark as read on open
    await markRead(existing);
    // Load player profile for receptionist view
    if (existing.player_id) {
      const { data: prof } = await supabase.from("profiles").select("user_id, display_name, phone").eq("user_id", existing.player_id).maybeSingle();
      if (prof) setProfiles(prev => ({ ...prev, [prof.user_id]: prof }));
    }
    setLoading(false);
  };

  const loadMessages = async (chatId: string) => {
    const { data: msgs } = await supabase.from("chat_messages").select("*")
      .eq("chat_id", chatId).order("created_at", { ascending: true });
    setMessages(msgs ?? []);
    const ids = Array.from(new Set((msgs ?? []).map((m: any) => m.sender_id).filter(Boolean)));
    if (ids.length) {
      const { data: profs } = await supabase.from("profiles").select("user_id, display_name").in("user_id", ids as string[]);
      setProfiles(prev => ({ ...prev, ...Object.fromEntries((profs ?? []).map((p: any) => [p.user_id, p])) }));
    }
  };

  useEffect(() => { if (!authLoading) setup(); }, [tournamentId, user?.id, authLoading, asReceptionistChatId]);

  const markRead = async (c: any) => {
    if (!c || !user) return;
    const isPlayer = c.player_id === user.id;
    const payload: any = isPlayer
      ? { player_last_read_at: new Date().toISOString() }
      : { club_last_read_at: new Date().toISOString() };
    await supabase.from("booking_chats").update(payload).eq("id", c.id);
    setChat((prev: any) => prev ? { ...prev, ...payload } : prev);
  };

  useEffect(() => {
    if (!chat?.id) return;
    const ch = supabase.channel(`chat-${chat.id}`)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages", filter: `chat_id=eq.${chat.id}` },
        (payload) => {
          setMessages(prev => [...prev, payload.new]);
          // Play sound + mark read for messages from the other party
          if (payload.new.sender_id !== user?.id) {
            playNotifySound();
            if (document.visibilityState === "visible") markRead(chat);
          }
        })
      .on("postgres_changes", { event: "UPDATE", schema: "public", table: "booking_chats", filter: `id=eq.${chat.id}` },
        (payload) => setChat((prev: any) => ({ ...prev, ...payload.new })))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [chat?.id]);

  useEffect(() => { scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const send = async () => {
    if (!text.trim() || !chat) return;
    setSending(true);
    const { error } = await supabase.from("chat_messages").insert({
      chat_id: chat.id, sender_id: user!.id, content: text.trim(), kind: "text",
    });
    setSending(false);
    if (error) toast.error(error.message); else setText("");
  };

  const handleImageUpload = async (raw: File) => {
    if (!chat || !user) return;
    if (!raw.type.startsWith("image/")) { toast.error("Images only"); return; }
    if (raw.size > 10 * 1024 * 1024) { toast.error("Max image size is 10MB"); return; }
    setUploading(true);
    const file = await compressImage(raw, { maxEdge: 1600, quality: 0.8 });
    const ext = file.type === "image/png" ? "png" : "jpg";
    const path = `${user.id}/${chat.id}/${Date.now()}.${ext}`;
    const { error: upErr } = await supabase.storage.from("chat-uploads").upload(path, file, { upsert: false, contentType: file.type });
    if (upErr) { toast.error(upErr.message); setUploading(false); return; }
    const { data: pub } = supabase.storage.from("chat-uploads").getPublicUrl(path);
    const { error: msgErr } = await supabase.from("chat_messages").insert({
      chat_id: chat.id, sender_id: user.id, content: pub.publicUrl, kind: "image",
    });
    setUploading(false);
    if (msgErr) toast.error(msgErr.message);
    if (fileRef.current) fileRef.current.value = "";
  };

  const incrementPlayers = async () => {
    if (!tournament) return;
    const { data: fresh } = await supabase.from("tournaments").select("current_players").eq("id", tournament.id).maybeSingle();
    const cur = fresh?.current_players ?? tournament.current_players ?? 0;
    await supabase.from("tournaments").update({ current_players: cur + 1 }).eq("id", tournament.id);
    setTournament({ ...tournament, current_players: cur + 1 });
  };

  const approve = async () => {
    if (!chat || !tournament) return;
    const { data: existingReg } = await supabase.from("stack_registrations").select("*")
      .eq("user_id", chat.player_id).eq("tournament_id", chat.tournament_id).maybeSingle();
    let wasConfirmed = existingReg?.status === "confirmed";
    if (existingReg) {
      await supabase.from("stack_registrations").update({ status: "confirmed" }).eq("id", existingReg.id);
    } else {
      const { error: insErr } = await supabase.from("stack_registrations").insert({
        user_id: chat.player_id, tournament_id: chat.tournament_id, status: "confirmed",
      });
      if (insErr) { toast.error(insErr.message); return; }
    }
    if (!wasConfirmed) await incrementPlayers();
    await supabase.from("booking_chats").update({ status: "closed", closed_by: user?.id ?? null, closed_at: new Date().toISOString() } as any).eq("id", chat.id);
    await supabase.from("chat_messages").insert({
      chat_id: chat.id, sender_id: null, kind: "system",
      content: "✅ Reception confirmed your booking. You have been added to the tournament.",
    });
    toast.success("Player confirmed and added");
  };

  const reject = async () => {
    if (!chat) return;
    const { data: existingReg } = await supabase.from("stack_registrations").select("*")
      .eq("user_id", chat.player_id).eq("tournament_id", chat.tournament_id).maybeSingle();
    if (existingReg) {
      await supabase.from("stack_registrations").update({ status: "rejected" }).eq("id", existingReg.id);
    }
    await supabase.from("booking_chats").update({ status: "closed", closed_by: user?.id ?? null, closed_at: new Date().toISOString() } as any).eq("id", chat.id);
    await supabase.from("chat_messages").insert({
      chat_id: chat.id, sender_id: null, kind: "system",
      content: "❌ Reception declined this stack booking request.",
    });
    toast("Request declined");
  };

  const confirmPayment = async () => {
    if (!chat || !tournament) return;
    // Auto-confirm registration first, then mark payment so the confirmed list never misses the player.
    const { data: existingReg } = await supabase.from("stack_registrations").select("*")
      .eq("user_id", chat.player_id).eq("tournament_id", chat.tournament_id).maybeSingle();
    const wasConfirmed = existingReg?.status === "confirmed";
    if (chat.payment_confirmed && wasConfirmed) return toast.success("Payment already confirmed");
    if (existingReg) {
      if (!wasConfirmed) {
        const { error } = await supabase.from("stack_registrations").update({ status: "confirmed" }).eq("id", existingReg.id);
        if (error) return toast.error(error.message);
        await incrementPlayers();
      }
    } else {
      const { error } = await supabase.from("stack_registrations").insert({
        user_id: chat.player_id, tournament_id: chat.tournament_id, status: "confirmed",
      });
      if (error) return toast.error(error.message);
      await incrementPlayers();
    }
    if (!chat.payment_confirmed) {
      const { error: payErr } = await supabase.from("booking_chats").update({ payment_confirmed: true }).eq("id", chat.id);
      if (payErr) return toast.error(payErr.message);
    }
    await supabase.from("chat_messages").insert({
      chat_id: chat.id, sender_id: null, kind: "system",
      content: "💰 Reception confirmed payment. Buy-in is complete and the player was added.",
    });
    toast.success("Payment confirmed and player added");
  };

  if (authLoading || loading) return <div className="flex justify-center py-20"><Loader2 className="w-6 h-6 animate-spin text-primary" /></div>;
  if (!user) { nav("/auth"); return null; }

  const playerName = profiles[chat?.player_id]?.display_name ?? "Player";
  const playerPhone = profiles[chat?.player_id]?.phone;

  return (
    <div className="flex flex-col h-[calc(100vh-9rem)]">
      <button onClick={() => nav(-1)} className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground mb-2">
        <ArrowLeft className="w-4 h-4" /> Back
      </button>

      <Card className="p-3 gradient-card border-primary/30 mb-2">
        <div className="text-xs text-muted-foreground">
          {isReceptionist ? `Receptionist · ${club?.name}` : `Stack booking chat · ${club?.name}`}
        </div>
        <div className="font-display text-lg">{tournament?.name}</div>
        {isReceptionist && (
          <div className="text-xs text-muted-foreground mt-0.5">Player: <span className="text-foreground font-medium">{playerName}</span>{playerPhone && ` · ${playerPhone}`}</div>
        )}
        <div className="text-xs text-muted-foreground mt-0.5">
          Status: <span className={chat?.status === "closed" ? "text-muted-foreground" : "text-primary"}>{chat?.status === "closed" ? "Closed" : "Active"}</span>
          {chat?.payment_confirmed && <span className="ml-2 text-success">· Paid ✓</span>}
        </div>
        {chat?.archived_at && (
          <div className="mt-2 flex items-center justify-between gap-2 text-xs bg-muted/40 border border-dashed rounded-md px-2 py-1.5">
            <span className="text-muted-foreground">📦 Cuộc trò chuyện này đã được tự động lưu trữ.</span>
            {(isReceptionist || isAdmin) && (
              <Button
                size="sm"
                variant="ghost"
                className="h-6 px-2 text-[10px]"
                onClick={async () => {
                  const { error } = await supabase.from("booking_chats").update({ archived_at: null }).eq("id", chat.id);
                  if (error) toast.error(error.message);
                  else { setChat({ ...chat, archived_at: null }); toast.success("Đã bỏ lưu trữ"); }
                }}
              >
                <ArchiveRestore className="w-3 h-3 mr-1" /> Bỏ lưu trữ
              </Button>
            )}
          </div>
        )}
      </Card>

      <div ref={scrollRef} className="flex-1 overflow-y-auto space-y-2 px-1">
        {messages.map(m => {
          if (m.kind === "system") {
            return (
              <div key={m.id} className="text-center text-xs text-muted-foreground italic py-1">
                {m.content}
              </div>
            );
          }
          const isBot = !m.sender_id;
          const mine = !isBot && m.sender_id === user.id;
          const name = isBot ? "🤖 Trợ lý CLB" : (profiles[m.sender_id]?.display_name ?? "User");
          return (
            <div key={m.id} className={`flex ${mine ? "justify-end" : "justify-start"}`}>
              <div className={`max-w-[75%] rounded-2xl px-3 py-2 text-sm ${mine ? "bg-primary text-primary-foreground" : isBot ? "bg-muted/60 border border-primary/20 text-foreground" : "bg-muted text-foreground"}`}>
                {!mine && <div className={`text-[10px] mb-0.5 ${isBot ? "text-primary font-medium" : "opacity-70"}`}>{name}</div>}
                {m.kind === "image" ? (
                  <a href={m.content} target="_blank" rel="noopener noreferrer">
                    <img src={m.content} alt="Chat attachment" className="rounded-lg max-h-64 object-cover" loading="lazy" />
                  </a>
                ) : (
                  <div className="whitespace-pre-wrap break-words">{m.content}</div>
                )}
              </div>
            </div>
          );
        })}
      </div>

      {isReceptionist && chat?.status !== "closed" && (
        <div className="grid grid-cols-2 gap-2 mt-2">
          <Button
            size="sm"
            className="bg-success text-success-foreground hover:bg-success/90"
            onClick={confirmPayment}
          >
            <CreditCard className="w-4 h-4 mr-1" />
            {chat?.payment_confirmed ? "Sync Paid Registration" : "Confirm Payment & Buy-in"}
          </Button>
          <Button
            size="sm"
            variant="outline"
            className="border-destructive/40 text-destructive hover:bg-destructive/10"
            onClick={reject}
          >
            <X className="w-4 h-4 mr-1" />Reject
          </Button>
        </div>
      )}

      <div className="flex gap-2 mt-2">
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => e.target.files?.[0] && handleImageUpload(e.target.files[0])}
        />
        <Button
          variant="outline"
          size="icon"
          onClick={() => fileRef.current?.click()}
          disabled={uploading || chat?.status === "closed"}
          title="Send / capture photo"
        >
          {uploading ? <Loader2 className="w-4 h-4 animate-spin" /> : <ImagePlus className="w-4 h-4" />}
        </Button>
        <Input value={text} onChange={e => setText(e.target.value)} onKeyDown={e => e.key === "Enter" && send()}
          placeholder={chat?.status === "closed" ? "Conversation closed" : "Type a message..."}
          disabled={chat?.status === "closed" || sending} />
        <Button onClick={send} disabled={sending || !text.trim() || chat?.status === "closed"}>
          <Send className="w-4 h-4" />
        </Button>
      </div>
    </div>
  );
};

export default BookingChat;
