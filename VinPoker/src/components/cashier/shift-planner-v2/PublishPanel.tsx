import { CheckCircle2, Circle, Loader2, Image as ImageIcon, Send, MessageCircle, Copy } from "lucide-react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import type { DealerLinkStatus } from "@/hooks/useDealerLinkStatus";
import type { DraftAssignment } from "@/types/shiftPlanner";

export type PublishStage = "idle" | "saving" | "publishing" | "telegram" | "done" | "telegram_failed";

export interface DealerNotifyRow {
  dealerId: string;
  name: string;
  shiftLabel: string;
  telegramLinked: boolean | null; // null = unknown (mock/no data)
  appLinked: boolean | null;
  dm: "sent" | "skipped" | null; // null = not sent yet
  /** Persisted assignment status for confirm chips (published/confirmed/checked_in/closed). */
  status: string | null;
  /** Dealer is pinned "chia final" for this day (from run params). */
  finalDesignated?: boolean;
}

const CONFIRM_LABEL: Record<string, { label: string; cls: string }> = {
  published: { label: "🕐 chờ xác nhận", cls: "text-muted-foreground" },
  confirmed: { label: "✅ đã xác nhận", cls: "text-success" },
  checked_in: { label: "🟢 đã vào ca", cls: "text-primary" },
  closed: { label: "✔ đã đóng ca", cls: "text-muted-foreground" },
};

/**
 * V2 Step 4 — "Phát hành & báo dealer": ONE action = save + publish (lock) +
 * Telegram (group photo + per-dealer DM) + the dealer app (published shifts
 * appear there + bell). Shows a 3-stage progress, per-step retry for Telegram
 * (publish is never re-run), then the per-dealer "đã nhận chưa?" list with an
 * unlinked-Telegram nudge. Also hosts the day/week image exports.
 */
export function PublishPanel({
  assignments,
  publishedAt,
  stage,
  rows,
  botUsername,
  onRetryTelegram,
  onExportDay,
  onExportWeek,
  onSendWeekTelegram,
  exporting,
}: {
  assignments: DraftAssignment[];
  /** ISO publish time when the date is already published (read-only view). */
  publishedAt: string | null;
  stage: PublishStage;
  rows: DealerNotifyRow[];
  /** For the "Nhắc liên kết" copy-link affordance (t.me deep link). */
  botUsername: string | null;
  onRetryTelegram: () => void;
  onExportDay: () => void;
  onExportWeek: () => void;
  onSendWeekTelegram: () => void;
  exporting: boolean;
}) {
  const published = publishedAt != null || stage === "done" || stage === "telegram_failed";

  const stageRow = (key: PublishStage, label: string, order: number) => {
    const active =
      (stage === "saving" && order === 1) ||
      (stage === "publishing" && order === 2) ||
      (stage === "telegram" && order === 3);
    const done =
      (order === 1 && ["publishing", "telegram", "done", "telegram_failed"].includes(stage)) ||
      (order === 2 && ["telegram", "done", "telegram_failed"].includes(stage)) ||
      (order === 3 && stage === "done");
    const failed = order === 3 && stage === "telegram_failed";
    return (
      <div key={key} className="flex items-center gap-2 py-1 text-[13px]">
        {active ? (
          <Loader2 className="h-4 w-4 animate-spin text-primary" />
        ) : done ? (
          <CheckCircle2 className="h-4 w-4 text-success" />
        ) : failed ? (
          <Circle className="h-4 w-4 text-destructive" />
        ) : (
          <Circle className="h-4 w-4 text-muted-foreground/40" />
        )}
        <span className={cn(done ? "text-foreground" : failed ? "text-destructive" : active ? "text-foreground" : "text-muted-foreground")}>
          {label}
          {failed ? " — lỗi" : ""}
        </span>
        {failed && (
          <Button size="sm" variant="outline" className="ml-auto h-6 px-2 text-[11px]" onClick={onRetryTelegram}>
            Gửi lại Telegram
          </Button>
        )}
      </div>
    );
  };

  const copyBotLink = () => {
    const url = botUsername ? `https://t.me/${botUsername}` : "https://t.me";
    void navigator.clipboard?.writeText(`${url} — mở bot và nhắn /setup để nhận lịch qua Telegram`);
    toast.success("Đã copy hướng dẫn liên kết — gửi cho dealer");
  };

  return (
    <div className="space-y-3">
      {/* What one tap does / progress */}
      <Card className="p-4">
        {stage === "idle" && !published ? (
          <>
            <div className="text-sm font-semibold">Phát hành sẽ làm gì?</div>
            <ul className="mt-1.5 space-y-1 text-[12.5px] text-muted-foreground">
              <li>1. Lưu lịch ({assignments.length} ca) và <b className="text-foreground">khoá</b> ngày này</li>
              <li>2. Gửi ảnh lịch lên <b className="text-foreground">nhóm Telegram</b> + <b className="text-foreground">DM riêng từng dealer</b></li>
              <li>3. Lịch hiện ngay trong <b className="text-foreground">app dealer</b> (kèm chuông thông báo)</li>
            </ul>
            <p className="mt-2 text-[11px] text-muted-foreground">
              Bấm nút <b className="text-foreground">📣 Phát hành & báo dealer</b> ở thanh trên để chạy cả 3 bước.
            </p>
          </>
        ) : (
          <>
            <div className="mb-1 text-sm font-semibold">
              {published && stage !== "telegram_failed" && stage !== "saving" && stage !== "publishing" && stage !== "telegram"
                ? `✅ Đã phát hành${publishedAt ? ` lúc ${new Date(publishedAt).toLocaleTimeString("vi-VN", { hour: "2-digit", minute: "2-digit", timeZone: "Asia/Ho_Chi_Minh" })}` : ""} — lịch đã khoá`
                : "Đang phát hành & báo dealer…"}
            </div>
            {stageRow("saving", "Lưu lịch", 1)}
            {stageRow("publishing", "Phát hành (khoá lịch ngày này)", 2)}
            {stageRow("telegram", "Gửi Telegram (nhóm + DM) + báo app", 3)}
            {published && (
              <p className="mt-1.5 text-[11px] text-muted-foreground">
                Muốn sửa lịch đã phát hành? Tính năng đang được bổ sung — hiện lịch đã khoá để chấm công.
              </p>
            )}
          </>
        )}
      </Card>

      {/* Per-dealer delivery/confirm list */}
      {rows.length > 0 && (
        <Card className="p-4">
          <div className="mb-2 flex items-center justify-between gap-2">
            <div className="text-sm font-semibold">Từng dealer đã nhận chưa?</div>
            <button
              type="button"
              onClick={copyBotLink}
              className="inline-flex items-center gap-1 rounded-md border border-border px-2 py-1 text-[11px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <Copy className="h-3 w-3" /> Nhắc liên kết Telegram
            </button>
          </div>
          <div className="divide-y divide-border rounded-lg border border-border">
            {rows.map((r) => {
              const confirm = r.status ? CONFIRM_LABEL[r.status] ?? null : null;
              return (
                <div key={r.dealerId} className="flex items-center gap-2 px-3 py-2 text-[12.5px]">
                  <span className="min-w-0 flex-1 truncate font-semibold">{r.name}</span>
                  {r.finalDesignated && (
                    <span className="shrink-0 rounded-full border border-primary/40 bg-primary/10 px-1.5 py-0.5 text-[10px] text-primary">
                      📌 Final
                    </span>
                  )}
                  <span className="hidden text-[11px] text-muted-foreground sm:inline">{r.shiftLabel}</span>
                  {r.telegramLinked === false ? (
                    <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
                      ⚠ chưa liên kết Telegram
                    </span>
                  ) : r.dm === "sent" ? (
                    <span className="rounded-full border border-success/30 bg-success/10 px-2 py-0.5 text-[10px] text-success">
                      DM ✓
                    </span>
                  ) : r.dm === "skipped" ? (
                    <span className="rounded-full border border-warning/40 bg-warning/10 px-2 py-0.5 text-[10px] text-warning">
                      DM bỏ qua
                    </span>
                  ) : r.telegramLinked ? (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      Telegram ✓
                    </span>
                  ) : null}
                  {r.appLinked === false && (
                    <span className="rounded-full border border-border px-2 py-0.5 text-[10px] text-muted-foreground">
                      chưa có app
                    </span>
                  )}
                  <span className={cn("ml-auto shrink-0 text-[11px]", confirm?.cls ?? "text-muted-foreground")}>
                    {confirm?.label ?? (published ? "🕐 chờ xác nhận" : "—")}
                  </span>
                </div>
              );
            })}
          </div>
          <p className="mt-2 text-[11px] text-muted-foreground">
            ⏰ Sắp có: tự động nhắc DM từng dealer trước giờ ca + nhắc người chưa xác nhận (đang chờ duyệt phần tự động).
          </p>
        </Card>
      )}

      {/* Image exports */}
      <Card className="p-4">
        <div className="text-sm font-semibold">Xuất ảnh để lưu / thống kê</div>
        <div className="mt-2 flex flex-wrap gap-2">
          <Button size="sm" variant="outline" className="h-8" onClick={onExportDay} disabled={exporting || assignments.length === 0}>
            {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="mr-1.5 h-3.5 w-3.5" />}
            Xuất ảnh ngày
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={onExportWeek} disabled={exporting}>
            {exporting ? <Loader2 className="mr-1.5 h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="mr-1.5 h-3.5 w-3.5" />}
            Xuất ảnh tuần
          </Button>
          <Button size="sm" variant="outline" className="h-8" onClick={onSendWeekTelegram} disabled={exporting}>
            <MessageCircle className="mr-1.5 h-3.5 w-3.5" /> Gửi ảnh tuần lên Telegram
          </Button>
        </div>
        <p className="mt-2 text-[11px] text-muted-foreground">
          Ảnh ngày = đúng mẫu đang gửi Telegram. Ảnh tuần = bảng ca × thứ (T2–CN) kèm tổng ca mỗi ngày.
        </p>
      </Card>
    </div>
  );
}
