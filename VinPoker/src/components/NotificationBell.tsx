import { useState, useEffect } from "react";
import { Bell } from "lucide-react";
import { useNavigate } from "react-router-dom";
import { useTranslation } from "react-i18next";
import { useNotifications, ICON_FOR, routeForNotification, timeAgo, NotificationRow } from "@/hooks/useNotifications";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { Button } from "@/components/ui/button";
import { ScrollArea } from "@/components/ui/scroll-area";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

export const NotificationBell = () => {
  const { t } = useTranslation();
  const { items, unreadCount, markRead, markAllRead } = useNotifications(15);
  const [open, setOpen] = useState(false);
  const nav = useNavigate();
  const [prevUnread, setPrevUnread] = useState(unreadCount);

  useEffect(() => {
    if (unreadCount > prevUnread && items[0] && !items[0].is_read) {
      toast(items[0].title, { description: items[0].body });
    }
    setPrevUnread(unreadCount);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [unreadCount]);

  const handleClick = async (n: NotificationRow) => {
    setOpen(false);
    if (!n.is_read) await markRead(n.id);
    nav(routeForNotification(n));
  };

  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          className="relative px-2.5 py-1.5 rounded-lg border border-border hover:border-primary/60 text-muted-foreground hover:text-primary inline-flex items-center gap-1.5 transition-colors"
          title={t("notifications.bellTitle")}
          aria-label={t("notifications.bellTitle")}
        >
          <Bell className="w-4 h-4" />
          {unreadCount > 0 && (
            <span className="absolute -top-1.5 -right-1.5 min-w-[18px] h-[18px] px-1 rounded-full bg-destructive text-destructive-foreground text-[10px] font-bold flex items-center justify-center">
              {unreadCount > 99 ? "99+" : unreadCount}
            </span>
          )}
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-[380px] p-0">
        <div className="flex items-center justify-between px-4 py-3 border-b border-border">
          <div className="font-semibold">{t("notifications.title")}</div>
          <button
            onClick={markAllRead}
            disabled={unreadCount === 0}
            className="text-xs text-primary hover:underline disabled:opacity-40 disabled:no-underline"
          >
            {t("notifications.markAllRead")}
          </button>
        </div>
        <ScrollArea className="max-h-[420px]">
          {items.length === 0 ? (
            <div className="px-4 py-12 text-center text-sm text-muted-foreground">
              {t("notifications.none")}
            </div>
          ) : (
            <ul>
              {items.map((n) => (
                <li
                  key={n.id}
                  onClick={() => handleClick(n)}
                  className={cn(
                    "px-4 py-3 border-b border-border/50 cursor-pointer hover:bg-muted/40 transition-colors flex gap-3",
                    !n.is_read && "bg-primary/5 border-l-2 border-l-primary",
                    n.is_read && "opacity-70",
                  )}
                >
                  <div className="text-xl leading-none shrink-0">{ICON_FOR[n.type]}</div>
                  <div className="flex-1 min-w-0">
                    <div className={cn("text-sm leading-tight", !n.is_read && "font-semibold")}>
                      {n.title}
                    </div>
                    <div className="text-xs text-muted-foreground mt-0.5 line-clamp-2">{n.body}</div>
                    <div className="text-[10px] text-muted-foreground mt-1">{timeAgo(n.created_at)}</div>
                  </div>
                </li>
              ))}
            </ul>
          )}
        </ScrollArea>
        <div className="px-4 py-2 border-t border-border text-center">
          <Button
            variant="ghost"
            size="sm"
            className="text-xs w-full"
            onClick={() => {
              setOpen(false);
              nav("/notifications");
            }}
          >
            {t("notifications.viewAll")}
          </Button>
        </div>
      </PopoverContent>
    </Popover>
  );
};
