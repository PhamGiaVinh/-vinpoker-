import { useTranslation } from "react-i18next";
import { Bell, Link2, MessageSquareText, Pin, Play } from "lucide-react";
import type { TournamentPostViewModel } from "./viewerTypes";
import type { ReplayTarget } from "./replayTarget";

export interface TournamentPostCardProps {
  post: TournamentPostViewModel;
  focused?: boolean;
  onShare?: (postId: string) => void;
  onViewHand?: (target: ReplayTarget) => void;
}

function localizedCopy(post: TournamentPostViewModel, language: string) {
  const english = language.toLowerCase().startsWith("en");
  return {
    title: english ? post.titleEn?.trim() || post.titleVi?.trim() : post.titleVi?.trim(),
    body: english ? post.bodyEn?.trim() || post.bodyVi.trim() : post.bodyVi.trim(),
  };
}

export function TournamentPostCard({ post, focused = false, onShare, onViewHand }: TournamentPostCardProps) {
  const { t, i18n } = useTranslation();
  const copy = localizedCopy(post, i18n.language);
  const Icon = post.kind === "announcement" ? Bell : MessageSquareText;
  const published = new Date(post.publishedAt);
  const validDate = Number.isFinite(published.getTime());

  return (
    <article
      id={`viewer-post-${post.id}`}
      data-testid="viewer-editorial-post"
      className={`group overflow-hidden rounded-[18px] border bg-card/80 shadow-[0_18px_45px_hsl(var(--background)/0.32)] transition duration-200 motion-reduce:transition-none ${
        focused
          ? "border-[hsl(var(--viewer-neon))] ring-2 ring-[hsl(var(--viewer-neon)_/_0.2)]"
          : "border-[hsl(var(--viewer-neon)_/_0.28)] hover:border-[hsl(var(--viewer-neon)_/_0.5)]"
      }`}
    >
      {post.coverPhotoUrl && (
        <div className="relative aspect-[16/8] overflow-hidden bg-secondary/50 sm:aspect-[16/7]">
          <img
            src={post.coverPhotoUrl}
            alt={copy.title || t("liveHub.editorial.photoAlt", "Ảnh cập nhật giải đấu")}
            loading="lazy"
            className="h-full w-full object-cover transition duration-500 group-hover:scale-[1.025] motion-reduce:transform-none"
          />
          <div className="absolute inset-0 bg-gradient-to-t from-background/85 via-background/10 to-transparent" />
        </div>
      )}

      <div className="relative space-y-3 p-3.5 sm:p-4">
        <div className="flex flex-wrap items-center gap-2 text-[10px] font-bold uppercase tracking-[0.14em] text-muted-foreground">
          <span className="inline-flex min-h-7 items-center gap-1.5 border-l-2 border-[hsl(var(--viewer-neon))] pl-2 text-[hsl(var(--viewer-neon))]">
            <Icon className="h-3.5 w-3.5" aria-hidden="true" />
            {post.kind === "announcement"
              ? t("liveHub.editorial.announcement", "Thông báo")
              : t("liveHub.editorial.commentary", "Bình luận")}
          </span>
          {post.isPinned && (
            <span className="inline-flex items-center gap-1 text-foreground/75">
              <Pin className="h-3 w-3" aria-hidden="true" /> {t("liveHub.editorial.pinned", "Đã ghim")}
            </span>
          )}
          {validDate && (
            <time className="ml-auto normal-case tracking-normal" dateTime={post.publishedAt}>
              {new Intl.DateTimeFormat(i18n.language, { dateStyle: "short", timeStyle: "short" }).format(published)}
            </time>
          )}
        </div>

        <div className="max-w-[68ch]">
          {copy.title && <h3 className="tracker-display text-balance text-base font-bold leading-snug text-foreground sm:text-lg">{copy.title}</h3>}
          <p className="mt-1 whitespace-pre-line text-pretty text-sm leading-6 text-muted-foreground">{copy.body}</p>
          {post.sourceLabel && <p className="mt-2 text-[11px] font-semibold text-foreground/70">{post.sourceLabel}</p>}
        </div>

        {(onShare || (onViewHand && post.linkedHandId)) && (
          <div className="flex flex-wrap gap-2 border-t border-border/40 pt-3">
            {onShare && (
              <button
                type="button"
                onClick={() => onShare(post.id)}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl border border-border/70 px-3 text-xs font-semibold text-muted-foreground transition hover:border-[hsl(var(--viewer-neon)_/_0.5)] hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                <Link2 className="h-4 w-4" aria-hidden="true" /> {t("liveHub.editorial.share", "Chia sẻ")}
              </button>
            )}
            {onViewHand && post.linkedHandId && (
              <button
                type="button"
                onClick={() => onViewHand({
                  handId: post.linkedHandId!,
                  tableId: post.linkedHandTableId ?? null,
                  handNumber: post.linkedHandNumber ?? null,
                })}
                className="inline-flex min-h-11 flex-1 items-center justify-center gap-2 rounded-xl bg-[hsl(var(--viewer-neon))] px-3 text-xs font-bold text-[hsl(var(--viewer-neon-ink))] shadow-[0_0_0_1px_hsl(var(--viewer-neon)_/_0.32),0_0_22px_hsl(var(--viewer-neon)_/_0.34)] transition-[background-color,box-shadow,transform] duration-200 hover:bg-[hsl(var(--viewer-neon-bright))] hover:shadow-[0_0_0_1px_hsl(var(--viewer-neon)_/_0.5),0_0_34px_hsl(var(--viewer-neon)_/_0.52)] active:scale-[0.99] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring motion-reduce:transition-none"
              >
                <Play className="h-4 w-4" aria-hidden="true" />
                {t("liveHub.editorial.viewHand", "Xem ván #{{n}}", { n: post.linkedHandNumber })}
              </button>
            )}
          </div>
        )}
      </div>
    </article>
  );
}
