import { useEffect, useRef, useState } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { playNotifySound } from "@/lib/notifySound";

/**
 * Returns total unread message count across ALL chats the user can see.
 */
export const useUnreadChats = () => {
  const { user } = useAuth();
  const [count, setCount] = useState(0);
  const [perChat, setPerChat] = useState<Record<string, number>>({});
  const prevTotal = useRef(0);
  const initialized = useRef(false);

  const compute = async (opts?: { silent?: boolean }) => {
    if (!user) { setCount(0); setPerChat({}); return; }
    // Exclude archived chats from unread badge
    const { data: chats } = await supabase.from("booking_chats").select("*").is("archived_at", null);
    if (!chats?.length) { setCount(0); setPerChat({}); return; }

    const { data: msgs } = await supabase
      .from("chat_messages")
      .select("chat_id, sender_id, created_at, kind")
      .in("chat_id", chats.map((c) => c.id));

    const counts: Record<string, number> = {};
    let total = 0;
    for (const c of chats) {
      const isPlayer = c.player_id === user.id;
      const lastRead = isPlayer ? c.player_last_read_at : c.club_last_read_at;
      const cutoff = lastRead ? new Date(lastRead).getTime() : 0;
      const n = (msgs ?? []).filter((m: any) =>
        m.chat_id === c.id &&
        m.sender_id !== user.id &&
        new Date(m.created_at).getTime() > cutoff
      ).length;
      if (n > 0) counts[c.id] = n;
      total += n;
    }
    setPerChat(counts);
    setCount(total);

    // Beep when count goes up (skip initial load)
    if (initialized.current && !opts?.silent && total > prevTotal.current) {
      playNotifySound();
    }
    prevTotal.current = total;
    initialized.current = true;
  };

  useEffect(() => {
    if (!user) return;
    compute({ silent: true });
    const channelName = `unread-${user.id}-${Math.random().toString(36).slice(2, 8)}`;
    const ch = supabase.channel(channelName)
      .on("postgres_changes", { event: "INSERT", schema: "public", table: "chat_messages" }, () => compute())
      .on("postgres_changes", { event: "*", schema: "public", table: "booking_chats" }, () => compute({ silent: true }))
      .subscribe();
    return () => { supabase.removeChannel(ch); };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [user?.id]);

  return { count, perChat, refresh: compute };
};
