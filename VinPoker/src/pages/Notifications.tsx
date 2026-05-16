import { useState } from "react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useNotifications, ICON_FOR, routeForNotification, timeAgo } from "@/hooks/useNotifications";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";

export default function Notifications() {
  const { t } = useTranslation();
  const { items, unreadCount, markRead, markAllRead } = useNotifications(100);
  const [tab, setTab] = useState<"all" | "unread">("all");
  const nav = useNavigate();

  const list = tab === "unread" ? items.filter((n) => !n.is_read) : items;

  return (
    <div className="max-w-3xl mx-auto">
      <div className="flex items-center justify-between mb-6">
        <h1 className="text-2xl font-bold">{t("notifications.title")}</h1>
        <Button variant="outline" size="sm" onClick={markAllRead} disabled={unreadCount === 0}>
          {t("notifications.markAllRead")}
        </Button>
      </div>

      <Tabs value={tab} onValueChange={(v) => setTab(v as any)}>
        <TabsList>
          <TabsTrigger value="all">{t("notifications.tabAll", { n: items.length })}</TabsTrigger>
          <TabsTrigger value="unread">{t("notifications.tabUnread", { n: unreadCount })}</TabsTrigger>
        </TabsList>
        <TabsContent value={tab} className="mt-4">
          {list.length === 0 ? (
            <div className="py-16 text-center text-muted-foreground">{t("notifications.empty")}</div>
          ) : (
            <ul className="border border-border rounded-lg overflow-hidden">
              {list.map((n) => (
                <li
                  key={n.id}
                  onClick={async () => {
                    if (!n.is_read) await markRead(n.id);
                    nav(routeForNotification(n));
                  }}
                  className={cn(
                    "px-4 py-3 border-b border-border/50 last:border-b-0 cursor-pointer hover:bg-muted/40 flex gap-3",
                    !n.is_read && "bg-primary/5 border-l-2 border-l-primary",
                    n.is_read && "opacity-70",
                  )}
                >
                  <div className="text-2xl leading-none shrink-0">{ICON_FOR[n.type]}</div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-sm", !n.is_read && "font-semibold")}>{n.title}</div>
                    <div className="text-xs text-muted-foreground mt-0.5">{n.body}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </TabsContent>
      </Tabs>
    </div>
  );
}
