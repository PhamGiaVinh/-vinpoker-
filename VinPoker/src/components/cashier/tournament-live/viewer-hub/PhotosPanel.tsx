// Public "Hình ảnh" (photos) tab — PLACEHOLDER. There is no event-photo storage in
// the system yet (no table / bucket); real upload is a separate backend session.
// For now this is a clean empty state so the 5-tab IA is complete. Theme-token only.

import { useTranslation } from "react-i18next";
import { ImageIcon } from "lucide-react";

export function PhotosPanel() {
  const { t } = useTranslation();
  return (
    <div className="flex flex-col items-center gap-2 rounded-xl border border-dashed border-border/50 bg-card/40 py-12 text-center">
      <ImageIcon className="h-8 w-8 text-muted-foreground/60" />
      <div className="text-sm font-semibold text-foreground">{t("liveHub.photos.empty", "Chưa có ảnh")}</div>
      <div className="text-xs text-muted-foreground">{t("liveHub.photos.soon", "Hình ảnh sự kiện sẽ sớm có ở đây")}</div>
    </div>
  );
}
