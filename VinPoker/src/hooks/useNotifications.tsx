import { useEffect, useState, useCallback } from "react";
import { supabase } from "@/integrations/supabase/client";
import { useAuth } from "@/hooks/useAuth";
import { playAlertSound } from "@/lib/notifySound";

export type NotificationType =
  | "deal_committed"
  | "deal_funded"
  | "deal_auto_cancelled"
  | "deal_auto_closed"
  | "deal_expiring_soon"
  | "result_entered"
  | "result_verified"
  | "result_disputed"
  | "release_requested"
  | "payout_executed"
  | "system_announcement";

export interface NotificationRow {
  id: string;
  user_id: string;
  type: NotificationType;
  title: string;
  body: string;
  data: Record<string, any>;
  is_read: boolean;
  created_at: string;
}

const ROUTE_FOR: Record<NotificationType, (data: any) => string> = {
  deal_committed: () => "/staking/my-deals",
  deal_funded: () => "/staking/my-deals",
  deal_auto_cancelled: () => "/staking/my-deals",
  deal_auto_closed: () => "/staking/my-deals",
  deal_expiring_soon: () => "/staking/portfolio",
  result_entered: () => "/admin/staking",
  result_verified: () => "/staking/portfolio",
  result_disputed: () => "/staking/my-deals",
  release_requested: () => "/staking/portfolio",
  payout_executed: () => "/staking/portfolio",
  system_announcement: () => "/",
};

export const ICON_FOR: Record<NotificationType, string> = {
  deal_committed: "🤝",
  deal_funded: "💰",
  deal_auto_cancelled: "⏰",
  deal_auto_closed: "🚪",
  deal_expiring_soon: "⏳",
  result_entered: "📝",
  result_verified: "✅",
  result_disputed: "⚠️",
  release_requested: "🔐",
  payout_executed: "🎉",
  system_announcement: "📣",
};

export function routeForNotification(n: Pick<NotificationRow, "type" | "data">) {
  return ROUTE_FOR[n.type]?.(n.data) ?? "/";
}

export function useNotifications(limit = 20) {
  const { user } = useAuth();
  const [items, setItems] = useState<NotificationRow[]>([]);
  const [unreadCount, setUnreadCount] = useState(0);
  const [loading, setLoading] = useState(false);

  const fetchAll = useCallback(async () => {
    if (!user) {
      setItems([]);
      setUnreadCount(0);
      return;
    }
    setLoading(true);
    const [list, count] = await Promise.all([
      supabase
        .from("notifications")
        .select("*")
        .eq("user_id", user.id)
        .order("created_at", { ascending: false })
        .limit(limit),
      supabase
        .from("notifications")
        .select("id", { count: "exact", head: true })
        .eq("user_id", user.id)
        .eq("is_read", false),
    ]);
    setItems((list.data ?? []) as NotificationRow[]);
    setUnreadCount(count.count ?? 0);
    setLoading(false);
  }, [user, limit]);

  useEffect(() => {
    fetchAll();
  }, [fetchAll]);

  useEffect(() => {
    if (!user) return;
    const ch = supabase
      .channel(`notifications:${user.id}`)
      .on(
        "postgres_changes",
        { event: "INSERT", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => { playAlertSound(); fetchAll(); },
      )
      .on(
        "postgres_changes",
        { event: "UPDATE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => fetchAll(),
      )
      .on(
        "postgres_changes",
        { event: "DELETE", schema: "public", table: "notifications", filter: `user_id=eq.${user.id}` },
        () => fetchAll(),
      )
      .subscribe();
    return () => {
      supabase.removeChannel(ch);
    };
  }, [user, fetchAll]);

  const markRead = useCallback(async (id: string) => {
    if (!user) return;
    await supabase.from("notifications").update({ is_read: true }).eq("id", id).eq("user_id", user.id);
    setItems((p) => p.map((n) => (n.id === id ? { ...n, is_read: true } : n)));
    setUnreadCount((c) => Math.max(0, c - 1));
  }, [user]);

  const markAllRead = useCallback(async () => {
    if (!user) return;
    await supabase
      .from("notifications")
      .update({ is_read: true })
      .eq("user_id", user.id)
      .eq("is_read", false);
    setItems((p) => p.map((n) => ({ ...n, is_read: true })));
    setUnreadCount(0);
  }, [user]);

  return { items, unreadCount, loading, markRead, markAllRead, refresh: fetchAll };
}

export function timeAgo(iso: string) {
  const sec = Math.max(1, Math.floor((Date.now() - new Date(iso).getTime()) / 1000));
  if (sec < 60) return `${sec} giây trước`;
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} phút trước`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} giờ trước`;
  const d = Math.floor(hr / 24);
  if (d < 7) return `${d} ngày trước`;
  return new Date(iso).toLocaleDateString("vi-VN");
}
